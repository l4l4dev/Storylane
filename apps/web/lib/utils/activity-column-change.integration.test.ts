import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-40 AC#2: the log_story_activity trigger
// (20260717000003_log_column_changes.sql) records a free-mode column move
// (custom_status_id change) as a 'story.column_changed' activity_logs row with
// the from/to column names. Exercised against a local Supabase instance since
// the guarantee lives entirely in the SECURITY DEFINER trigger, not in TS.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/activity-column-change.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("log_story_activity column-change trigger (integration)", () => {
  let supabase: SupabaseClient;
  let projectId: string;
  let todoId: string;
  let doingId: string;

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
    if (!url || !anonKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set for the integration test");
    }
    supabase = createClient(url, anonKey);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (authError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${authError.message}`);
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: "column-change trigger integration test", workflow_mode: "free" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;

    const { data: statuses, error: statusError } = await supabase
      .from("custom_statuses")
      .insert([
        { project_id: projectId, name: "To do", color: "#111111", is_done: false },
        { project_id: projectId, name: "Doing", color: "#222222", is_done: false },
      ])
      .select("id, name");
    if (statusError || !statuses) {
      throw new Error(`Failed to create statuses: ${statusError?.message}`);
    }
    todoId = statuses.find((s) => s.name === "To do")!.id;
    doingId = statuses.find((s) => s.name === "Doing")!.id;
  });

  afterAll(async () => {
    if (projectId) {
      await supabase.from("projects").delete().eq("id", projectId);
    }
  });

  it("records a column move as 'story.column_changed' with from/to column names", async () => {
    const { data: story, error: storyError } = await supabase
      .from("stories")
      .insert({ project_id: projectId, title: "card", story_type: "feature", custom_status_id: todoId })
      .select("id")
      .single();
    if (storyError || !story) {
      throw new Error(`Failed to create story: ${storyError?.message}`);
    }

    const { error: moveError } = await supabase
      .from("stories")
      .update({ custom_status_id: doingId })
      .eq("id", story.id);
    expect(moveError).toBeNull();

    const { data: logs } = await supabase
      .from("activity_logs")
      .select("action, payload")
      .eq("story_id", story.id)
      .order("created_at", { ascending: true });

    const columnChange = (logs ?? []).find((l) => l.action === "story.column_changed");
    expect(columnChange).toBeTruthy();
    expect(columnChange?.payload).toEqual({ from: "To do", to: "Doing" });

    // A tracker-style state change on this same story stays a separate action,
    // not conflated with the column move.
    expect((logs ?? []).some((l) => l.action === "story.column_changed" && l.payload === null)).toBe(false);
  });

  it("excludes comment.added from the story's history query (comments render in the thread instead)", async () => {
    const { data: story } = await supabase
      .from("stories")
      .insert({ project_id: projectId, title: "commented card", story_type: "feature", custom_status_id: todoId })
      .select("id")
      .single();
    await supabase.from("comments").insert({ story_id: story!.id, body: "a comment" });
    await supabase.from("stories").update({ custom_status_id: doingId }).eq("id", story!.id);

    // Same filter getStoryDetail applies to build the History section.
    const { data: history } = await supabase
      .from("activity_logs")
      .select("action")
      .eq("story_id", story!.id)
      .in("action", ["story.created", "story.state_changed", "story.column_changed"])
      .order("created_at", { ascending: false });

    const actions = (history ?? []).map((h) => h.action);
    expect(actions).toContain("story.column_changed");
    expect(actions).toContain("story.created");
    expect(actions).not.toContain("comment.added");
  });
});
