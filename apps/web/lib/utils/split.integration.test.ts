import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises the real `split_story` RPC (doc-18 §6-§7) and the doc-18 §8
// is_container reject guards on move/copy_story_to_project, against the local
// stack — the unit suite mocks the DB, so RPC/trigger behavior can only be
// validated here. Replaces promote.integration.test.ts (promote_story_to_epic
// was dropped in TASK-181).
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/split.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("split_story RPC + container move/copy guards (integration)", () => {
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let projectId: string;
  let otherProjectId: string;
  let unstartedId: string;
  let inProgressId: string;

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
    const auth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }

    const p1 = await owner.from("projects").insert({ name: "split test" }).select("id").single();
    const p2 = await owner.from("projects").insert({ name: "split test other" }).select("id").single();
    if (p1.error || !p1.data || p2.error || !p2.data) {
      throw new Error(`Project setup failed: ${p1.error?.message ?? p2.error?.message}`);
    }
    projectId = p1.data.id;
    otherProjectId = p2.data.id;

    const states = await owner
      .from("project_states")
      .select("id, category, position")
      .eq("project_id", projectId)
      .order("position");
    unstartedId = states.data!.find((s) => s.category === "unstarted")!.id;
    inProgressId = states.data!.find((s) => s.category === "in_progress")!.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    if (otherProjectId) await admin.from("projects").delete().eq("id", otherProjectId);
  });

  async function createStory(fields: Record<string, unknown>): Promise<string> {
    const { data, error } = await owner
      .from("stories")
      .insert({ project_id: projectId, story_type: "feature", title: "s", ...fields })
      .select("id")
      .single();
    if (error) throw new Error(`createStory failed: ${error.message}`);
    return data!.id;
  }

  async function createTask(storyId: string, title: string): Promise<string> {
    const { data, error } = await owner.from("tasks").insert({ story_id: storyId, title }).select("id").single();
    if (error) throw new Error(`createTask failed: ${error.message}`);
    return data!.id;
  }

  const child = (over: Record<string, unknown> = {}) => ({
    title: "child",
    description: "",
    story_type: "feature",
    points: null,
    task_ids: [],
    ...over,
  });

  it("splits a story into children; source becomes an off-board container", async () => {
    const source = await createStory({ title: "Big", state_id: unstartedId, points: 5, epic_color: "#abc" });
    const { data, error } = await owner.rpc("split_story", {
      p_story_id: source,
      p_children: [child({ title: "A", points: 2 }), child({ title: "B", points: 3 })],
    });
    expect(error).toBeNull();
    expect(data.parent_id).toBe(source);
    expect(data.child_ids).toHaveLength(2);

    const parent = await admin
      .from("stories")
      .select("is_container, state_id, points, iteration_id")
      .eq("id", source)
      .single();
    expect(parent.data).toMatchObject({ is_container: true, state_id: null, points: null, iteration_id: null });

    const children = await admin
      .from("stories")
      .select("title, parent_id, state_id, points, assignee_id, epic_color")
      .in("id", data.child_ids)
      .order("title");
    expect(children.data).toMatchObject([
      { title: "A", parent_id: source, state_id: unstartedId, points: 2, assignee_id: null, epic_color: "#abc" },
      { title: "B", parent_id: source, state_id: unstartedId, points: 3, assignee_id: null, epic_color: "#abc" },
    ]);
  });

  it("records exactly one story.containerized log for k>=2 children (transition-guarded)", async () => {
    const source = await createStory({ title: "Log", state_id: unstartedId, points: 8 });
    await owner.rpc("split_story", { p_story_id: source, p_children: [child(), child(), child()] });

    const containerized = await admin
      .from("activity_logs")
      .select("id", { count: "exact" })
      .eq("story_id", source)
      .eq("action", "story.containerized");
    expect(containerized.count).toBe(1);

    const split = await admin
      .from("activity_logs")
      .select("id", { count: "exact" })
      .eq("story_id", source)
      .eq("action", "story.split");
    expect(split.count).toBe(1);
  });

  it("reassigns selected tasks to their child; unassigned tasks stay on the source", async () => {
    const source = await createStory({ title: "Tasks", state_id: unstartedId, points: 3 });
    const t1 = await createTask(source, "t1");
    const t2 = await createTask(source, "t2");
    await createTask(source, "t3"); // left unassigned

    const { data } = await owner.rpc("split_story", {
      p_story_id: source,
      p_children: [child({ title: "A", task_ids: [t1] }), child({ title: "B", task_ids: [t2] })],
    });
    const [childA, childB] = data.child_ids;

    const tasks = await admin.from("tasks").select("id, story_id, title").in("id", [t1, t2]);
    const byId = new Map(tasks.data!.map((t) => [t.id, t.story_id]));
    expect(byId.get(t1)).toBe(childA);
    expect(byId.get(t2)).toBe(childB);

    const remaining = await admin.from("tasks").select("id").eq("story_id", source);
    expect(remaining.data).toHaveLength(1); // t3 stays on the container
  });

  // /code-review (TASK-183): split_story is an authenticated RPC any member
  // can call directly with arbitrary task_ids — the same id listed under two
  // children must not silently drop the second child's request.
  it("rejects a task_id listed under more than one child", async () => {
    const source = await createStory({ title: "DupeTask", state_id: unstartedId });
    const t1 = await createTask(source, "shared task");

    const { error } = await owner.rpc("split_story", {
      p_story_id: source,
      p_children: [child({ title: "A", task_ids: [t1] }), child({ title: "B", task_ids: [t1] })],
    });
    expect(error?.message).toMatch(/task.*more than one|duplicate/i);
  });

  it("lands children in the first unstarted state when the source is in an in_progress state", async () => {
    // An in_progress story needs an iteration: stories_enforce_board_invariants
    // (TASK-208) rejects that category with iteration_id NULL on every path.
    const { data: iter } = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 90, start_date: "2026-07-01", end_date: "2026-07-14" })
      .select("id")
      .single();
    const source = await createStory({ title: "WIP", state_id: inProgressId, points: 2, iteration_id: iter!.id });
    const { data } = await owner.rpc("split_story", { p_story_id: source, p_children: [child()] });
    const kid = await admin.from("stories").select("state_id").eq("id", data.child_ids[0]).single();
    expect(kid.data!.state_id).toBe(unstartedId);
  });

  it("keeps children in the Icebox when the source is in the Icebox (state_id null)", async () => {
    const source = await createStory({ title: "Ice", state_id: null });
    const { data } = await owner.rpc("split_story", { p_story_id: source, p_children: [child()] });
    const kid = await admin
      .from("stories")
      .select("state_id, iteration_id")
      .eq("id", data.child_ids[0])
      .single();
    expect(kid.data).toMatchObject({ state_id: null, iteration_id: null });
  });

  it("inherits a live iteration but drops a done iteration to the backlog (doc-18 §7)", async () => {
    // Both created active; a story can only be assigned to a non-done
    // iteration, so the "done" case is set up by flipping the iteration after
    // the story lands in it.
    const live = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 9001, start_date: "2026-01-05", end_date: "2026-01-16", state: "active" })
      .select("id")
      .single();
    const done = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 9000, start_date: "2025-12-22", end_date: "2026-01-02", state: "active" })
      .select("id")
      .single();

    const inLive = await createStory({ title: "Live", state_id: unstartedId, iteration_id: live.data!.id });
    const r1 = await owner.rpc("split_story", { p_story_id: inLive, p_children: [child()] });
    const k1 = await admin.from("stories").select("iteration_id").eq("id", r1.data.child_ids[0]).single();
    expect(k1.data!.iteration_id).toBe(live.data!.id);

    const inDone = await createStory({ title: "Done", state_id: unstartedId, iteration_id: done.data!.id });
    await admin.from("iterations").update({ state: "done" }).eq("id", done.data!.id);
    const r2 = await owner.rpc("split_story", { p_story_id: inDone, p_children: [child()] });
    const k2 = await admin.from("stories").select("iteration_id").eq("id", r2.data.child_ids[0]).single();
    expect(k2.data!.iteration_id).toBeNull();
  });

  it("rejects splitting a story that is already a container", async () => {
    const parent = await createStory({ title: "Cont", state_id: unstartedId });
    await createStory({ title: "kid", parent_id: parent, state_id: unstartedId });
    const { error } = await owner.rpc("split_story", { p_story_id: parent, p_children: [child()] });
    expect(error?.message).toMatch(/already a container|cannot be split/i);
  });

  it("rejects splitting a story that is itself a child", async () => {
    const parent = await createStory({ title: "P", state_id: unstartedId });
    const kid = await createStory({ title: "C", parent_id: parent, state_id: unstartedId });
    const { error } = await owner.rpc("split_story", { p_story_id: kid, p_children: [child()] });
    expect(error?.message).toMatch(/child|nested|cannot be split/i);
  });

  it("keeps the position sequence append-only: a story created after a split lands last (rule-1 regression)", async () => {
    const source = await createStory({ title: "Seq", state_id: unstartedId, points: 1 });
    await owner.rpc("split_story", { p_story_id: source, p_children: [child(), child()] });
    const after = await createStory({ title: "After", state_id: unstartedId });

    const all = await admin.from("stories").select("id, position").eq("project_id", projectId);
    const positions = all.data!.map((s) => s.position);
    const afterPos = all.data!.find((s) => s.id === after)!.position;
    expect(afterPos).toBe(Math.max(...positions));
    expect(new Set(positions).size).toBe(positions.length); // no collisions
  });

  it("clamps off-scale child points to NULL (server-side scale validation, like move/copy)", async () => {
    const source = await createStory({ title: "Scale", state_id: unstartedId, points: 2 });
    const { data } = await owner.rpc("split_story", {
      p_story_id: source,
      p_children: [child({ title: "Valid", points: 2 }), child({ title: "OffScale", points: 999 })],
    });
    const kids = await admin.from("stories").select("title, points").in("id", data.child_ids).order("title");
    expect(kids.data).toMatchObject([
      { title: "OffScale", points: null }, // 999 is off any scale -> clamped
      { title: "Valid", points: 2 },
    ]);
  });

  it("clamps a non-numeric child points value to NULL instead of aborting the split", async () => {
    const source = await createStory({ title: "BadPts", state_id: unstartedId, points: 1 });
    const { data, error } = await owner.rpc("split_story", {
      p_story_id: source,
      p_children: [{ title: "Kid", description: "", story_type: "feature", points: "abc", task_ids: [] }],
    });
    expect(error).toBeNull();
    const kid = await admin.from("stories").select("points").eq("id", data.child_ids[0]).single();
    expect(kid.data!.points).toBeNull();
  });

  it("move_story_to_project and copy_story_to_project reject a container (doc-18 §8)", async () => {
    const parent = await createStory({ title: "Epic", state_id: unstartedId });
    await createStory({ title: "kid", parent_id: parent, state_id: unstartedId });

    const move = await owner.rpc("move_story_to_project", { p_story_id: parent, p_target_project_id: otherProjectId });
    expect(move.error?.message).toMatch(/container/i);
    const copy = await owner.rpc("copy_story_to_project", { p_story_id: parent, p_target_project_id: otherProjectId });
    expect(copy.error?.message).toMatch(/container/i);
  });

  it("still moves a child, dropping its parent_id on landing (doc-18 §8)", async () => {
    const parent = await createStory({ title: "Epic2", state_id: unstartedId });
    const kid = await createStory({ title: "kid2", parent_id: parent, state_id: unstartedId });
    const { data, error } = await owner.rpc("move_story_to_project", {
      p_story_id: kid,
      p_target_project_id: otherProjectId,
    });
    expect(error).toBeNull();
    const moved = await admin.from("stories").select("parent_id, project_id").eq("id", data.story_id).single();
    expect(moved.data).toMatchObject({ parent_id: null, project_id: otherProjectId });
  });
});
