import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises doc-20 §5: attaching a story to an epic (and detaching it) writes
// parent_id and NOTHING else — the story keeps its state, its iteration and
// its position, which is the whole difference from the retired TASK-187
// behaviour that dragged it into the container's Icebox nest. Triggers, RLS
// and the RPC's own guards only exist for real against the local stack.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/set-story-parent.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const TIMEOUT = 30_000;
const DB_URL = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe.skipIf(!RUN)("set_story_parent (integration)", () => {
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let projectId: string;
  let unstartedId: string;
  let iterationId: string;
  let ownerId: string;
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
    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const auth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    ownerId = auth.data.user.id;

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

  /** Blocks until another backend is waiting on a row THIS connection's transaction holds. */
  async function waitForRowWaiter(holder: PgClient): Promise<void> {
    const SQL = `
      select count(*)::int as n
        from pg_locks w
       where not w.granted
         and w.locktype in ('transactionid', 'tuple')
         and w.pid <> pg_backend_pid()
         and exists (
           select 1 from pg_locks h
            where h.granted and h.pid = pg_backend_pid()
              and h.locktype = 'transactionid'
              and h.transactionid = w.transactionid
         )`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { rows } = await holder.query(SQL);
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("nothing ever blocked on the held row — the test would be vacuous");
  }

  // TASK-223 AC#1. Codex on PR #15: blocking on the CHILD's own row only
  // proves some fresh membership check runs after the initial select — moving
  // require_project_role to right after that select (before the UPDATE) still
  // satisfies that shape, so it does not isolate the true exit guard.
  // Confirmed by testing exactly that variant against a local copy of the
  // function: the earlier-placed check still passed.
  //
  // The wait that only a guard remaining at the very end can cover is the OLD
  // PARENT's row lock: detaching fires maintain_is_container AFTER UPDATE,
  // which calls recompute_is_container(old.parent_id) — a `select ... for
  // update` on the parent, taken regardless of whether it ends up writing
  // anything. Holding that row externally blocks the trigger, which runs
  // strictly after the child's own UPDATE, so a guard placed anywhere earlier
  // (including right after the initial select) cannot see a de-membering that
  // lands during this wait — only the guard at the function's actual exit can.
  it("rejects a caller de-membered while a detach's trigger waited on the OLD PARENT row (exit guard)", async () => {
    const { data: project } = await owner
      .from("projects")
      .insert({ name: "TASK-223 set_story_parent exit guard" })
      .select("id")
      .single();
    const raceProjectId = project!.id;
    // Plain container (is_container via child membership, not epic_pinned):
    // losing its last child is what makes recompute_is_container write to it,
    // so the rollback assertion below proves the WHOLE cascade unwound, not
    // just the child's own parent_id.
    const { data: parent } = await admin
      .from("stories")
      .insert({ project_id: raceProjectId, story_type: "feature", title: "parent", created_by: ownerId })
      .select("id")
      .single();
    const { data: child } = await admin
      .from("stories")
      .insert({
        project_id: raceProjectId,
        story_type: "feature",
        title: "child",
        parent_id: parent!.id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect((await admin.from("stories").select("is_container").eq("id", parent!.id).single()).data!.is_container).toBe(
      true,
    );

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let settled: { error: { code?: string } | null };
    try {
      await holder.query("begin");
      await holder.query("select id from public.stories where id = $1 for update", [parent!.id]);

      const pending = Promise.resolve(
        owner.rpc("set_story_parent", { p_story_id: child!.id, p_parent_id: null }),
      );

      await waitForRowWaiter(holder);
      await admin
        .from("project_members")
        .delete()
        .eq("project_id", raceProjectId)
        .eq("user_id", ownerId);
      await holder.query("commit");
      settled = await pending;
    } finally {
      await holder.end();
    }

    expect(settled.error?.code).toBe("42501");

    const { data: afterChild } = await admin.from("stories").select("parent_id").eq("id", child!.id).single();
    expect(afterChild!.parent_id).toBe(parent!.id); // the detach rolled back
    const { data: afterParent } = await admin.from("stories").select("is_container").eq("id", parent!.id).single();
    expect(afterParent!.is_container).toBe(true); // the cascading un-containerize rolled back too

    await admin.from("projects").delete().eq("id", raceProjectId);
  }, TIMEOUT);

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

    const outsider = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
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

    const viewer = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
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
