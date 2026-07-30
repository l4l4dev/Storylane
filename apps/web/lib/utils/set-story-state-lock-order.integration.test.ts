import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// set_story_state used to take the story's row lock and only then ask for
// iteration_finalize:<project>, the reverse of every other board RPC. Two callers
// on one story could each hold half the pair:
//
//   set_story_state   holds the story row, waits for iteration_finalize
//   move_story_board  holds iteration_finalize, waits for the story row
//
// Postgres resolves that by aborting one with 40P01.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/set-story-state-lock-order.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const TIMEOUT = 30_000;
const DB_URL = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe.skipIf(!RUN)("set_story_state lock order (integration)", () => {
  let asOwner: SupabaseClient;
  let asService: SupabaseClient;
  let ownerId: string;
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
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await asService.from("projects").delete().eq("id", id);
    }
  });

  async function createProject(name: string): Promise<string> {
    const { data, error } = await asOwner.from("projects").insert({ name }).select("id").single();
    if (error || !data) throw new Error(`Failed to create test project: ${error?.message}`);
    createdProjectIds.push(data.id);
    return data.id;
  }

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

  type Fixture = { projectId: string; anchorId: string; moverId: string; inProgressId: string };

  async function seed(name: string): Promise<Fixture> {
    const projectId = await createProject(name);
    const { data: states } = await asService
      .from("project_states")
      .select("id, category, position")
      .eq("project_id", projectId)
      .order("position");
    const unstarted = states!.find((s) => s.category === "unstarted")!.id;
    const inProgressId = states!.find((s) => s.category === "in_progress")!.id;

    // Two backlog stories: state set, no iteration. The anchor is the row a
    // splice's position shift updates, which is also what set_story_state locks.
    const rows = [
      { project_id: projectId, title: "anchor", story_type: "chore", created_by: ownerId, state_id: unstarted, position: 5 },
      { project_id: projectId, title: "mover", story_type: "chore", created_by: ownerId, state_id: unstarted, position: 9 },
    ];
    const { data: seeded, error } = await asService.from("stories").insert(rows).select("id, title");
    if (error) throw new Error(`Failed to seed stories: ${error.message}`);
    return {
      projectId,
      anchorId: seeded!.find((s) => s.title === "anchor")!.id,
      moverId: seeded!.find((s) => s.title === "mover")!.id,
      inProgressId,
    };
  }

  it("parks on iteration_finalize while holding NO row lock — the ordering the cycle needs", async () => {
    // Tests the acquisition ORDER directly, because racing two real RPCs cannot.
    // The inverted body only reaches for the advisory lock once it already holds
    // the row, and nothing outside the function can freeze it in between, so a
    // two-caller race is decided by whoever wins the row and comes out green
    // either way. An earlier version of this file did exactly that and passed
    // against the inverted body, which is why it is written this way instead.
    //
    // Observable property: hold iteration_finalize so set_story_state must park
    // on it, then ask a third session whether the story row is still lockable.
    //   ordered  -> the advisory lock comes first, no row is held, NOWAIT succeeds
    //   inverted -> the row is already held, NOWAIT raises 55P03
    // The target is an in_progress state entered from no iteration, the one branch
    // the inverted body took the lock on at all.
    const fx = await seed("lock order: no row held while parked");
    // The project needs a current iteration, or the transition raises "No active
    // iteration" under BOTH orderings and the assertion below never gets to speak.
    const seeded = await asOwner.rpc("finalize_iteration", { p_project_id: fx.projectId, p_manual: false });
    expect(seeded.error).toBeNull();

    const lockHolder = new PgClient({ connectionString: DB_URL() });
    const prober = new PgClient({ connectionString: DB_URL() });
    await lockHolder.connect();
    await prober.connect();
    let rowLockable: boolean;
    let probeCode: string | undefined;
    try {
      await lockHolder.query("select pg_advisory_lock(hashtext('iteration_finalize:' || $1))", [fx.projectId]);

      const pending = Promise.resolve(
        asOwner.rpc("set_story_state", { p_story_id: fx.anchorId, p_state_id: fx.inProgressId }),
      );

      // Without this the probe could run before the RPC took anything at all and
      // pass vacuously.
      await waitForLockWaiter(lockHolder);

      await prober.query("begin");
      try {
        await prober.query("select id from public.stories where id = $1 for update nowait", [fx.anchorId]);
        rowLockable = true;
      } catch (e) {
        rowLockable = false;
        probeCode = (e as { code?: string }).code;
      }
      await prober.query("rollback");

      await lockHolder.query("select pg_advisory_unlock(hashtext('iteration_finalize:' || $1))", [fx.projectId]);
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

  it("a backlog quick-add and a concurrent state transition both complete", async () => {
    // End-to-end over the two real RPCs. It does NOT discriminate the ordering on
    // its own — the case above is what does — but it is what a user actually does,
    // and it would catch a fix that serialized itself into a hang.
    const fx = await seed("lock order: quick-add vs transition");
    // Without an active iteration, entering an in_progress state always fails
    // with "No active iteration" — the transition assertion below would pass on
    // a broken lock order just as easily as a working one.
    const seeded = await asOwner.rpc("finalize_iteration", { p_project_id: fx.projectId, p_manual: false });
    expect(seeded.error).toBeNull();

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let created: { error: { code?: string } | null };
    let transition: { error: { code?: string } | null };
    try {
      await holder.query("begin");
      await holder.query("select id from public.stories where id = $1 for update", [fx.anchorId]);

      const quickAdd = Promise.resolve(
        asOwner.rpc("create_draft_story", {
          p_project_id: fx.projectId,
          p_target: "backlog",
          p_title: "quick add during a transition",
          p_anchor: { before: { kind: "story", id: fx.anchorId } },
        }),
      );
      await waitForRowWaiter(holder);

      const transitionPending = Promise.resolve(
        asOwner.rpc("set_story_state", { p_story_id: fx.anchorId, p_state_id: fx.inProgressId }),
      );
      await holder.query("commit");

      created = (await quickAdd) as { error: null };
      transition = (await transitionPending) as { error: null };
    } finally {
      await holder.end();
    }

    expect(created.error?.code).not.toBe("40P01");
    expect(transition.error?.code).not.toBe("40P01");
    expect(created.error).toBeNull();
    expect(transition.error).toBeNull();

    const { data: rows } = await asService
      .from("stories")
      .select("id")
      .eq("project_id", fx.projectId)
      .eq("title", "quick add during a transition");
    expect(rows ?? []).toHaveLength(1);
  }, TIMEOUT);

  it("still auto-assigns the current iteration when entering an in_progress state", async () => {
    // The lock moved out of the branch that used to take it, so that branch's
    // behaviour needs holding down: the story lands in the current iteration, and
    // is refused when there is none.
    const fx = await seed("lock order: auto-assign preserved");

    const before = await asOwner.rpc("set_story_state", {
      p_story_id: fx.moverId,
      p_state_id: fx.inProgressId,
    });
    expect(before.error?.message).toMatch(/no active iteration/i);

    const seeded = await asOwner.rpc("finalize_iteration", { p_project_id: fx.projectId, p_manual: false });
    expect(seeded.error).toBeNull();
    const { data: current } = await asService
      .from("iterations")
      .select("id")
      .eq("project_id", fx.projectId)
      .neq("state", "done")
      .single();

    const after = await asOwner.rpc("set_story_state", {
      p_story_id: fx.moverId,
      p_state_id: fx.inProgressId,
    });
    expect(after.error).toBeNull();

    const { data: story } = await asService
      .from("stories")
      .select("state_id, iteration_id")
      .eq("id", fx.moverId)
      .single();
    expect(story).toEqual({ state_id: fx.inProgressId, iteration_id: current!.id });
  }, TIMEOUT);

  it("still reports a missing story as not found, through the unlocked key read", async () => {
    // That read replaced a `perform 1 ... if not found` probe, so it has to keep
    // producing P0002 rather than failing inside hashtext on a null key.
    const { error } = await asOwner.rpc("set_story_state", {
      p_story_id: "00000000-0000-0000-0000-000000000000",
      p_state_id: null,
    });

    expect(error?.code).toBe("P0002");
    expect(error?.message).toMatch(/story not found/i);
  }, TIMEOUT);

  it("refuses a viewer WITHOUT queueing on the project-wide lock", async () => {
    // Hoisting the advisory lock put it ahead of the authoritative FOR UPDATE that
    // rejects a viewer, so without an authorization gate in front of the lock this
    // became the one RPC where a caller who can merely SEE the story contends for
    // — and briefly holds — a project-wide lock on a call certain to fail.
    //
    // Asserted by outcome rather than by timing: while another session holds the
    // lock, the viewer's call must still SETTLE. With the gate after the lock it
    // cannot, because it is parked until release.
    const fx = await seed("lock order: viewer does not queue on the lock");
    const { error: demoteError } = await asService
      .from("project_members")
      .update({ role: "viewer" })
      .eq("project_id", fx.projectId)
      .eq("user_id", ownerId);
    expect(demoteError).toBeNull();

    const lockHolder = new PgClient({ connectionString: DB_URL() });
    await lockHolder.connect();
    let outcome: { kind: "settled"; code?: string } | { kind: "parked" };
    try {
      await lockHolder.query("select pg_advisory_lock(hashtext('iteration_finalize:' || $1))", [fx.projectId]);

      const call = Promise.resolve(
        asOwner.rpc("set_story_state", { p_story_id: fx.moverId, p_state_id: fx.inProgressId }),
      ).then((r) => ({ kind: "settled" as const, code: (r as { error: { code?: string } | null }).error?.code }));

      outcome = await Promise.race([
        call,
        new Promise<{ kind: "parked" }>((resolve) => setTimeout(() => resolve({ kind: "parked" }), 4000)),
      ]);

      await lockHolder.query("select pg_advisory_unlock(hashtext('iteration_finalize:' || $1))", [fx.projectId]);
      await call;
    } finally {
      await lockHolder.end();
    }

    expect(outcome).toEqual({ kind: "settled", code: "42501" });
  }, TIMEOUT);

  it("still refuses a caller who can read but not write the story", async () => {
    // The authoritative FOR UPDATE is what filters a viewer to zero rows, and it
    // now runs after an unlocked read that a viewer CAN see. So the unlocked read
    // must not be mistaken for authorization.
    const fx = await seed("lock order: viewer still refused");
    const { error: demoteError } = await asService
      .from("project_members")
      .update({ role: "viewer" })
      .eq("project_id", fx.projectId)
      .eq("user_id", ownerId);
    expect(demoteError).toBeNull();

    const { error } = await asOwner.rpc("set_story_state", {
      p_story_id: fx.moverId,
      p_state_id: fx.inProgressId,
    });

    expect(error?.code).toBe("42501");
    const { data: story } = await asService.from("stories").select("state_id").eq("id", fx.moverId).single();
    expect(story!.state_id).not.toBe(fx.inProgressId);
  }, TIMEOUT);
});
