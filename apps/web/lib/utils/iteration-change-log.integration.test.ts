import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-207 follow-up (Codex review on PR #7): log_story_activity
// (supabase/migrations/20260727140000_generalize_iteration_change_log.sql)
// watches stories.iteration_id independently of state_id, so any write that
// changes it -- an ordinary board move, an automated finalize_iteration
// rollover, or a single UPDATE changing both columns at once -- logs a
// story.iteration_changed row. This had been verified manually (curl against
// a local reset) during that session but had no permanent test.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/iteration-change-log.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("story.iteration_changed activity logging (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let projectId: string;
  let ownerId: string;
  let unstartedStateId: string;
  let inProgressStateId: string;
  let iteration1Id: string;
  let iteration2Id: string;

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
    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const ownerAuth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }
    ownerId = ownerAuth.data.user.id;

    const { data: project, error: projectError } = await admin
      .from("projects")
      .insert({ name: "iteration-change-log integration test", created_by: ownerId })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const { data: stateRows } = await admin
      .from("project_states")
      .select("id, name")
      .eq("project_id", projectId);
    const byName = Object.fromEntries((stateRows ?? []).map((s) => [s.name, s.id])) as Record<string, string>;
    unstartedStateId = byName.Unstarted;
    inProgressStateId = byName.Started;

    const { data: iter1, error: iter1Error } = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 1, start_date: "2026-07-01", end_date: "2026-07-14" })
      .select("id")
      .single();
    if (iter1Error || !iter1) throw new Error(`Failed to seed iteration 1: ${iter1Error?.message}`);
    iteration1Id = iter1.id;

    const { data: iter2, error: iter2Error } = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 2, start_date: "2026-07-15", end_date: "2026-07-28" })
      .select("id")
      .single();
    if (iter2Error || !iter2) throw new Error(`Failed to seed iteration 2: ${iter2Error?.message}`);
    iteration2Id = iter2.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
  });

  async function logsFor(storyId: string) {
    const { data } = await admin
      .from("activity_logs")
      .select("action, payload")
      .eq("story_id", storyId)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  it("logs story.iteration_changed with iteration numbers for an ordinary reschedule", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "ordinary reschedule",
        story_type: "feature",
        state_id: unstartedStateId,
        iteration_id: iteration1Id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

    // The same plain iteration_id UPDATE move_story_board performs for a
    // Backlog<->Current drag.
    const { error: updateError } = await admin.from("stories").update({ iteration_id: iteration2Id }).eq("id", story.id);
    expect(updateError).toBeNull();

    const logs = await logsFor(story.id);
    const changed = logs.filter((l) => l.action === "story.iteration_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].payload).toMatchObject({
      from_iteration_id: iteration1Id,
      to_iteration_id: iteration2Id,
      from_iteration_number: 1,
      to_iteration_number: 2,
    });
  });

  it("logs a move to the Icebox (iteration_id -> null) with no iteration number", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "moved to icebox",
        story_type: "feature",
        state_id: unstartedStateId,
        iteration_id: iteration1Id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

    const { error: updateError } = await admin.from("stories").update({ iteration_id: null }).eq("id", story.id);
    expect(updateError).toBeNull();

    const logs = await logsFor(story.id);
    const changed = logs.find((l) => l.action === "story.iteration_changed");
    expect(changed?.payload).toMatchObject({
      from_iteration_id: iteration1Id,
      to_iteration_id: null,
      from_iteration_number: 1,
      to_iteration_number: null,
    });
  });

  it("logs both events, not just one, when state_id and iteration_id change in the same write", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "combined change",
        story_type: "feature",
        state_id: unstartedStateId,
        iteration_id: iteration1Id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

    const { error: updateError } = await admin
      .from("stories")
      .update({ state_id: inProgressStateId, iteration_id: iteration2Id })
      .eq("id", story.id);
    expect(updateError).toBeNull();

    const logs = await logsFor(story.id);
    const actions = logs.map((l) => l.action);
    // story.created from the insert, plus one of each for this single UPDATE.
    expect(actions).toEqual(
      expect.arrayContaining(["story.created", "story.state_changed", "story.iteration_changed"]),
    );
    expect(actions.filter((a) => a === "story.state_changed")).toHaveLength(1);
    expect(actions.filter((a) => a === "story.iteration_changed")).toHaveLength(1);
  });

  it("does not log story.iteration_changed when iteration_id is unchanged", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "unrelated update",
        story_type: "feature",
        state_id: unstartedStateId,
        iteration_id: iteration1Id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

    const { error: updateError } = await admin.from("stories").update({ title: "renamed" }).eq("id", story.id);
    expect(updateError).toBeNull();

    const logs = await logsFor(story.id);
    expect(logs.some((l) => l.action === "story.iteration_changed")).toBe(false);
  });
});
