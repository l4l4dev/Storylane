import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-14 AC #6/#9: exercises the real move_story_to_project /
// copy_story_to_project RPCs (supabase/migrations/20260711000001_move_copy_story.sql)
// against a running local Supabase instance, following the precedent set by
// promote.integration.test.ts / recurring.integration.test.ts.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/move-copy.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("move_story_to_project / copy_story_to_project RPCs (integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  let trackerProjectId: string;
  let freeProjectId: string;
  let freeDoneLeftmostProjectId: string;
  let customScaleProjectId: string;
  let freeTodoStatusId: string;

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // .env.local not found — fall through and let the missing env vars fail loudly below.
      }
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not set for the integration test",
      );
    }

    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    supabase = createClient(url, anonKey);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (authError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${authError.message}`);
    }

    const { data: tracker, error: trackerError } = await supabase
      .from("projects")
      .insert({ name: "move-copy tracker project", workflow_mode: "tracker" })
      .select("id")
      .single();
    if (trackerError || !tracker) throw new Error(`Failed to create tracker project: ${trackerError?.message}`);
    trackerProjectId = tracker.id;

    const { data: free, error: freeError } = await supabase
      .from("projects")
      .insert({ name: "move-copy free project", workflow_mode: "free" })
      .select("id")
      .single();
    if (freeError || !free) throw new Error(`Failed to create free project: ${freeError?.message}`);
    freeProjectId = free.id;

    const { data: statuses, error: statusesError } = await supabase
      .from("custom_statuses")
      .insert([
        { project_id: freeProjectId, name: "To do", position: 0, is_done: false },
        { project_id: freeProjectId, name: "Done", position: 1, is_done: true },
      ])
      .select("id, name");
    if (statusesError || !statuses) throw new Error(`Failed to create statuses: ${statusesError?.message}`);
    freeTodoStatusId = statuses.find((s) => s.name === "To do")!.id;

    const { data: freeDone, error: freeDoneError } = await supabase
      .from("projects")
      .insert({ name: "move-copy free done-leftmost project", workflow_mode: "free" })
      .select("id")
      .single();
    if (freeDoneError || !freeDone) throw new Error(`Failed to create free-done project: ${freeDoneError?.message}`);
    freeDoneLeftmostProjectId = freeDone.id;
    const { error: doneStatusError } = await supabase
      .from("custom_statuses")
      .insert({ project_id: freeDoneLeftmostProjectId, name: "Done", position: 0, is_done: true });
    if (doneStatusError) throw new Error(`Failed to create done-leftmost status: ${doneStatusError.message}`);

    const { data: customScale, error: customScaleError } = await supabase
      .from("projects")
      .insert({ name: "move-copy custom scale project", workflow_mode: "tracker", point_scale: "custom", custom_points: [1, 2, 4] })
      .select("id")
      .single();
    if (customScaleError || !customScale) {
      throw new Error(`Failed to create custom-scale project: ${customScaleError?.message}`);
    }
    customScaleProjectId = customScale.id;
  });

  afterAll(async () => {
    for (const id of [trackerProjectId, freeProjectId, freeDoneLeftmostProjectId, customScaleProjectId]) {
      if (id) await supabase.from("projects").delete().eq("id", id);
    }
  });

  async function createStory(projectId: string, overrides: Record<string, unknown> = {}) {
    const { data: existing } = await supabase.from("stories").select("position").eq("project_id", projectId);
    const position = existing?.reduce((max, s) => Math.max(max, s.position), -1) ?? -1;
    const { data: story, error } = await supabase
      .from("stories")
      .insert({ project_id: projectId, title: "Movable story", story_type: "feature", position: position + 1, ...overrides })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to create test story: ${error?.message}`);
    return story;
  }

  it("moves a tracker story to a free project: lands unscheduled in the leftmost column, carries tasks/comments/labels, deletes the source", async () => {
    const story = await createStory(trackerProjectId, { title: "Move me tracker->free" });
    await supabase.from("tasks").insert({ story_id: story.id, title: "a task", position: 0 });
    await supabase.from("comments").insert({ story_id: story.id, body: "a comment" });
    const { data: label } = await supabase
      .from("labels")
      .insert({ project_id: trackerProjectId, name: "urgent", color: "#ff0000" })
      .select("id")
      .single();
    await supabase.from("story_labels").insert({ story_id: story.id, label_id: label!.id });

    const { data, error } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: freeProjectId,
    });
    expect(error).toBeNull();
    const result = data as { story_id: string; project_id: string };
    expect(result.project_id).toBe(freeProjectId);

    const { data: newStory } = await supabase
      .from("stories")
      .select("state, custom_status_id, project_id")
      .eq("id", result.story_id)
      .single();
    expect(newStory?.project_id).toBe(freeProjectId);
    expect(newStory?.state).toBe("unscheduled");
    expect(newStory?.custom_status_id).toBe(freeTodoStatusId);

    const { data: tasks } = await supabase.from("tasks").select("title").eq("story_id", result.story_id);
    expect(tasks?.map((t) => t.title)).toEqual(["a task"]);

    const { data: comments } = await supabase.from("comments").select("body").eq("story_id", result.story_id);
    expect(comments?.map((c) => c.body)).toEqual(["a comment"]);

    const { data: labels } = await supabase
      .from("story_labels")
      .select("labels(name)")
      .eq("story_id", result.story_id);
    expect(labels).toHaveLength(1);

    const { data: originalGone } = await supabase.from("stories").select("id").eq("id", story.id).maybeSingle();
    expect(originalGone).toBeNull();

    const { data: outLog } = await supabase
      .from("activity_logs")
      .select("action")
      .eq("project_id", trackerProjectId)
      .eq("action", "story.moved_out")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(outLog).toHaveLength(1);

    const { data: inLog } = await supabase
      .from("activity_logs")
      .select("action")
      .eq("project_id", freeProjectId)
      .eq("story_id", result.story_id)
      .eq("action", "story.moved_in");
    expect(inLog).toHaveLength(1);
  });

  it("moves a free story to a tracker project: state unscheduled, custom_status_id cleared", async () => {
    const story = await createStory(freeProjectId, { title: "Move me free->tracker", custom_status_id: freeTodoStatusId });

    const { data, error } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: trackerProjectId,
    });
    expect(error).toBeNull();
    const result = data as { story_id: string };

    const { data: newStory } = await supabase
      .from("stories")
      .select("state, custom_status_id")
      .eq("id", result.story_id)
      .single();
    expect(newStory?.state).toBe("unscheduled");
    expect(newStory?.custom_status_id).toBeNull();
  });

  it("clears points that don't exist in the target's point scale, keeps points that do", async () => {
    const outOfScale = await createStory(trackerProjectId, { title: "Points out of scale", points: 3 });
    const { data: r1, error: e1 } = await supabase.rpc("move_story_to_project", {
      p_story_id: outOfScale.id,
      p_target_project_id: customScaleProjectId,
    });
    expect(e1).toBeNull();
    const { data: s1 } = await supabase.from("stories").select("points").eq("id", (r1 as { story_id: string }).story_id).single();
    expect(s1?.points).toBeNull();

    const inScale = await createStory(trackerProjectId, { title: "Points in scale", points: 2 });
    const { data: r2, error: e2 } = await supabase.rpc("move_story_to_project", {
      p_story_id: inScale.id,
      p_target_project_id: customScaleProjectId,
    });
    expect(e2).toBeNull();
    const { data: s2 } = await supabase.from("stories").select("points").eq("id", (r2 as { story_id: string }).story_id).single();
    expect(s2?.points).toBe(2);
  });

  it("keeps the assignee only if they're a member of the target project", async () => {
    const email = `move-test-assignee-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) throw new Error(`Failed to create test user: ${createError?.message}`);

    await admin.from("project_members").insert({ project_id: trackerProjectId, user_id: created.user.id, role: "member" });

    const notMember = await createStory(trackerProjectId, { title: "Assignee not in target", assignee_id: created.user.id });
    const { data: r1, error: e1 } = await supabase.rpc("move_story_to_project", {
      p_story_id: notMember.id,
      p_target_project_id: freeProjectId,
    });
    expect(e1).toBeNull();
    const { data: s1 } = await supabase.from("stories").select("assignee_id").eq("id", (r1 as { story_id: string }).story_id).single();
    expect(s1?.assignee_id).toBeNull();

    await admin.from("project_members").insert({ project_id: freeProjectId, user_id: created.user.id, role: "member" });
    const isMember = await createStory(trackerProjectId, { title: "Assignee in target", assignee_id: created.user.id });
    const { data: r2, error: e2 } = await supabase.rpc("move_story_to_project", {
      p_story_id: isMember.id,
      p_target_project_id: freeProjectId,
    });
    expect(e2).toBeNull();
    const { data: s2 } = await supabase.from("stories").select("assignee_id").eq("id", (r2 as { story_id: string }).story_id).single();
    expect(s2?.assignee_id).toBe(created.user.id);

    await admin.auth.admin.deleteUser(created.user.id);
  });

  it("recreates labels by name in the target, deduping when two source labels share a name", async () => {
    const story = await createStory(trackerProjectId, { title: "Dup label story" });
    const { data: labelA } = await supabase
      .from("labels")
      .insert({ project_id: trackerProjectId, name: "dup-name", color: "#111111" })
      .select("id")
      .single();
    const { data: labelB } = await supabase
      .from("labels")
      .insert({ project_id: trackerProjectId, name: "dup-name", color: "#222222" })
      .select("id")
      .single();
    await supabase.from("story_labels").insert([
      { story_id: story.id, label_id: labelA!.id },
      { story_id: story.id, label_id: labelB!.id },
    ]);

    const { data, error } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: freeProjectId,
    });
    expect(error).toBeNull();

    const { data: targetLabels } = await supabase
      .from("story_labels")
      .select("label_id")
      .eq("story_id", (data as { story_id: string }).story_id);
    expect(targetLabels).toHaveLength(1);
  });

  it("sets completed_at when landing in an is_done free-mode column", async () => {
    const story = await createStory(trackerProjectId, { title: "Lands done" });
    const { data, error } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: freeDoneLeftmostProjectId,
    });
    expect(error).toBeNull();

    const { data: newStory } = await supabase
      .from("stories")
      .select("completed_at")
      .eq("id", (data as { story_id: string }).story_id)
      .single();
    expect(newStory?.completed_at).not.toBeNull();
  });

  it("rejects a viewer-role caller (as a generic 'not found' — the source-membership filter folds viewer-of-source into the same case as a non-member, so it can't be used to probe story existence)", async () => {
    const email = `move-test-viewer-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) throw new Error(`Failed to create test user: ${createError?.message}`);
    await admin.from("project_members").insert({ project_id: trackerProjectId, user_id: created.user.id, role: "viewer" });

    const story = await createStory(trackerProjectId, { title: "Viewer cannot move" });

    const viewerClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: signInError } = await viewerClient.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`Viewer sign-in failed: ${signInError.message}`);

    const { error } = await viewerClient.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: freeProjectId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/story not found/i);

    await admin.auth.admin.deleteUser(created.user.id);
  });

  it("rejects a caller who isn't a member of the target project at all", async () => {
    const email = `move-test-target-outsider-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) throw new Error(`Failed to create test user: ${createError?.message}`);
    await admin.from("project_members").insert({ project_id: trackerProjectId, user_id: created.user.id, role: "member" });

    const story = await createStory(trackerProjectId, { title: "No access to target" });

    const memberClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: signInError } = await memberClient.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);

    const { error } = await memberClient.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: freeProjectId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not a member of the target project/i);

    await admin.auth.admin.deleteUser(created.user.id);
  });

  it("fails a task insert against an already-moved story (story-deleted path)", async () => {
    const story = await createStory(trackerProjectId, { title: "Gone after move" });
    const { error: moveError } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: freeProjectId,
    });
    expect(moveError).toBeNull();

    const { error } = await supabase.from("tasks").insert({ story_id: story.id, title: "too late", position: 0 });
    expect(error).not.toBeNull();
  });

  it("serializes two simultaneous moves in opposite directions between the same two projects", async () => {
    const storyA = await createStory(trackerProjectId, { title: "Concurrent A" });
    const storyB = await createStory(freeProjectId, { title: "Concurrent B" });

    const [first, second] = await Promise.all([
      supabase.rpc("move_story_to_project", { p_story_id: storyA.id, p_target_project_id: freeProjectId }),
      supabase.rpc("move_story_to_project", { p_story_id: storyB.id, p_target_project_id: trackerProjectId }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });

  it("copy duplicates title/type/tasks/labels but not comments, and leaves the source untouched", async () => {
    const story = await createStory(trackerProjectId, { title: "Copy me", points: 5 });
    await supabase.from("tasks").insert({ story_id: story.id, title: "done task", is_done: true, position: 0 });
    await supabase.from("comments").insert({ story_id: story.id, body: "should not copy" });
    const { data: label } = await supabase
      .from("labels")
      .insert({ project_id: trackerProjectId, name: "copy-label", color: "#333333" })
      .select("id")
      .single();
    await supabase.from("story_labels").insert({ story_id: story.id, label_id: label!.id });

    const { data, error } = await supabase.rpc("copy_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: freeProjectId,
    });
    expect(error).toBeNull();
    const result = data as { story_id: string };

    const { data: originalStillThere } = await supabase.from("stories").select("id").eq("id", story.id).single();
    expect(originalStillThere).not.toBeNull();

    const { data: originalComments } = await supabase.from("comments").select("id").eq("story_id", story.id);
    expect(originalComments).toHaveLength(1);

    const { data: copyTasks } = await supabase.from("tasks").select("title, is_done").eq("story_id", result.story_id);
    expect(copyTasks).toEqual([{ title: "done task", is_done: true }]);

    const { data: copyComments } = await supabase.from("comments").select("id").eq("story_id", result.story_id);
    expect(copyComments).toHaveLength(0);

    const { data: copyLabels } = await supabase.from("story_labels").select("label_id").eq("story_id", result.story_id);
    expect(copyLabels).toHaveLength(1);

    const { data: log } = await supabase
      .from("activity_logs")
      .select("action")
      .eq("story_id", result.story_id)
      .eq("action", "story.copied_in");
    expect(log).toHaveLength(1);
  });

  it("rejects moving a story out of an archived source project", async () => {
    const { data: story, error: storyError } = await supabase
      .from("stories")
      .insert({ project_id: trackerProjectId, title: "archived source move test", story_type: "feature" })
      .select("id")
      .single();
    if (storyError || !story) throw new Error(`Failed to create test story: ${storyError?.message}`);

    await admin.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", trackerProjectId);
    try {
      const { error } = await supabase.rpc("move_story_to_project", {
        p_story_id: story.id,
        p_target_project_id: freeProjectId,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/source project is archived/i);
    } finally {
      await admin.from("projects").update({ archived_at: null }).eq("id", trackerProjectId);
      await admin.from("stories").delete().eq("id", story.id);
    }
  });

  it("rejects copying a story into an archived target project", async () => {
    const { data: story, error: storyError } = await supabase
      .from("stories")
      .insert({ project_id: trackerProjectId, title: "archived target copy test", story_type: "feature" })
      .select("id")
      .single();
    if (storyError || !story) throw new Error(`Failed to create test story: ${storyError?.message}`);

    await admin.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", freeProjectId);
    try {
      const { error } = await supabase.rpc("copy_story_to_project", {
        p_story_id: story.id,
        p_target_project_id: freeProjectId,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/target project is archived/i);
    } finally {
      await admin.from("projects").update({ archived_at: null }).eq("id", freeProjectId);
      await admin.from("stories").delete().eq("id", story.id);
    }
  });
});
