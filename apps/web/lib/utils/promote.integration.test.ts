import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-13 AC #5: exercises the real `promote_story_to_epic` RPC
// (current definition: supabase/migrations/20260719000011_reanchor_story_ops.sql,
// re-anchored onto stories.state_id by TASK-91 — spawned task-stories always
// land in the Icebox, doc-8's Icebox=NULL rule, regardless of the promoted
// story's own state) against a running local Supabase instance, following
// the precedent set by recurring.integration.test.ts for RPC-level
// guarantees a pure-TS unit test can't cover (position-shift atomicity, the
// done-iteration guard, owner-only permission, concurrent-promote
// serialization).
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/promote.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("promote_story_to_epic RPC (integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  let projectId: string;
  let unstartedStateId: string;

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

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: "promote-to-epic RPC integration test" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;

    const { data: unstarted } = await supabase
      .from("project_states")
      .select("id")
      .eq("project_id", projectId)
      .eq("category", "unstarted")
      .single();
    unstartedStateId = unstarted!.id;
  });

  afterAll(async () => {
    if (projectId) {
      // ON DELETE CASCADE takes iterations/epics/stories/project_members with
      // it (supabase/migrations/20260627000002_projects.sql).
      await supabase.from("projects").delete().eq("id", projectId);
    }
  });

  async function createStory(overrides: Record<string, unknown> = {}) {
    const { data: existing } = await supabase.from("stories").select("position").eq("project_id", projectId);
    const position = existing?.reduce((max, s) => Math.max(max, s.position), -1) ?? -1;
    const { data: story, error } = await supabase
      .from("stories")
      .insert({
        project_id: projectId,
        title: "Big story to split",
        description: "grew too big",
        story_type: "feature",
        points: 8,
        position: position + 1,
        state_id: unstartedStateId,
        ...overrides,
      })
      .select("id, position")
      .single();
    if (error || !story) {
      throw new Error(`Failed to create test story: ${error?.message}`);
    }
    return story;
  }

  it("promotes a story with tasks into an epic, preserving task order at the original position (AC #2, #3)", async () => {
    const before = await createStory({ title: "Before sibling" });
    const target = await createStory({ title: "Story with tasks" });
    const after = await createStory({ title: "After sibling" });

    const { data: label } = await supabase
      .from("labels")
      .insert({ project_id: projectId, name: "urgent", color: "#ff0000" })
      .select("id")
      .single();
    await supabase.from("story_labels").insert({ story_id: target.id, label_id: label!.id });

    await supabase.from("tasks").insert([
      { story_id: target.id, title: "task A", position: 0 },
      { story_id: target.id, title: "task B", position: 1 },
    ]);

    const { data, error } = await supabase.rpc("promote_story_to_epic", { p_story_id: target.id });
    expect(error).toBeNull();
    const result = data as { epic_id: string; story_ids: string[] };
    expect(result.story_ids).toHaveLength(2);

    const { data: epic } = await supabase.from("epics").select("name, description").eq("id", result.epic_id).single();
    expect(epic?.name).toBe("Story with tasks");

    const { data: newStories } = await supabase
      .from("stories")
      .select("id, title, story_type, points, state_id, epic_id, position, story_labels(label_id)")
      .in("id", result.story_ids)
      .order("position");
    expect(newStories?.map((s) => s.title)).toEqual(["task A", "task B"]);
    for (const s of newStories ?? []) {
      expect(s.story_type).toBe("feature");
      expect(s.points).toBeNull();
      expect(s.state_id).toBeNull(); // spawned stories always land Icebox (doc-8)
      expect(s.epic_id).toBe(result.epic_id);
      expect((s.story_labels as { label_id: string }[]).map((l) => l.label_id)).toEqual([label!.id]);
    }

    const { data: originalGone } = await supabase.from("stories").select("id").eq("id", target.id).maybeSingle();
    expect(originalGone).toBeNull();

    const { data: siblings } = await supabase
      .from("stories")
      .select("id, position")
      .in("id", [before.id, after.id])
      .order("position");
    expect(siblings?.[0].id).toBe(before.id);
    expect(siblings?.[1].id).toBe(after.id);
    expect(siblings![1].position).toBeGreaterThan(siblings![0].position);
    expect(newStories![0].position).toBeGreaterThan(before.position);
    expect(siblings![1].position).toBeGreaterThan(newStories![1].position);

    const { data: log } = await supabase
      .from("activity_logs")
      .select("action, payload")
      .eq("project_id", projectId)
      .eq("action", "story.promoted_to_epic")
      .single();
    expect((log?.payload as { task_count: number })?.task_count).toBe(2);
  });

  // TASK-58 slice 2a: positions are allocated by stories_position_seq, which
  // only appends if it stays ahead of every position in use. Promotion shifts
  // its siblings' positions UP to make room for the task-stories, so it is the
  // one path that can push a position past the sequence. The fixtures here
  // must not pass an explicit position — that would bypass the sequence and
  // hide exactly what this asserts.
  it("keeps a story created after a promote at the end of the project", async () => {
    async function createSequenced(title: string) {
      const { data, error } = await supabase
        .from("stories")
        .insert({ project_id: projectId, title, story_type: "feature", state_id: unstartedStateId })
        .select("id, position")
        .single();
      if (error || !data) throw new Error(`Failed to create story: ${error?.message}`);
      return data;
    }

    const target = await createSequenced("Promote me (seq)");
    await createSequenced("Sibling after target (seq)");
    await supabase.from("tasks").insert([
      { story_id: target.id, title: "t1" },
      { story_id: target.id, title: "t2" },
      { story_id: target.id, title: "t3" },
    ]);

    const { error: promoteError } = await supabase.rpc("promote_story_to_epic", { p_story_id: target.id });
    expect(promoteError).toBeNull();

    const created = await createSequenced("Created after promote (must be last)");

    const { data: rows } = await supabase.from("stories").select("id, position").eq("project_id", projectId);
    const others = rows?.filter((r) => r.id !== created.id) ?? [];
    expect(others.length).toBeGreaterThan(0);
    expect(Math.max(...others.map((o) => o.position))).toBeLessThan(created.position);
  });

  // Predates the sequence: the shift moved stories but not backlog_dividers,
  // which share the backlog's one position sequence (20260707000001), so a
  // story sitting right before a divider jumped over it whenever the promoted
  // story had 2+ tasks.
  it("keeps a divider's place in the backlog when an earlier story is promoted", async () => {
    // Built through insert_board_item because that is how the backlog is really
    // populated: it splices and re-densifies stories+dividers together, which
    // is the interleaved state the shift has to preserve. Inserting a divider
    // directly would leave it at the default position 0 and prove nothing.
    async function addItem(kind: "story" | "divider", payload: Record<string, string>) {
      const { data, error } = await supabase.rpc("insert_board_item", {
        p_project_id: projectId,
        p_kind: kind,
        p_payload: payload,
        p_anchor: {},
      });
      if (error || !data) throw new Error(`insert_board_item failed: ${error?.message}`);
      return data as string;
    }

    const targetId = await addItem("story", { title: "Promote me (before divider)" });
    const betweenId = await addItem("story", { title: "Between target and divider" });
    const dividerId = await addItem("divider", { label: "--- divider ---", kind: "note" });
    const afterId = await addItem("story", { title: "After the divider" });

    await supabase.from("tasks").insert([
      { story_id: targetId, title: "t1" },
      { story_id: targetId, title: "t2" },
      { story_id: targetId, title: "t3" },
    ]);

    const { error } = await supabase.rpc("promote_story_to_epic", { p_story_id: targetId });
    expect(error).toBeNull();

    const { data: between } = await supabase.from("stories").select("position").eq("id", betweenId).single();
    const { data: divider } = await supabase
      .from("backlog_dividers")
      .select("position")
      .eq("id", dividerId)
      .single();
    const { data: after } = await supabase.from("stories").select("position").eq("id", afterId).single();

    expect(between!.position).toBeLessThan(divider!.position);
    expect(divider!.position).toBeLessThan(after!.position);
  });

  it("promotes a story with zero tasks into an empty epic (AC #4)", async () => {
    const story = await createStory({ title: "No tasks here" });

    const { data, error } = await supabase.rpc("promote_story_to_epic", { p_story_id: story.id });
    expect(error).toBeNull();
    const result = data as { epic_id: string; story_ids: string[] };
    expect(result.story_ids).toHaveLength(0);

    const { data: epic } = await supabase.from("epics").select("name").eq("id", result.epic_id).single();
    expect(epic?.name).toBe("No tasks here");
  });

  it("deletes comments with the promoted story (AC #1 warning path)", async () => {
    const story = await createStory({ title: "Has comments" });
    await supabase.from("comments").insert({ story_id: story.id, body: "a comment" });

    const { error } = await supabase.rpc("promote_story_to_epic", { p_story_id: story.id });
    expect(error).toBeNull();

    const { data: comments } = await supabase.from("comments").select("id").eq("story_id", story.id);
    expect(comments).toHaveLength(0);
  });

  it("keeps a story's promoted children in the Icebox when the original was already there", async () => {
    const story = await createStory({ title: "Icebox story", state_id: null });
    await supabase.from("tasks").insert({ story_id: story.id, title: "only task", position: 0 });

    const { data, error } = await supabase.rpc("promote_story_to_epic", { p_story_id: story.id });
    expect(error).toBeNull();
    const result = data as { epic_id: string; story_ids: string[] };

    const { data: newStory } = await supabase.from("stories").select("state_id").eq("id", result.story_ids[0]).single();
    expect(newStory?.state_id).toBeNull();
  });

  it("drops a done-iteration story's promoted children back to the Icebox instead of raising", async () => {
    // Attach the story while the iteration is still active — the
    // reject-done-iteration-insert trigger only blocks INSERTs pointed at an
    // *already*-done iteration, which isn't how this happens in practice:
    // finalize_iteration finishes the iteration (a plain UPDATE) after
    // stories are already pointing at it, never re-inserting them.
    const { data: iteration, error: iterationError } = await supabase
      .from("iterations")
      .insert({
        project_id: projectId,
        number: 1,
        start_date: "2026-01-01",
        end_date: "2026-01-07",
        state: "active",
      })
      .select("id")
      .single();
    if (iterationError || !iteration) {
      throw new Error(`Failed to create test iteration: ${iterationError?.message}`);
    }

    const { data: accepted } = await supabase
      .from("project_states")
      .select("id")
      .eq("project_id", projectId)
      .eq("category", "done")
      .single();

    const story = await createStory({
      title: "Accepted in a done iteration",
      iteration_id: iteration.id,
      state_id: accepted!.id,
    });
    await supabase.from("tasks").insert({ story_id: story.id, title: "leftover task", position: 0 });

    // Setup shortcut via service_role: authenticated clients can no longer
    // update iterations.state (TASK-86 column-grant fix) — which is the
    // very guard the app relies on, so the test must bypass it deliberately.
    const { error: finalizeError } = await admin
      .from("iterations")
      .update({ state: "done" })
      .eq("id", iteration.id);
    if (finalizeError) {
      throw new Error(`Failed to finalize test iteration: ${finalizeError.message}`);
    }

    const { data, error } = await supabase.rpc("promote_story_to_epic", { p_story_id: story.id });
    expect(error).toBeNull();
    const result = data as { epic_id: string; story_ids: string[] };

    const { data: newStory } = await supabase
      .from("stories")
      .select("iteration_id, state_id")
      .eq("id", result.story_ids[0])
      .single();
    expect(newStory?.iteration_id).toBeNull();
    expect(newStory?.state_id).toBeNull();
  });

  it("serializes concurrent promotes of two different stories in the same project without deadlocking", async () => {
    const a = await createStory({ title: "Concurrent A" });
    const b = await createStory({ title: "Concurrent B" });
    await supabase.from("tasks").insert([
      { story_id: a.id, title: "a1", position: 0 },
      { story_id: b.id, title: "b1", position: 0 },
    ]);

    const [first, second] = await Promise.all([
      supabase.rpc("promote_story_to_epic", { p_story_id: a.id }),
      supabase.rpc("promote_story_to_epic", { p_story_id: b.id }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
  });

  it("rejects promotion from a non-owner project member", async () => {
    const story = await createStory({ title: "Owner-only guard" });

    const email = `promote-test-member-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`Failed to create test member user: ${createError?.message}`);
    }

    const { error: memberError } = await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: created.user.id, role: "member" });
    if (memberError) {
      throw new Error(`Failed to add test member: ${memberError.message}`);
    }

    const memberClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error: signInError } = await memberClient.auth.signInWithPassword({ email, password });
    if (signInError) {
      throw new Error(`Test member sign-in failed: ${signInError.message}`);
    }

    const { error } = await memberClient.rpc("promote_story_to_epic", { p_story_id: story.id });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only project owners/i);

    await admin.auth.admin.deleteUser(created.user.id);
  });
});
