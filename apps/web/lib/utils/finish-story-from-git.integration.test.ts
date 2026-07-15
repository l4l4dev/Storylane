import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-53 AC #1/#2/#3: exercises the real `finish_story_from_git` RPC
// (supabase/migrations/20260715000003_finish_story_from_git.sql) — the
// transactional finish + current-iteration assignment the git-webhook Edge
// Function now calls. Two clients: the authenticated dev user seeds a
// project/iteration/stories (RLS-checked, realistic), and a service-role
// client calls the RPC exactly as the webhook does (it's granted to
// service_role only). Same opt-in gate as the other integration tests:
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

  // stories.number is always assigned by a BEFORE INSERT trigger
  // (20260707000004_stories_number.sql) — any value we pass is ignored — so
  // seedStory returns the number the trigger actually assigned.
  async function seedStory(state: string, iteration: string | null): Promise<number> {
    const { data, error } = await asUser
      .from("stories")
      .insert({ project_id: projectId, title: `Story (${state})`, state, iteration_id: iteration })
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
      .select("state, iteration_id")
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

    // Tracker project (owner = dev user via the created_by/membership path).
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
  });

  afterAll(async () => {
    if (projectId) {
      await asService.from("projects").delete().eq("id", projectId);
    }
  });

  it("finishes a started story and assigns the current iteration when it had none (AC #1/#2)", async () => {
    const number = await seedStory("started", null);

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: number,
    });
    expect(error).toBeNull();
    const events = data as FinishEvent[];
    expect(events[0].kind).toBe("finished");
    expect(events[0].iteration_number).toBe(1);

    const row = await storyRow(number);
    expect(row?.state).toBe("finished");
    expect(row?.iteration_id).toBe(iterationId);
  });

  it("leaves an already-assigned story's iteration untouched", async () => {
    const number = await seedStory("started", iterationId);

    const { data } = await asService.rpc("finish_story_from_git", { p_project_id: projectId, p_story_number: number });
    expect((data as FinishEvent[])[0].kind).toBe("finished");

    const row = await storyRow(number);
    expect(row?.state).toBe("finished");
    expect(row?.iteration_id).toBe(iterationId);
  });

  it("returns not_transitionable for an already-finished story (idempotent retry safety, AC #3)", async () => {
    const number = await seedStory("accepted", iterationId);

    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: number,
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0].kind).toBe("not_transitionable");

    const row = await storyRow(number);
    expect(row?.state).toBe("accepted"); // untouched
  });

  it("returns not_transitionable for a story number that doesn't exist", async () => {
    const { data, error } = await asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: 9999,
    });
    expect(error).toBeNull();
    expect((data as FinishEvent[])[0].kind).toBe("not_transitionable");
  });
});
