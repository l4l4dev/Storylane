import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises doc-20 §5: attaching a story to an epic (and detaching it) writes
// parent_id and NOTHING else — the story keeps its state, its iteration and
// its position, which is the whole difference from the retired TASK-187
// behaviour that dragged it into the container's Icebox nest. Triggers, RLS
// and the RPC's own guards only exist for real against the local stack.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/set-story-parent.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("set_story_parent (integration)", () => {
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let projectId: string;
  let unstartedId: string;
  let iterationId: string;
  let otherProjectId: string | undefined;
  let outsiderUserId: string | undefined;
  let viewerUserId: string | undefined;

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
    const auth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }

    const p = await owner.from("projects").insert({ name: "set_story_parent test" }).select("id").single();
    if (p.error || !p.data) throw new Error(`Project setup failed: ${p.error?.message}`);
    projectId = p.data.id;

    const states = await owner
      .from("project_states")
      .select("id, category, position")
      .eq("project_id", projectId)
      .order("position");
    unstartedId = states.data!.find((s) => s.category === "unstarted")!.id;

    const iteration = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 1, start_date: "2026-07-20", end_date: "2026-08-02" })
      .select("id")
      .single();
    iterationId = iteration.data!.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    if (otherProjectId) await admin.from("projects").delete().eq("id", otherProjectId);
    for (const id of [outsiderUserId, viewerUserId]) {
      if (id) await admin.auth.admin.deleteUser(id);
    }
  });

  async function createStory(fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await owner
      .from("stories")
      .insert({ project_id: projectId, story_type: "feature", title: "s", ...fields })
      .select("id")
      .single();
    if (error) throw new Error(`createStory failed: ${error.message}`);
    return data!.id;
  }

  async function newEpic(title = "epic"): Promise<string> {
    const { data, error } = await owner.rpc("create_epic", { p_project_id: projectId, p_title: title });
    if (error) throw new Error(`create_epic failed: ${error.message}`);
    return data as string;
  }

  async function read(id: string) {
    const { data } = await admin
      .from("stories")
      .select("parent_id, state_id, iteration_id, position, points, is_container")
      .eq("id", id)
      .single();
    return data!;
  }

  // AC#1. The neighbour is asserted too: a resequencing bug would leave the
  // moved row's own position intact while quietly renumbering everything
  // around it, and only the neighbour's position catches that.
  it("attaching leaves state_id, iteration_id and position untouched — for the story and its neighbours", async () => {
    const epicId = await newEpic("scheduled work");
    const target = await createStory({ title: "target", state_id: unstartedId, iteration_id: iterationId, points: 3 });
    const neighbour = await createStory({ title: "neighbour", state_id: unstartedId, iteration_id: iterationId, points: 2 });

    const before = await read(target);
    const neighbourBefore = await read(neighbour);

    const { error } = await owner.rpc("set_story_parent", { p_story_id: target, p_parent_id: epicId });
    expect(error).toBeNull();

    const after = await read(target);
    expect(after).toMatchObject({
      parent_id: epicId,
      state_id: before.state_id,
      iteration_id: before.iteration_id,
      position: before.position,
      points: before.points,
    });
    expect((await read(neighbour)).position).toBe(neighbourBefore.position);
  });

  it("detaching (null parent) also leaves the board columns untouched", async () => {
    const epicId = await newEpic("detach me");
    const child = await createStory({ title: "child", state_id: unstartedId, iteration_id: iterationId, points: 5 });
    await owner.rpc("set_story_parent", { p_story_id: child, p_parent_id: epicId });
    const attached = await read(child);

    const { error } = await owner.rpc("set_story_parent", { p_story_id: child, p_parent_id: null });
    expect(error).toBeNull();

    expect(await read(child)).toMatchObject({
      parent_id: null,
      state_id: attached.state_id,
      iteration_id: attached.iteration_id,
      position: attached.position,
      points: attached.points,
    });
  });

  // The one rule this RPC owns that no trigger does. The Parent picker
  // deliberately containerizes bottom-up (doc-18 §9) behind a confirmation
  // dialog; a drag has no such step, so it refuses rather than silently
  // clearing an ordinary story's points/state/iteration.
  it("refuses a parent that is not already an epic, leaving it un-containerized", async () => {
    const plain = await createStory({ title: "not an epic", state_id: unstartedId, points: 8 });
    const child = await createStory({ title: "would-be child" });

    const { error } = await owner.rpc("set_story_parent", { p_story_id: child, p_parent_id: plain });
    expect(error?.message).toContain("That epic no longer exists");

    expect(await read(plain)).toMatchObject({ is_container: false, points: 8 });
    expect((await read(child)).parent_id).toBeNull();
  });

  it("refuses a malformed parent id the same way, not with a raw cast error", async () => {
    const child = await createStory({ title: "child" });
    const { error } = await owner.rpc("set_story_parent", {
      p_story_id: child,
      p_parent_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error?.message).toContain("That epic no longer exists");
  });

  it("leaves the existing nesting triggers in charge of hierarchy legality", async () => {
    const epicA = await newEpic("A");
    const epicB = await newEpic("B");
    // A pinned epic may not be nested (doc-20 §2) — enforce_single_level_nesting,
    // not this RPC, is what rejects it.
    const { error } = await owner.rpc("set_story_parent", { p_story_id: epicA, p_parent_id: epicB });
    expect(error?.message).toContain("epic cannot be nested");
    expect((await read(epicA)).parent_id).toBeNull();
  });

  // A fourth forged-parent shape: an epic dropped on ITSELF satisfies this
  // RPC's is_container check, so the refusal comes from
  // enforce_single_level_nesting's self-reference guard instead. Pinned here
  // so a future refactor of either layer cannot drop it silently.
  it("refuses an epic named as its own parent", async () => {
    const epicId = await newEpic("self");
    const { error } = await owner.rpc("set_story_parent", { p_story_id: epicId, p_parent_id: epicId });
    expect(error?.message).toContain("cannot be its own parent");
    expect((await read(epicId)).parent_id).toBeNull();
  });

  it("is idempotent when the parent already matches", async () => {
    const epicId = await newEpic("same");
    const child = await createStory({ title: "child" });
    await owner.rpc("set_story_parent", { p_story_id: child, p_parent_id: epicId });
    const { error } = await owner.rpc("set_story_parent", { p_story_id: child, p_parent_id: epicId });
    expect(error).toBeNull();
    expect((await read(child)).parent_id).toBe(epicId);
  });

  it("refuses a story in a project the caller is not a member of", async () => {
    const email = `parent-outsider-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    outsiderUserId = created!.user!.id;

    const outsider = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await outsider.auth.signInWithPassword({ email, password });
    const theirProject = await outsider.from("projects").insert({ name: "not yours" }).select("id").single();
    otherProjectId = theirProject.data!.id;
    const theirStory = await outsider
      .from("stories")
      .insert({ project_id: otherProjectId, story_type: "feature", title: "theirs" })
      .select("id")
      .single();

    const epicId = await newEpic("mine");
    const { error } = await owner.rpc("set_story_parent", { p_story_id: theirStory.data!.id, p_parent_id: epicId });
    expect(error?.message).toContain("Story not found");
    expect((await read(theirStory.data!.id)).parent_id).toBeNull();
  });

  it("refuses a viewer (writers only)", async () => {
    const email = `parent-viewer-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    viewerUserId = created!.user!.id;
    await admin.from("project_members").insert({ project_id: projectId, user_id: viewerUserId, role: "viewer" });

    const viewer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await viewer.auth.signInWithPassword({ email, password });

    const epicId = await newEpic("viewer target epic");
    const child = await createStory({ title: "viewer target" });
    const { error } = await viewer.rpc("set_story_parent", { p_story_id: child, p_parent_id: epicId });
    expect(error?.message).toContain("Story not found");
    expect((await read(child)).parent_id).toBeNull();
  });

  // Cross-project parents are the triggers' job, but the RPC's own
  // same-project filter on the is_container lookup rejects it first — either
  // way the write must not land. Reuses the foreign project seeded above
  // (created_by is explicit: service_role has no auth.uid() to default from).
  it("refuses a parent from another project", async () => {
    const child = await createStory({ title: "child" });
    const foreignEpic = await admin
      .from("stories")
      .insert({
        project_id: otherProjectId!,
        story_type: "feature",
        title: "foreign epic",
        epic_pinned: true,
        created_by: outsiderUserId!,
      })
      .select("id")
      .single();

    const { error } = await owner.rpc("set_story_parent", {
      p_story_id: child,
      p_parent_id: foreignEpic.data!.id,
    });
    expect(error).not.toBeNull();
    expect((await read(child)).parent_id).toBeNull();
  });
});
