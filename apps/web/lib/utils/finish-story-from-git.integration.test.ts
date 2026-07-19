import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-53 AC #1/#2/#3, re-anchored by TASK-91: exercises the real
// `finish_story_from_git` RPC (current definition:
// supabase/migrations/20260719000012_reanchor_finish_story_from_git.sql) —
// the transactional finish + current-iteration assignment the git-webhook
// Edge Function now calls. The merge target is now a per-project
// configurable state (integrations.config.merge_target_state_id,
// spec/integrations.md), forward-only by (category rank, position) instead
// of a fixed 'finished' literal. Two clients: the authenticated dev user
// seeds a project/iteration/stories/integration (RLS-checked, realistic),
// and a service-role client calls the RPC exactly as the webhook does
// (it's granted to service_role only).
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/finish-story-from-git.integration.test.ts
//
// Requires `supabase start` running locally with the seeded dev user.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type FinishEvent = { kind: string; number?: number; iteration_number?: number; reason?: string };

describe.skipIf(!RUN)("finish_story_from_git RPC (integration)", () => {
  let asUser: SupabaseClient;
  let asService: SupabaseClient;
  let projectId: string;
  let iterationId: string;
  // classic-template state ids, keyed by name.
  let states: Record<"Unstarted" | "Started" | "Finished" | "Delivered" | "Accepted" | "Rejected", string>;

  // stories.number is always assigned by a BEFORE INSERT trigger
  // (20260707000004_stories_number.sql) — any value we pass is ignored — so
  // seedStory returns the number the trigger actually assigned.
  async function seedStory(stateId: string | null, iteration: string | null): Promise<number> {
    const { data, error } = await asUser
      .from("stories")
      .insert({ project_id: projectId, title: `Story (${stateId ?? "icebox"})`, state_id: stateId, points: 2, iteration_id: iteration })
      .select("number")
      .single();
    if (error || data?.number == null) {
      throw new Error(`Failed to seed story: ${error?.message}`);
    }
    return data.number as number;
  }

  async function storyRow(number: number) {
    const { data } = await asService
      .from("stories")
      .select("state_id, iteration_id")
      .eq("project_id", projectId)
      .eq("number", number)
      .single();
    return data;
  }

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // fall through; missing env fails loudly below.
      }
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set");
    }

    asUser = createClient(url, anonKey);
    asService = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { error: authError } = await asUser.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (authError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${authError.message}`);
    }

    const { data: project, error: projectError } = await asUser
      .from("projects")
      .insert({ name: "finish_story_from_git integration test" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;

    const { data: iteration, error: iterationError } = await asUser
      .from("iterations")
      .insert({ project_id: projectId, number: 1, start_date: "2026-07-15", end_date: "2026-07-28" })
      .select("id")
      .single();
    if (iterationError || !iteration) {
      throw new Error(`Failed to create test iteration: ${iterationError?.message}`);
    }
    iterationId = iteration.id;

    const { data: stateRows } = await asUser.from("project_states").select("id, name").eq("project_id", projectId);
    states = Object.fromEntries((stateRows ?? []).map((s) => [s.name, s.id])) as typeof states;

    // Classic template default: merge target is Finished (spec/integrations.md).
    const { error: integrationError } = await asUser.from("integrations").insert({
      project_id: projectId,
      provider: "github",
      config: { merge_target_state_id: states.Finished, webhook_secret: "test-secret" },
      is_active: true,
    });
    if (integrationError) {
      throw new Error(`Failed to seed integration: ${integrationError.message}`);
    }
  });

  afterAll(async () => {
    if (projectId) {
      await asService.from("projects").delete().eq("id", projectId);
    }
  });

  it("finishes a started story and assigns the current iteration when it had none (AC #1/#2)", async () => {
    const number = await seedStory(states.Started, null);

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: number,
      p_provider: "github",
    });
    expect(error).toBeNull();
    const events = data as FinishEvent[];
    expect(events[0].kind).toBe("finished");
    expect(events[0].iteration_number).toBe(1);

    const row = await storyRow(number);
    expect(row?.state_id).toBe(states.Finished);
    expect(row?.iteration_id).toBe(iterationId);
  });

  it("leaves an already-assigned story's iteration untouched", async () => {
    const number = await seedStory(states.Started, iterationId);

    const { data } = await asService.rpc("finish_story_from_git", { p_project_id: projectId, p_story_number: number, p_provider: "github" });
    expect((data as FinishEvent[])[0].kind).toBe("finished");

    const row = await storyRow(number);
    expect(row?.state_id).toBe(states.Finished);
    expect(row?.iteration_id).toBe(iterationId);
  });

  it("finishes an Icebox story (forward-only: Icebox ranks before everything)", async () => {
    const number = await seedStory(null, null);

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: number,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0].kind).toBe("finished");

    const row = await storyRow(number);
    expect(row?.state_id).toBe(states.Finished);
  });

  it("returns not_transitionable for a story already at the target state", async () => {
    const number = await seedStory(states.Finished, iterationId);

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: number,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0].kind).toBe("not_transitionable");

    const row = await storyRow(number);
    expect(row?.state_id).toBe(states.Finished); // untouched
  });

  it("returns not_transitionable for an already-accepted story (idempotent retry safety, AC #3)", async () => {
    const number = await seedStory(states.Accepted, iterationId);

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: number,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0].kind).toBe("not_transitionable");

    const row = await storyRow(number);
    expect(row?.state_id).toBe(states.Accepted); // untouched
  });

  it("returns not_transitionable for a story number that doesn't exist", async () => {
    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: 9999,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0].kind).toBe("not_transitionable");
  });

  it("returns ignored/not_configured when the project has no active git integration", async () => {
    const { data: otherProject } = await asUser.from("projects").insert({ name: "no-integration project" }).select("id").single();
    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: otherProject!.id,
      p_story_number: 1,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0]).toMatchObject({ kind: "ignored", reason: "not_configured" });
    await asService.from("projects").delete().eq("id", otherProject!.id);
  });

  it("returns ignored/target_state_invalid when merge_target_state_id points at a done-category state", async () => {
    const { data: badProject } = await asUser.from("projects").insert({ name: "bad-target project" }).select("id").single();
    const { data: badStates } = await asUser.from("project_states").select("id, category").eq("project_id", badProject!.id);
    const doneStateId = badStates!.find((s) => s.category === "done")!.id;
    await asUser.from("integrations").insert({
      project_id: badProject!.id,
      provider: "github",
      config: { merge_target_state_id: doneStateId },
      is_active: true,
    });

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: badProject!.id,
      p_story_number: 1,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0]).toMatchObject({ kind: "ignored", reason: "target_state_invalid" });
    await asService.from("projects").delete().eq("id", badProject!.id);
  });

  // The RPC filters by provider, so a project with only a forgejo
  // integration configured must not have its story finished when the
  // caller (correctly) identifies itself as github.
  it("ignores a provider with no configured integration, even when a different provider is configured (provider mismatch guard)", async () => {
    const { data: mismatchProject } = await asUser.from("projects").insert({ name: "provider-mismatch project" }).select("id").single();
    const { data: mismatchStates } = await asUser
      .from("project_states")
      .select("id, category")
      .eq("project_id", mismatchProject!.id);
    const finishedStateId = mismatchStates!.find((s) => s.category === "in_progress")!.id;
    await asUser.from("integrations").insert({
      project_id: mismatchProject!.id,
      provider: "forgejo",
      config: { merge_target_state_id: finishedStateId },
      is_active: true,
    });

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: mismatchProject!.id,
      p_story_number: 1,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0]).toMatchObject({ kind: "ignored", reason: "not_configured" });
    await asService.from("projects").delete().eq("id", mismatchProject!.id);
  });

  // Writing state_id before finding an iteration to assign would leave a
  // Backlog/Icebox story stranded (state set, no iteration) when the
  // project had none yet — invisible on the Kanban board, which renders no
  // Backlog/Icebox columns.
  it("fails closed with no_active_iteration instead of stranding a Backlog story when the project has no iteration yet (no board visit)", async () => {
    const { data: freshProject } = await asUser.from("projects").insert({ name: "no-iteration-yet project" }).select("id").single();
    const { data: freshStates } = await asUser
      .from("project_states")
      .select("id, name, category")
      .eq("project_id", freshProject!.id);
    const freshByName = Object.fromEntries((freshStates ?? []).map((s) => [s.name, s.id]));
    await asUser.from("integrations").insert({
      project_id: freshProject!.id,
      provider: "github",
      config: { merge_target_state_id: freshByName.Finished },
      is_active: true,
    });

    const { data: freshStory } = await asUser
      .from("stories")
      .insert({ project_id: freshProject!.id, title: "No iteration yet", state_id: freshByName.Started, points: 2, iteration_id: null })
      .select("number")
      .single();

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: freshProject!.id,
      p_story_number: freshStory!.number,
      p_provider: "github",
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0]).toMatchObject({ kind: "ignored", reason: "no_active_iteration" });

    const { data: row } = await asService
      .from("stories")
      .select("state_id, iteration_id")
      .eq("project_id", freshProject!.id)
      .eq("number", freshStory!.number)
      .single();
    expect(row?.state_id).toBe(freshByName.Started); // untouched — not stranded in Finished with no iteration
    expect(row?.iteration_id).toBeNull();

    await asService.from("projects").delete().eq("id", freshProject!.id);
  });
});
