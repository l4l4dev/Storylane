import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises doc-20 §2: epic_pinned, the derived is_container = has_children OR
// epic_pinned, and the create_epic / set_epic_pinned RPCs — including the
// forged-write paths a raw PostgREST PATCH can attempt (TASK-182's class of
// hole). Triggers and RPCs only exist for real against the local stack.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/epic-pinned.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const TIMEOUT = 30_000;
const DB_URL = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe.skipIf(!RUN)("epic_pinned + create_epic / set_epic_pinned (integration)", () => {
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let projectId: string;
  let unstartedId: string;
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

    const p = await owner.from("projects").insert({ name: "epic pinned test" }).select("id").single();
    if (p.error || !p.data) throw new Error(`Project setup failed: ${p.error?.message}`);
    projectId = p.data.id;

    const states = await owner
      .from("project_states")
      .select("id, category, position")
      .eq("project_id", projectId)
      .order("position");
    unstartedId = states.data!.find((s) => s.category === "unstarted")!.id;
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

  async function read(id: string) {
    const { data } = await admin
      .from("stories")
      .select("epic_pinned, is_container, points, state_id, iteration_id, position, parent_id")
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

  // Holding the story's own row only proves a fresh membership check runs
  // somewhere after the initial select unblocks, not specifically the guard at
  // the function's true exit — a guard moved to right after that select would
  // satisfy it too.
  //
  // The wait only the true exit can cover: pinning a points-bearing story
  // inserts into activity_logs, whose project_id foreign key takes KEY SHARE
  // on the projects row as part of the INSERT. Holding that row FOR UPDATE
  // externally (FOR UPDATE is the one mode KEY SHARE conflicts with) blocks
  // strictly after the story's own row lock and the is_personal/child checks,
  // so a guard placed any earlier cannot see a de-membering that lands during
  // this wait.
  it("set_epic_pinned rejects a caller de-membered while its activity_logs insert waited on the PROJECT row", async () => {
    const { data: project } = await owner
      .from("projects")
      .insert({ name: "TASK-223 set_epic_pinned exit guard" })
      .select("id")
      .single();
    const raceProjectId = project!.id;
    const { data: story } = await owner
      .from("stories")
      .insert({ project_id: raceProjectId, story_type: "feature", title: "story", points: 3 })
      .select("id")
      .single();

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let settled: { error: { code?: string } | null };
    try {
      await holder.query("begin");
      await holder.query("select id from public.projects where id = $1 for update", [raceProjectId]);

      const pending = Promise.resolve(owner.rpc("set_epic_pinned", { p_story_id: story!.id, p_pinned: true }));

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

    const { data: after } = await admin
      .from("stories")
      .select("epic_pinned, points")
      .eq("id", story!.id)
      .single();
    expect(after).toMatchObject({ epic_pinned: false, points: 3 }); // the pin rolled back
    const { count } = await admin
      .from("activity_logs")
      .select("id", { count: "exact", head: true })
      .eq("story_id", story!.id)
      .eq("action", "story.containerized");
    expect(count ?? 0).toBe(0); // the audit insert rolled back too (story.created from setup stays)

    await admin.from("projects").delete().eq("id", raceProjectId);
  }, TIMEOUT);

  it("create_epic makes a childless container", async () => {
    const { data: id, error } = await owner.rpc("create_epic", {
      p_project_id: projectId,
      p_title: "  Auth platform  ",
      p_epic_color: "#abc",
    });
    expect(error).toBeNull();

    const row = await read(id as string);
    expect(row).toMatchObject({
      epic_pinned: true,
      is_container: true,
      points: null,
      state_id: null,
      iteration_id: null,
    });
    const titled = await admin.from("stories").select("title, epic_color").eq("id", id as string).single();
    expect(titled.data).toMatchObject({ title: "Auth platform", epic_color: "#abc" });
  });

  // TASK-183's regression class: every containerization path must leave the
  // epic with a colour, not just the child-membership flip in
  // recompute_is_container (20260724121514).
  it("defaults epic_color on both new containerization paths", async () => {
    const { data: created } = await owner.rpc("create_epic", { p_project_id: projectId, p_title: "No colour" });
    const createdRow = await admin.from("stories").select("epic_color").eq("id", created as string).single();
    expect(createdRow.data!.epic_color).toBe("#6366f1");

    const story = await createStory({ title: "Pin me" });
    await owner.rpc("set_epic_pinned", { p_story_id: story, p_pinned: true });
    const pinnedRow = await admin.from("stories").select("epic_color").eq("id", story).single();
    expect(pinnedRow.data!.epic_color).toBe("#6366f1");

    const picked = await createStory({ title: "Already coloured", epic_color: "#ff0000" });
    await owner.rpc("set_epic_pinned", { p_story_id: picked, p_pinned: true });
    const pickedRow = await admin.from("stories").select("epic_color").eq("id", picked).single();
    expect(pickedRow.data!.epic_color).toBe("#ff0000");
  });

  it("create_epic rejects a blank title and a project the caller is not a member of", async () => {
    const blank = await owner.rpc("create_epic", { p_project_id: projectId, p_title: "   " });
    expect(blank.error?.message).toContain("title");

    const foreign = await owner.rpc("create_epic", {
      p_project_id: "00000000-0000-0000-0000-000000000000",
      p_title: "nope",
    });
    expect(foreign.error?.message).toContain("Project not found");
  });

  it("set_epic_pinned(true) containerizes an estimated story and audits the lost points", async () => {
    const story = await createStory({ title: "Big", state_id: unstartedId, points: 5 });
    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: story, p_pinned: true });
    expect(error).toBeNull();

    expect(await read(story)).toMatchObject({
      epic_pinned: true,
      is_container: true,
      points: null,
      state_id: null,
      iteration_id: null,
    });

    const log = await admin
      .from("activity_logs")
      .select("payload")
      .eq("story_id", story)
      .eq("action", "story.containerized")
      .single();
    expect(log.data!.payload).toMatchObject({ old_points: 5 });
  });

  it("set_epic_pinned(false) returns a childless epic to an ordinary story", async () => {
    const story = await createStory({ title: "Unpin me" });
    await owner.rpc("set_epic_pinned", { p_story_id: story, p_pinned: true });
    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: story, p_pinned: false });
    expect(error).toBeNull();
    expect(await read(story)).toMatchObject({ epic_pinned: false, is_container: false });
  });

  it("set_epic_pinned(false) is rejected while the epic still has children", async () => {
    const epic = await createStory({ title: "Has kids" });
    await owner.rpc("set_epic_pinned", { p_story_id: epic, p_pinned: true });
    await createStory({ title: "kid", parent_id: epic });

    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: epic, p_pinned: false });
    expect(error?.message).toContain("still has stories");
    expect(await read(epic)).toMatchObject({ epic_pinned: true, is_container: true });
  });

  it("a child story cannot become an epic (single-level nesting)", async () => {
    const parent = await createStory({ title: "P" });
    const kid = await createStory({ title: "K", parent_id: parent });
    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: kid, p_pinned: true });
    expect(error?.message).toContain("child story");
  });

  it("a pinned epic stays a container after losing its last child; an unpinned one reverts", async () => {
    const pinned = await createStory({ title: "Pinned" });
    await owner.rpc("set_epic_pinned", { p_story_id: pinned, p_pinned: true });
    const pinnedKid = await createStory({ title: "k1", parent_id: pinned });

    const plain = await createStory({ title: "Plain" });
    const plainKid = await createStory({ title: "k2", parent_id: plain });
    expect(await read(plain)).toMatchObject({ is_container: true, epic_pinned: false });

    await owner.from("stories").update({ parent_id: null }).eq("id", pinnedKid);
    await owner.from("stories").update({ parent_id: null }).eq("id", plainKid);

    expect(await read(pinned)).toMatchObject({ is_container: true, epic_pinned: true });
    expect(await read(plain)).toMatchObject({ is_container: false, epic_pinned: false });
  });

  it("a direct PATCH cannot set epic_pinned or clear is_container", async () => {
    const story = await createStory({ title: "Forge", state_id: unstartedId, points: 3 });
    // Forged pin: silently ignored by the guard — the story keeps its board fields.
    await owner.from("stories").update({ epic_pinned: true }).eq("id", story);
    expect(await read(story)).toMatchObject({ epic_pinned: false, is_container: false, points: 3 });

    // Forged un-containerize on a real epic: derive_is_container forces it back.
    const epic = await createStory({ title: "Real epic" });
    await createStory({ title: "kid", parent_id: epic });
    await owner.from("stories").update({ is_container: false }).eq("id", epic);
    expect(await read(epic)).toMatchObject({ is_container: true });
  });

  it("a client INSERT cannot create a pre-pinned epic", async () => {
    const smuggled = await createStory({ title: "Smuggled", epic_pinned: true });
    expect(await read(smuggled)).toMatchObject({ epic_pinned: false, is_container: false });
  });

  it("the off-board CHECK still rejects estimating a pinned epic", async () => {
    const { data: id } = await owner.rpc("create_epic", { p_project_id: projectId, p_title: "Off board" });
    const { error } = await owner.from("stories").update({ points: 5 }).eq("id", id as string);
    expect(error).not.toBeNull();
    expect(await read(id as string)).toMatchObject({ points: null });
  });

  // set_epic_pinned's whole authorisation is the project_id-in-my-memberships
  // filter on its SELECT, so both halves of it get a regression test — a
  // foreign project's story, and a viewer inside this one.
  it("set_epic_pinned refuses a story in a project the caller is not a member of", async () => {
    const email = `epic-outsider-${Date.now()}@storylane.local`;
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

    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: theirStory.data!.id, p_pinned: true });
    expect(error?.message).toContain("Story not found");
    expect(await read(theirStory.data!.id)).toMatchObject({ epic_pinned: false, is_container: false });
  });

  it("both RPCs refuse a viewer (writers only)", async () => {
    const email = `epic-viewer-${Date.now()}@storylane.local`;
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

    const created2 = await viewer.rpc("create_epic", { p_project_id: projectId, p_title: "viewer epic" });
    expect(created2.error?.message).toContain("Project not found");

    const story = await createStory({ title: "viewer target" });
    const pinned = await viewer.rpc("set_epic_pinned", { p_story_id: story, p_pinned: true });
    expect(pinned.error?.message).toContain("Story not found");
    expect(await read(story)).toMatchObject({ epic_pinned: false, is_container: false });
  });

  // Nesting guard regression, one test each.
  it("an epic cannot be nested under another story", async () => {
    const { data: outer } = await owner.rpc("create_epic", { p_project_id: projectId, p_title: "Outer" });
    const { data: inner } = await owner.rpc("create_epic", { p_project_id: projectId, p_title: "Inner" });

    const { error } = await owner
      .from("stories")
      .update({ parent_id: outer as string })
      .eq("id", inner as string);
    expect(error?.message).toContain("epic cannot be nested");
    expect(await read(inner as string)).toMatchObject({ parent_id: null, is_container: true });
  });

  it("set_epic_pinned rejects a NULL p_pinned instead of unpinning", async () => {
    const { data: id } = await owner.rpc("create_epic", { p_project_id: projectId, p_title: "Null arg" });
    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: id as string, p_pinned: null });
    expect(error).not.toBeNull();
    expect(await read(id as string)).toMatchObject({ epic_pinned: true });
  });

  it("unpinning a container that is one through child membership is rejected, not a silent no-op", async () => {
    const parent = await createStory({ title: "By membership" });
    await createStory({ title: "kid", parent_id: parent });
    expect(await read(parent)).toMatchObject({ is_container: true, epic_pinned: false });

    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: parent, p_pinned: false });
    expect(error?.message).toContain("still has stories");
  });

  it("create_epic normalises a blank epic_color to the default", async () => {
    const { data: id } = await owner.rpc("create_epic", {
      p_project_id: projectId,
      p_title: "Blank colour",
      p_epic_color: "  ",
    });
    const row = await admin.from("stories").select("epic_color").eq("id", id as string).single();
    expect(row.data!.epic_color).toBe("#6366f1");
  });

  it("both RPCs refuse the personal project (TASK-147 seam)", async () => {
    // The signed-in dev user's OWN personal project — any other user's would
    // fail the membership check first and never reach the is_personal guard.
    const { data: me } = await owner.auth.getUser();
    const personal = await admin
      .from("projects")
      .select("id")
      .eq("is_personal", true)
      .eq("created_by", me.user!.id)
      .limit(1)
      .maybeSingle();
    if (!personal.data) return; // no personal project on this stack — nothing to seal

    const created = await owner.rpc("create_epic", { p_project_id: personal.data.id, p_title: "nope" });
    expect(created.error?.message).toContain("Personal tasks");

    const task = await owner
      .from("stories")
      .insert({ project_id: personal.data.id, story_type: "feature", title: "personal probe" })
      .select("id")
      .single();
    if (task.data) {
      const pinned = await owner.rpc("set_epic_pinned", { p_story_id: task.data.id, p_pinned: true });
      expect(pinned.error?.message).toContain("Personal tasks");
      await admin.from("stories").delete().eq("id", task.data.id);
    }
  });

  it("attaching a story to an epic leaves state_id, iteration_id and position untouched", async () => {
    const { data: epicId } = await owner.rpc("create_epic", { p_project_id: projectId, p_title: "Target" });
    const story = await createStory({ title: "Scheduled", state_id: unstartedId, points: 2 });
    const before = await read(story);

    const { error } = await owner.from("stories").update({ parent_id: epicId as string }).eq("id", story);
    expect(error).toBeNull();

    const after = await read(story);
    expect(after).toMatchObject({
      parent_id: epicId as string,
      state_id: before.state_id,
      iteration_id: before.iteration_id,
      position: before.position,
      points: 2,
    });
  });
});
