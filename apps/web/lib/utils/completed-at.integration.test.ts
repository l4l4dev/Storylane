import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-91 AC#4: maintain_story_completed_at (re-anchored onto category by
// supabase/migrations/20260719000008_reanchor_board_mechanics.sql) sets
// completed_at on entering a done-category state, clears it on leaving one,
// and preserves it across a done-to-done move (re-labelling which "done"
// column a story sits in must not reset the original acceptance timestamp).
// The trigger itself predates TASK-91 (20260709000004_focus_view.sql) and
// was only re-anchored here, but had no direct test of this behavior before.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/completed-at.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("maintain_story_completed_at trigger (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let projectId: string;
  let ownerId: string;
  let states: Record<"Unstarted" | "Started" | "Accepted", string>;

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
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    owner = createClient(url, anonKey);
    const ownerAuth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }
    ownerId = ownerAuth.data.user.id;

    const { data: project, error: projectError } = await owner
      .from("projects")
      .insert({ name: "completed_at trigger integration test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const { data: stateRows } = await admin.from("project_states").select("id, name").eq("project_id", projectId);
    states = Object.fromEntries((stateRows ?? []).map((s) => [s.name, s.id])) as typeof states;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
  });

  async function completedAt(storyId: string): Promise<string | null> {
    const { data } = await admin.from("stories").select("completed_at").eq("id", storyId).single();
    return data?.completed_at ?? null;
  }

  it("sets completed_at when a story enters a done-category state", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({ project_id: projectId, title: "enters done", story_type: "feature", points: 2, state_id: states.Unstarted, created_by: ownerId })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);
    expect(await completedAt(story.id)).toBeNull();

    const { error: rpcError } = await owner.rpc("set_story_state", { p_story_id: story.id, p_state_id: states.Accepted });
    expect(rpcError).toBeNull();
    expect(await completedAt(story.id)).not.toBeNull();
  });

  it("clears completed_at when a story leaves a done-category state", async () => {
    // Seeded directly into a done-category state and an already-assigned
    // iteration (so the in_progress auto-assign path below has nothing to
    // do) — the INSERT trigger sets completed_at immediately.
    const { data: iteration, error: iterError } = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 100, start_date: "2026-07-01", end_date: "2026-07-14" })
      .select("id")
      .single();
    if (iterError || !iteration) throw new Error(`Failed to seed iteration: ${iterError?.message}`);

    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "leaves done",
        story_type: "feature",
        points: 2,
        state_id: states.Accepted,
        iteration_id: iteration.id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);
    expect(await completedAt(story.id)).not.toBeNull();

    const { error: rpcError } = await owner.rpc("set_story_state", { p_story_id: story.id, p_state_id: states.Started });
    expect(rpcError).toBeNull();
    expect(await completedAt(story.id)).toBeNull();
  });

  it("preserves the original completed_at across a done-to-done move", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({ project_id: projectId, title: "done-to-done", story_type: "feature", points: 2, state_id: states.Accepted, created_by: ownerId })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);
    const originalCompletedAt = await completedAt(story.id);
    expect(originalCompletedAt).not.toBeNull();

    // A second done-category state — re-labelling which "done" column a
    // story sits in (e.g. splitting Accepted into two columns) must not
    // reset the original acceptance timestamp.
    const { data: secondDone, error: stateError } = await admin
      .from("project_states")
      .insert({ project_id: projectId, name: "Accepted B", category: "done", position: 100 })
      .select("id")
      .single();
    if (stateError || !secondDone) throw new Error(`Failed to seed second done state: ${stateError?.message}`);

    const { error: rpcError } = await owner.rpc("set_story_state", { p_story_id: story.id, p_state_id: secondDone.id });
    expect(rpcError).toBeNull();
    expect(await completedAt(story.id)).toBe(originalCompletedAt);
  });
});
