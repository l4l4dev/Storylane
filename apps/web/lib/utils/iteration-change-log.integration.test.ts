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
// Extended for TASK-218 (20260731000000): story.points_changed, the
// has_state flags that separate the Backlog from the Icebox, and the
// rollover marker that separates an automatic rollover, a manual finish and
// a member's drag.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/iteration-change-log.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("log_story_activity (integration)", () => {
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
        // points: the UPDATE below moves this into an in_progress state, which
        // stories_enforce_board_invariants (TASK-208) refuses unestimated.
        points: 1,
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

  it("marks the Backlog apart from the Icebox via has_state, and a manual move as not automated", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "dropped to the backlog",
        story_type: "feature",
        state_id: unstartedStateId,
        iteration_id: iteration1Id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

    // Backlog, not Icebox: iteration_id clears but the state_id stays.
    const { error: updateError } = await admin.from("stories").update({ iteration_id: null }).eq("id", story.id);
    expect(updateError).toBeNull();

    const logs = await logsFor(story.id);
    const changed = logs.find((l) => l.action === "story.iteration_changed");
    expect(changed?.payload).toMatchObject({ from_has_state: true, to_has_state: true, rollover: null });
  });

  it("logs story.points_changed on a re-estimation", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "re-estimated",
        story_type: "feature",
        points: 3,
        state_id: unstartedStateId,
        iteration_id: iteration1Id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

    const { error: updateError } = await admin.from("stories").update({ points: 8 }).eq("id", story.id);
    expect(updateError).toBeNull();

    const logs = await logsFor(story.id);
    const changed = logs.filter((l) => l.action === "story.points_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0].payload).toMatchObject({ from: 3, to: 8 });
  });

  it("does not log story.points_changed when points are unchanged", async () => {
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "points untouched",
        story_type: "feature",
        points: 5,
        state_id: unstartedStateId,
        iteration_id: iteration1Id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

    const { error: updateError } = await admin
      .from("stories")
      .update({ points: 5, title: "points untouched, retitled" })
      .eq("id", story.id);
    expect(updateError).toBeNull();

    const logs = await logsFor(story.id);
    expect(logs.some((l) => l.action === "story.points_changed")).toBe(false);
  });

  // finalize_iteration's rollover is a plain iteration_id UPDATE, so only the
  // transaction-local GUC it sets tells the trigger this was not a member's
  // drag. Runs against its own project because finalize_iteration finishes and
  // replaces the LATEST iteration, which would reshuffle the shared fixture.
  async function rolloverMarkersFor(manual: boolean) {
    const { data: project, error: projectError } = await admin
      .from("projects")
      .insert({ name: `rollover marker (${manual ? "manual" : "lazy"})`, created_by: ownerId })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);

    try {
      const { data: stateRows } = await admin.from("project_states").select("id, name").eq("project_id", project.id);
      const startedId = (stateRows ?? []).find((s) => s.name === "Unstarted")?.id;

      // Ends in the past, so the lazy rollover has something to finish.
      const { data: iteration, error: iterationError } = await admin
        .from("iterations")
        .insert({ project_id: project.id, number: 1, start_date: "2026-07-01", end_date: "2026-07-14" })
        .select("id")
        .single();
      if (iterationError || !iteration) throw new Error(`Failed to seed iteration: ${iterationError?.message}`);

      const { data: story, error } = await admin
        .from("stories")
        .insert({
          project_id: project.id,
          title: "carried over",
          story_type: "feature",
          points: 2,
          state_id: startedId,
          iteration_id: iteration.id,
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);

      const { error: rpcError } = await owner.rpc("finalize_iteration", {
        p_project_id: project.id,
        p_manual: manual,
        ...(manual ? { p_iteration_id: iteration.id } : {}),
      });
      expect(rpcError).toBeNull();

      const logs = await logsFor(story.id);
      return logs
        .filter((l) => l.action === "story.iteration_changed")
        .map((l) => (l.payload as { rollover?: unknown }).rollover);
    } finally {
      await admin.from("projects").delete().eq("id", project.id);
    }
  }

  it("marks a lazy finalize_iteration rollover as an automatic one", async () => {
    const markers = await rolloverMarkersFor(false);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((marker) => marker === "auto")).toBe(true);
  });

  // Clicking "Finish iteration" rolls stories over through the same code path,
  // but there the actor is a real person and the feed must keep their name.
  it("marks a manual finish as a manual rollover", async () => {
    const markers = await rolloverMarkersFor(true);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((marker) => marker === "manual")).toBe(true);
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
