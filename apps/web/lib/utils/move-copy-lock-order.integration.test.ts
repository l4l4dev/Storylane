import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// move_story_to_project and copy_story_to_project row-locked the source story and
// only then took story_number:<target>. On its own that never cycled — every RPC
// took the row first — but once split_story was fixed to lock before reading, the
// two orders compose into a four-party cycle across two projects:
//
//   move S A→B   holds row S,   waits story_number:B
//   split T      holds number B, waits row T
//   move T B→A   holds row T,   waits story_number:A
//   split S      holds number A, waits row S
//
// Reproducing that as a race needs four transactions to interleave in one order
// out of many, so what is asserted here is the property that rules it out: no
// advisory lock is taken while a story row is already held.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/move-copy-lock-order.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const TIMEOUT = 30_000;
const DB_URL = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe.skipIf(!RUN)("move/copy_story_to_project lock order (integration)", () => {
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

  for (const rpc of ["move_story_to_project", "copy_story_to_project"] as const) {
    it(`${rpc} parks on story_number:<target> while holding NO source row lock`, async () => {
      // ordered  -> the advisory lock comes first, no row is held, NOWAIT succeeds
      // inverted -> the source row is already held, NOWAIT raises 55P03
      const source = await createProject(`${rpc} lock order source`);
      const target = await createProject(`${rpc} lock order target`);
      const { data: story, error: seedError } = await asService
        .from("stories")
        .insert({ project_id: source, title: "crosses projects", story_type: "chore", created_by: ownerId })
        .select("id")
        .single();
      expect(seedError).toBeNull();

      const lockHolder = new PgClient({ connectionString: DB_URL() });
      const prober = new PgClient({ connectionString: DB_URL() });
      await lockHolder.connect();
      await prober.connect();
      let rowLockable: boolean;
      let probeCode: string | undefined;
      try {
        await lockHolder.query("select pg_advisory_lock(hashtext('story_number:' || $1))", [target]);

        const pending = Promise.resolve(
          asOwner.rpc(rpc, { p_story_id: story!.id, p_target_project_id: target }),
        );
        await waitForLockWaiter(lockHolder);

        await prober.query("begin");
        try {
          await prober.query("select id from public.stories where id = $1 for update nowait", [story!.id]);
          rowLockable = true;
        } catch (e) {
          rowLockable = false;
          probeCode = (e as { code?: string }).code;
        }
        await prober.query("rollback");

        await lockHolder.query("select pg_advisory_unlock(hashtext('story_number:' || $1))", [target]);
        // It has to go on to succeed, not merely to have locked nothing: a call
        // rejected before either lock would also leave the row free.
        const settled = (await pending) as { error: unknown };
        expect(settled.error).toBeNull();
      } finally {
        await prober.end();
        await lockHolder.end();
      }

      expect({ rowLockable, probeCode }).toEqual({ rowLockable: true, probeCode: undefined });
    }, TIMEOUT);
  }

  it("still hides a viewer of the source behind the read's generic not-found", async () => {
    // The target membership check now runs before the locked read, so without the
    // source gate ahead of it a viewer of the source would be told about its target
    // membership instead — which is what previously kept viewer-of-source
    // indistinguishable from non-member.
    const source = await createProject("move lock order: viewer source");
    const target = await createProject("move lock order: viewer target");
    const { data: story } = await asService
      .from("stories")
      .insert({ project_id: source, title: "not the viewer's to move", story_type: "chore", created_by: ownerId })
      .select("id")
      .single();

    const email = `move-lock-order-viewer-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: made, error: makeError } = await asService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (makeError || !made.user) throw new Error(`Failed to create viewer: ${makeError?.message}`);
    await asService.from("project_members").insert({ project_id: source, user_id: made.user.id, role: "viewer" });
    const asViewer = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error: signInError } = await asViewer.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`Viewer sign-in failed: ${signInError.message}`);

    try {
      const { error } = await asViewer.rpc("move_story_to_project", {
        p_story_id: story!.id,
        p_target_project_id: target,
      });
      expect(error?.message).toBe("Story not found");
    } finally {
      await asService.auth.admin.deleteUser(made.user.id);
    }
  }, TIMEOUT);
});
