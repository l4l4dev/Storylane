import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// activity_logs.created_at used to default to now(), which is fixed for a
// whole transaction. Two writes to the same story could therefore be read back
// in an order that never happened: both transactions start, they serialize on
// the story row lock, and the one that STARTED later can commit first while
// still carrying the earlier timestamp. 20260802000000 switches the default to
// clock_timestamp(), which is evaluated per statement, so a transaction parked
// on the row lock stamps its row only after the blocker commits.
//
// The test drives two raw pg connections because supabase-js cannot hold a row
// lock across statements. Session B starts LAST but takes the lock FIRST, so
// under now() its row sorts after A's while having committed before it.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/activity-log-causal-order.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

// Read at connect time, not import time: .env.local is only loaded in
// beforeAll, so a module-level const would bake in the fallback and silently
// point the pg clients at a different database than `admin` writes to.
const dbUrl = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TIMEOUT = 30_000;

describe.skipIf(!RUN)("activity_logs causal ordering (integration)", () => {
  let admin: SupabaseClient;
  let ownerId: string;
  let projectId: string;

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
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: auth, error } = await anon.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (error || !auth.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${error?.message}`);
    }
    ownerId = auth.user.id;

    const { data: project, error: projectError } = await admin
      .from("projects")
      .insert({ name: "activity_logs causal order test", created_by: ownerId })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
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

  async function seedStory() {
    const { data: states } = await admin.from("project_states").select("id, name").eq("project_id", projectId);
    const { data: story, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        title: "concurrently re-estimated",
        story_type: "feature",
        points: 1,
        state_id: (states ?? []).find((s) => s.name === "Unstarted")?.id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !story) throw new Error(`Failed to seed story: ${error?.message}`);
    return story.id as string;
  }

  it("orders two contending re-estimates by when they applied, not when they began", async () => {
    const storyId = await seedStory();
    const a = new PgClient({ connectionString: dbUrl() });
    const b = new PgClient({ connectionString: dbUrl() });
    await a.connect();
    await b.connect();

    try {
      // A begins first, so under now() it owns the earlier transaction
      // timestamp — but it does not touch the row yet.
      await a.query("begin");
      await a.query("select 1");

      // B begins second, takes the row lock, and commits first.
      await b.query("begin");
      await b.query("update public.stories set points = 5 where id = $1", [storyId]);
      await b.query("commit");

      // A only now applies its own re-estimate, on top of B's.
      await a.query("update public.stories set points = 8 where id = $1", [storyId]);
      await a.query("commit");

      const { rows } = await a.query(
        `select payload->>'from' as from_points, payload->>'to' as to_points
           from public.activity_logs
          where story_id = $1 and action = 'story.points_changed'
          order by created_at, id`,
        [storyId],
      );

      // Read in apply order the chain is 1 -> 5 -> 8. Read in transaction-start
      // order it is 1 -> 8 -> 5: a broken chain ending on an estimate that was
      // never current.
      expect(rows.map((row) => [row.from_points, row.to_points])).toEqual([
        ["1", "5"],
        ["5", "8"],
      ]);
    } finally {
      await a.end();
      await b.end();
    }
  }, TIMEOUT);

  it("keeps a blocked writer's row after the writer it waited on", async () => {
    const storyId = await seedStory();
    const a = new PgClient({ connectionString: dbUrl() });
    const b = new PgClient({ connectionString: dbUrl() });
    await a.connect();
    await b.connect();

    try {
      // B begins FIRST, so under now() it owns the earlier timestamp — but it
      // is the one that ends up waiting.
      await b.query("begin");
      await b.query("select 1");

      // A begins second, takes the row lock, and B parks behind it.
      await a.query("begin");
      await a.query("update public.stories set points = 3 where id = $1", [storyId]);

      // Swallow here, await below: if the commit throws, `finally` ends the
      // connection and this promise rejects with nobody listening, which
      // surfaces as an unhandled rejection against an unrelated test.
      const blocked = b.query("update public.stories set points = 13 where id = $1", [storyId]).catch(() => {});
      // Poll pg_locks rather than sleeping — a fixed delay that elapses before
      // B reaches the server would leave it never blocked, quietly turning this
      // into a copy of the case above while still passing.
      await waitForRowWaiter(a);

      await a.query("commit");
      await blocked;
      await b.query("commit");

      const { rows } = await a.query(
        `select payload->>'from' as from_points, payload->>'to' as to_points
           from public.activity_logs
          where story_id = $1 and action = 'story.points_changed'
          order by created_at, id`,
        [storyId],
      );
      expect(rows.map((row) => [row.from_points, row.to_points])).toEqual([
        ["1", "3"],
        ["3", "13"],
      ]);
    } finally {
      await a.end();
      await b.end();
    }
  }, TIMEOUT);
});
