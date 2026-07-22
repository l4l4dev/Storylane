import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-14 AC #6/#9: exercises the real move_story_to_project /
// copy_story_to_project RPCs (current definitions in
// supabase/migrations/20260718000001_remove_free_mode.sql) against a running
// local Supabase instance, following the precedent set by
// promote.integration.test.ts.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/move-copy.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("move_story_to_project / copy_story_to_project RPCs (integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  let projectAId: string;
  let projectBId: string;
  let customScaleProjectId: string;

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

    const { data: a, error: aError } = await supabase
      .from("projects")
      .insert({ name: "move-copy project A" })
      .select("id")
      .single();
    if (aError || !a) throw new Error(`Failed to create project A: ${aError?.message}`);
    projectAId = a.id;

    const { data: b, error: bError } = await supabase
      .from("projects")
      .insert({ name: "move-copy project B" })
      .select("id")
      .single();
    if (bError || !b) throw new Error(`Failed to create project B: ${bError?.message}`);
    projectBId = b.id;

    const { data: customScale, error: customScaleError } = await supabase
      .from("projects")
      .insert({ name: "move-copy custom scale project", point_scale: "custom", custom_points: [1, 2, 4] })
      .select("id")
      .single();
    if (customScaleError || !customScale) {
      throw new Error(`Failed to create custom-scale project: ${customScaleError?.message}`);
    }
    customScaleProjectId = customScale.id;
  });

  afterAll(async () => {
    for (const id of [projectAId, projectBId, customScaleProjectId]) {
      if (id) await supabase.from("projects").delete().eq("id", id);
    }
  });

  async function createStory(projectId: string, overrides: Record<string, unknown> = {}) {
    const { data: story, error } = await supabase
      .from("stories")
      .insert({ project_id: projectId, title: "Movable story", story_type: "feature", ...overrides })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to create test story: ${error?.message}`);
    return story;
  }

  it("moves a story to another project: lands unscheduled (Icebox), carries tasks/comments/labels, deletes the source", async () => {
    const story = await createStory(projectAId, { title: "Move me A->B" });
    await supabase.from("tasks").insert({ story_id: story.id, title: "a task", position: 0 });
    await supabase.from("comments").insert({ story_id: story.id, body: "a comment" });
    const { data: label } = await supabase
      .from("labels")
      .insert({ project_id: projectAId, name: "urgent", color: "#ff0000" })
      .select("id")
      .single();
    await supabase.from("story_labels").insert({ story_id: story.id, label_id: label!.id });

    const { data, error } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: projectBId,
    });
    expect(error).toBeNull();
    const result = data as { story_id: string; project_id: string };
    expect(result.project_id).toBe(projectBId);

    const { data: newStory } = await supabase
      .from("stories")
      .select("state_id, project_id")
      .eq("id", result.story_id)
      .single();
    expect(newStory?.project_id).toBe(projectBId);
    expect(newStory?.state_id).toBeNull();

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
      .eq("project_id", projectAId)
      .eq("action", "story.moved_out")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(outLog).toHaveLength(1);

    const { data: inLog } = await supabase
      .from("activity_logs")
      .select("action")
      .eq("project_id", projectBId)
      .eq("story_id", result.story_id)
      .eq("action", "story.moved_in");
    expect(inLog).toHaveLength(1);
  });

  it("lands the moved story after every story already in the target project", async () => {
    const occupant = await createStory(projectBId, { title: "Already in the target" });
    const story = await createStory(projectAId, { title: "Move me to the end" });

    const { data, error } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: projectBId,
    });
    expect(error).toBeNull();
    const result = data as { story_id: string };

    const { data: rows } = await supabase.from("stories").select("id, position").eq("project_id", projectBId);
    const moved = rows?.find((r) => r.id === result.story_id);
    const others = rows?.filter((r) => r.id !== result.story_id) ?? [];
    expect(others.some((o) => o.id === occupant.id)).toBe(true);
    expect(Math.max(...others.map((o) => o.position))).toBeLessThan(moved!.position);
  });

  it("clears points that don't exist in the target's point scale, keeps points that do", async () => {
    const outOfScale = await createStory(projectAId, { title: "Points out of scale", points: 3 });
    const { data: r1, error: e1 } = await supabase.rpc("move_story_to_project", {
      p_story_id: outOfScale.id,
      p_target_project_id: customScaleProjectId,
    });
    expect(e1).toBeNull();
    const { data: s1 } = await supabase.from("stories").select("points").eq("id", (r1 as { story_id: string }).story_id).single();
    expect(s1?.points).toBeNull();

    const inScale = await createStory(projectAId, { title: "Points in scale", points: 2 });
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

    await admin.from("project_members").insert({ project_id: projectAId, user_id: created.user.id, role: "member" });

    const notMember = await createStory(projectAId, { title: "Assignee not in target", assignee_id: created.user.id });
    const { data: r1, error: e1 } = await supabase.rpc("move_story_to_project", {
      p_story_id: notMember.id,
      p_target_project_id: projectBId,
    });
    expect(e1).toBeNull();
    const { data: s1 } = await supabase.from("stories").select("assignee_id").eq("id", (r1 as { story_id: string }).story_id).single();
    expect(s1?.assignee_id).toBeNull();

    await admin.from("project_members").insert({ project_id: projectBId, user_id: created.user.id, role: "member" });
    const isMember = await createStory(projectAId, { title: "Assignee in target", assignee_id: created.user.id });
    const { data: r2, error: e2 } = await supabase.rpc("move_story_to_project", {
      p_story_id: isMember.id,
      p_target_project_id: projectBId,
    });
    expect(e2).toBeNull();
    const { data: s2 } = await supabase.from("stories").select("assignee_id").eq("id", (r2 as { story_id: string }).story_id).single();
    expect(s2?.assignee_id).toBe(created.user.id);

    await admin.auth.admin.deleteUser(created.user.id);
  });

  // Reuses an existing target label by name instead of creating a duplicate.
  // (The old "two source labels share a name" case is impossible since the
  // labels UNIQUE (project_id, name) constraint — 20260721000002 — so the
  // still-live dedup path is: a source label whose name already exists in the
  // TARGET must be reused, not recreated, which would violate that same
  // constraint.)
  it("reuses an existing same-named target label rather than duplicating it", async () => {
    const story = await createStory(projectAId, { title: "Dup label story" });
    const { data: sourceLabel } = await supabase
      .from("labels")
      .insert({ project_id: projectAId, name: "dup-name", color: "#111111" })
      .select("id")
      .single();
    await supabase.from("story_labels").insert({ story_id: story.id, label_id: sourceLabel!.id });

    // The target already has a label with the same name (different color).
    const { data: existingTargetLabel } = await supabase
      .from("labels")
      .insert({ project_id: projectBId, name: "dup-name", color: "#222222" })
      .select("id")
      .single();

    const { data, error } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: projectBId,
    });
    expect(error).toBeNull();

    const movedStoryId = (data as { story_id: string }).story_id;
    const { data: targetLabels } = await supabase
      .from("story_labels")
      .select("label_id")
      .eq("story_id", movedStoryId);
    // Exactly one link, pointing at the target's PRE-EXISTING label — not a
    // freshly-created duplicate.
    expect(targetLabels).toHaveLength(1);
    expect(targetLabels![0].label_id).toBe(existingTargetLabel!.id);

    // And the target still has just the one "dup-name" label.
    const { data: targetNamed } = await supabase
      .from("labels")
      .select("id")
      .eq("project_id", projectBId)
      .eq("name", "dup-name");
    expect(targetNamed).toHaveLength(1);
  });

  it("rejects a viewer-role caller (as a generic 'not found' — the source-membership filter folds viewer-of-source into the same case as a non-member, so it can't be used to probe story existence)", async () => {
    const email = `move-test-viewer-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) throw new Error(`Failed to create test user: ${createError?.message}`);
    await admin.from("project_members").insert({ project_id: projectAId, user_id: created.user.id, role: "viewer" });

    const story = await createStory(projectAId, { title: "Viewer cannot move" });

    const viewerClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: signInError } = await viewerClient.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`Viewer sign-in failed: ${signInError.message}`);

    const { error } = await viewerClient.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: projectBId,
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
    await admin.from("project_members").insert({ project_id: projectAId, user_id: created.user.id, role: "member" });

    const story = await createStory(projectAId, { title: "No access to target" });

    const memberClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: signInError } = await memberClient.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);

    const { error } = await memberClient.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: projectBId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not a member of the target project/i);

    await admin.auth.admin.deleteUser(created.user.id);
  });

  it("fails a task insert against an already-moved story (story-deleted path)", async () => {
    const story = await createStory(projectAId, { title: "Gone after move" });
    const { error: moveError } = await supabase.rpc("move_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: projectBId,
    });
    expect(moveError).toBeNull();

    const { error } = await supabase.from("tasks").insert({ story_id: story.id, title: "too late", position: 0 });
    expect(error).not.toBeNull();
  });

  it("serializes two simultaneous moves in opposite directions between the same two projects", async () => {
    const storyA = await createStory(projectAId, { title: "Concurrent A" });
    const storyB = await createStory(projectBId, { title: "Concurrent B" });

    const [first, second] = await Promise.all([
      supabase.rpc("move_story_to_project", { p_story_id: storyA.id, p_target_project_id: projectBId }),
      supabase.rpc("move_story_to_project", { p_story_id: storyB.id, p_target_project_id: projectAId }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });

  it("copy duplicates title/type/tasks/labels but not comments, and leaves the source untouched", async () => {
    const story = await createStory(projectAId, { title: "Copy me", points: 5 });
    await supabase.from("tasks").insert({ story_id: story.id, title: "done task", is_done: true, position: 0 });
    await supabase.from("comments").insert({ story_id: story.id, body: "should not copy" });
    const { data: label } = await supabase
      .from("labels")
      .insert({ project_id: projectAId, name: "copy-label", color: "#333333" })
      .select("id")
      .single();
    await supabase.from("story_labels").insert({ story_id: story.id, label_id: label!.id });

    const { data, error } = await supabase.rpc("copy_story_to_project", {
      p_story_id: story.id,
      p_target_project_id: projectBId,
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
      .insert({ project_id: projectAId, title: "archived source move test", story_type: "feature" })
      .select("id")
      .single();
    if (storyError || !story) throw new Error(`Failed to create test story: ${storyError?.message}`);

    await admin.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", projectAId);
    try {
      const { error } = await supabase.rpc("move_story_to_project", {
        p_story_id: story.id,
        p_target_project_id: projectBId,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/source project is archived/i);
    } finally {
      await admin.from("projects").update({ archived_at: null }).eq("id", projectAId);
      await admin.from("stories").delete().eq("id", story.id);
    }
  });

  it("rejects copying a story into an archived target project", async () => {
    const { data: story, error: storyError } = await supabase
      .from("stories")
      .insert({ project_id: projectAId, title: "archived target copy test", story_type: "feature" })
      .select("id")
      .single();
    if (storyError || !story) throw new Error(`Failed to create test story: ${storyError?.message}`);

    await admin.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", projectBId);
    try {
      const { error } = await supabase.rpc("copy_story_to_project", {
        p_story_id: story.id,
        p_target_project_id: projectBId,
      });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/target project is archived/i);
    } finally {
      await admin.from("projects").update({ archived_at: null }).eq("id", projectBId);
      await admin.from("stories").delete().eq("id", story.id);
    }
  });
});
