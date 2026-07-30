import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// split_story used to row-lock the source story and only then ask for
// positions:<project>, the reverse of every other board RPC. Two callers could
// each hold half the pair:
//
//   split_story        holds the source row, waits for positions
//   create_draft_story holds positions, waits for the source row (splice shift)
//
// Postgres resolves that by aborting one with 40P01.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/split-story-lock-order.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const TIMEOUT = 30_000;
const DB_URL = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe.skipIf(!RUN)("split_story lock order (integration)", () => {
  let asOwner: SupabaseClient;
  let asService: SupabaseClient;
  let asOutsider: SupabaseClient; // signed in, member of nothing
  let ownerId: string;
  let outsiderId: string;
  const createdProjectIds: string[] = [];

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
    asService = createClient(url, serviceKey, { auth: { persistSession: false } });
    asOwner = createClient(url, anonKey, { auth: { persistSession: false } });
    const auth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    ownerId = auth.data.user.id;

    // A viewer still has a project_members row, so it only exercises the gate's
    // "role outside v_roles" branch. The `v_role is null` branch needs someone
    // with no row at all.
    const email = `split-lock-outsider-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: made, error: makeError } = await asService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (makeError || !made.user) throw new Error(`Failed to create outsider: ${makeError?.message}`);
    outsiderId = made.user.id;
    asOutsider = createClient(url, anonKey, { auth: { persistSession: false } });
    const outsiderAuth = await asOutsider.auth.signInWithPassword({ email, password });
    if (outsiderAuth.error) throw new Error(`Outsider sign-in failed: ${outsiderAuth.error.message}`);
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await asService.from("projects").delete().eq("id", id);
    }
    if (outsiderId) await asService.auth.admin.deleteUser(outsiderId);
  });

  /** Blocks until another backend waits on a row this connection's transaction holds. */
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

  /** Blocks until another backend waits on the advisory lock this connection holds. */
  async function waitForLockWaiter(holder: PgClient): Promise<void> {
    const SQL = `
      select count(*)::int as n
        from pg_locks w
        join pg_locks g
          on g.locktype = 'advisory' and g.granted and g.pid = pg_backend_pid()
         and w.classid = g.classid and w.objid = g.objid and w.objsubid = g.objsubid
       where w.locktype = 'advisory' and not w.granted`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { rows } = await holder.query(SQL);
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the RPC never parked on the advisory lock — the test would be vacuous");
  }

  type Fixture = { projectId: string; sourceId: string; anchorId: string };

  async function seed(name: string): Promise<Fixture> {
    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    createdProjectIds.push(project.id);

    const { data: states } = await asService
      .from("project_states")
      .select("id, category, position")
      .eq("project_id", project.id)
      .order("position");
    const unstarted = states!.find((s) => s.category === "unstarted")!.id;

    // Backlog stories: state set, no iteration. `source` is what split_story
    // row-locks; `anchor` is what a concurrent splice shifts.
    const rows = [
      { project_id: project.id, title: "source", story_type: "chore", created_by: ownerId, state_id: unstarted, position: 5 },
      { project_id: project.id, title: "anchor", story_type: "chore", created_by: ownerId, state_id: unstarted, position: 9 },
    ];
    const { data: seeded, error } = await asService.from("stories").insert(rows).select("id, title");
    if (error) throw new Error(`Failed to seed stories: ${error.message}`);
    return {
      projectId: project.id,
      sourceId: seeded!.find((s) => s.title === "source")!.id,
      anchorId: seeded!.find((s) => s.title === "anchor")!.id,
    };
  }

  it("parks on positions while holding NO row lock — the ordering the cycle needs", async () => {
    // Tests the acquisition ORDER directly, because racing two real RPCs cannot.
    // The inverted body only reaches for the advisory lock once it already holds
    // the source row, and nothing outside the function can freeze it in between,
    // so a two-caller race is decided by whoever wins the row and comes out green
    // either way (the lesson recorded on TASK-212).
    //
    // Observable property: hold positions so split_story must park on it, then ask
    // a third session whether the source row is still lockable.
    //   ordered  -> the advisory lock comes first, no row is held, NOWAIT succeeds
    //   inverted -> the row is already held, NOWAIT raises 55P03
    const fx = await seed("split lock order: no row held while parked");

    const lockHolder = new PgClient({ connectionString: DB_URL() });
    const prober = new PgClient({ connectionString: DB_URL() });
    await lockHolder.connect();
    await prober.connect();
    let rowLockable: boolean;
    let probeCode: string | undefined;
    try {
      await lockHolder.query("select pg_advisory_lock(hashtext('positions:' || $1))", [fx.projectId]);

      const pending = Promise.resolve(
        asOwner.rpc("split_story", { p_story_id: fx.sourceId, p_children: [{ title: "child" }] }),
      );

      // Without this the probe could run before the RPC took anything at all and
      // pass vacuously.
      await waitForLockWaiter(lockHolder);

      await prober.query("begin");
      try {
        await prober.query("select id from public.stories where id = $1 for update nowait", [fx.sourceId]);
        rowLockable = true;
      } catch (e) {
        rowLockable = false;
        probeCode = (e as { code?: string }).code;
      }
      await prober.query("rollback");

      await lockHolder.query("select pg_advisory_unlock(hashtext('positions:' || $1))", [fx.projectId]);
      // It has to go on to succeed, not merely to have locked nothing: a function
      // that errored out before either lock would also leave the row free.
      const settled = (await pending) as { error: unknown };
      expect(settled.error).toBeNull();
    } finally {
      await prober.end();
      await lockHolder.end();
    }

    expect({ rowLockable, probeCode }).toEqual({ rowLockable: true, probeCode: undefined });
  }, TIMEOUT);

  it("a backlog quick-add and a concurrent split both complete", async () => {
    // End-to-end over the two real RPCs. It does NOT discriminate the ordering on
    // its own — the case above is what does, and which of the two wins the row is
    // a coin flip — but it is what a user actually does, and it would catch a fix
    // that serialized itself into a hang.
    const fx = await seed("split lock order: quick-add vs split");

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let created: { error: { code?: string } | null };
    let split: { error: { code?: string } | null };
    try {
      await holder.query("begin");
      await holder.query("select id from public.stories where id = $1 for update", [fx.sourceId]);

      // Takes positions, then blocks on the held source row inside the splice.
      const quickAdd = Promise.resolve(
        asOwner.rpc("create_draft_story", {
          p_project_id: fx.projectId,
          p_target: "backlog",
          p_title: "quick add during a split",
          p_anchor: { before: { kind: "story", id: fx.sourceId } },
        }),
      );
      await waitForRowWaiter(holder);

      const splitPending = Promise.resolve(
        asOwner.rpc("split_story", { p_story_id: fx.sourceId, p_children: [{ title: "child" }] }),
      );
      await holder.query("commit");

      created = (await quickAdd) as { error: null };
      split = (await splitPending) as { error: null };
    } finally {
      await holder.end();
    }

    expect(created.error?.code).not.toBe("40P01");
    expect(split.error?.code).not.toBe("40P01");
    expect(created.error).toBeNull();
    expect(split.error).toBeNull();
  }, TIMEOUT);

  it("cannot have the story moved out from under it while it is parked", async () => {
    // Parking on positions is exactly the window between the probe reading
    // project_id and the locked read pinning it, so this is where a project move
    // would land. It cannot: activity_logs_story_project_fk (20260715000006) is a
    // composite FK on (story_id, project_id), and the story.created log every
    // story gets keeps the column referenced. The RPC's own
    // `and project_id = v_project_id` covers the same ground locally.
    const fx = await seed("split lock order: cannot move while parked");
    const { data: elsewhere } = await asOwner
      .from("projects")
      .insert({ name: "split lock order: move destination" })
      .select("id")
      .single();
    createdProjectIds.push(elsewhere!.id);

    const { error: moveError } = await asOwner
      .from("stories")
      .update({ project_id: elsewhere!.id, state_id: null, iteration_id: null })
      .eq("id", fx.sourceId);

    expect(moveError?.code).toBe("23503");
    const { data: still } = await asService.from("stories").select("project_id").eq("id", fx.sourceId).single();
    expect(still!.project_id).toBe(fx.projectId);
  }, TIMEOUT);

  it("refuses a viewer WITHOUT queueing on the project-wide lock", async () => {
    // Hoisting the advisory locks put them ahead of the authoritative FOR UPDATE
    // that rejects a viewer, so without the role gate in front of them this became
    // an RPC where a caller who can merely SEE the story contends for — and
    // briefly holds — a project-wide lock on a call certain to fail.
    //
    // Asserted by outcome rather than by timing: while another session holds the
    // lock, the viewer's call must still SETTLE. With the gate after the lock it
    // cannot, because it is parked until release.
    const fx = await seed("split lock order: viewer does not queue on the lock");
    const { error: demoteError } = await asService
      .from("project_members")
      .update({ role: "viewer" })
      .eq("project_id", fx.projectId)
      .eq("user_id", ownerId);
    expect(demoteError).toBeNull();

    const lockHolder = new PgClient({ connectionString: DB_URL() });
    await lockHolder.connect();
    let outcome: { kind: "settled"; message?: string } | { kind: "parked" };
    try {
      await lockHolder.query("select pg_advisory_lock(hashtext('positions:' || $1))", [fx.projectId]);

      const call = Promise.resolve(
        asOwner.rpc("split_story", { p_story_id: fx.sourceId, p_children: [{ title: "child" }] }),
      ).then((r) => ({
        kind: "settled" as const,
        message: (r as { error: { message?: string } | null }).error?.message,
      }));

      outcome = await Promise.race([
        call,
        new Promise<{ kind: "parked" }>((resolve) => setTimeout(() => resolve({ kind: "parked" }), 4000)),
      ]);

      await lockHolder.query("select pg_advisory_unlock(hashtext('positions:' || $1))", [fx.projectId]);
      await call;
    } finally {
      await lockHolder.end();
    }

    expect(outcome).toEqual({ kind: "settled", message: "Story not found" });
  }, TIMEOUT);

  it("refuses a NON-MEMBER without queueing either — the branch a viewer cannot reach", async () => {
    // project_role returns NULL for a caller with no project_members row, and
    // `NULL = any(v_roles)` is NULL, which `if` reads as false. So the gate needs
    // its `is null` test: written as `if not (v_role = any(v_roles))` it never
    // fires for a non-member, and the project-wide lock this migration guarded
    // reopens to anyone who can guess a story id. The viewer case above passes
    // against that spelling, which is why this one exists.
    const fx = await seed("split lock order: non-member does not queue");

    const lockHolder = new PgClient({ connectionString: DB_URL() });
    await lockHolder.connect();
    let outcome: { kind: "settled"; message?: string } | { kind: "parked" };
    try {
      await lockHolder.query("select pg_advisory_lock(hashtext('positions:' || $1))", [fx.projectId]);

      const call = Promise.resolve(
        asOutsider.rpc("split_story", { p_story_id: fx.sourceId, p_children: [{ title: "child" }] }),
      ).then((r) => ({
        kind: "settled" as const,
        message: (r as { error: { message?: string } | null }).error?.message,
      }));

      outcome = await Promise.race([
        call,
        new Promise<{ kind: "parked" }>((resolve) => setTimeout(() => resolve({ kind: "parked" }), 4000)),
      ]);

      await lockHolder.query("select pg_advisory_unlock(hashtext('positions:' || $1))", [fx.projectId]);
      await call;
    } finally {
      await lockHolder.end();
    }

    expect(outcome).toEqual({ kind: "settled", message: "Story not found" });
    const { count } = await asService
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", fx.sourceId);
    expect(count).toBe(0);
  }, TIMEOUT);

  it("tells a non-member and a missing story apart from each other in no way", async () => {
    // The pre-lock probe is SECURITY DEFINER, so unlike set_story_state's it is NOT
    // RLS-filtered: it sees every story in every project. The gate is what stops it
    // becoming an existence oracle, and that only holds while both raises stay
    // byte-identical — hence comparing them rather than asserting each separately.
    const fx = await seed("split lock order: no existence oracle");
    const { error: demoteError } = await asService
      .from("project_members")
      .update({ role: "viewer" })
      .eq("project_id", fx.projectId)
      .eq("user_id", ownerId);
    expect(demoteError).toBeNull();

    const asViewer = await asOwner.rpc("split_story", {
      p_story_id: fx.sourceId,
      p_children: [{ title: "child" }],
    });
    const asNonMember = await asOutsider.rpc("split_story", {
      p_story_id: fx.sourceId,
      p_children: [{ title: "child" }],
    });
    const missing = await asOwner.rpc("split_story", {
      p_story_id: "00000000-0000-0000-0000-000000000000",
      p_children: [{ title: "child" }],
    });

    expect(missing.error?.message).toBe("Story not found");
    // Bare `raise exception`, matching the FOR UPDATE read's — deliberately not
    // set_story_state's P0002.
    expect(missing.error?.code).toBe("P0001");
    const identical = { message: missing.error?.message, code: missing.error?.code };
    expect({ message: asViewer.error?.message, code: asViewer.error?.code }).toEqual(identical);
    expect({ message: asNonMember.error?.message, code: asNonMember.error?.code }).toEqual(identical);
  }, TIMEOUT);
});
