import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-135: verifies the one-time backfill of TASK-111's iteration-wide
// position sequence (supabase/migrations/20260722000013_backfill_iteration_
// wide_story_positions.sql) against a fixture with pre-existing per-column
// overlapping positions — the exact legacy shape the migration exists to fix.
//
// The migration already ran at reset, so this reconstructs the legacy overlap
// in a fresh iteration (inserting stories with explicit colliding positions,
// which only a pre-TASK-111 write could produce) and runs the SAME ranking
// statement, scoped to this project for test isolation.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/backfill-iteration-positions.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

// Mirrors 20260722000013's ranking exactly, with a project scope added so the
// test never renumbers a sibling test's iterations. If the migration's ordering
// changes, this must change with it.
const BACKFILL_SQL = `
with ranked as (
  select
    s.id,
    row_number() over (
      partition by s.project_id, s.iteration_id
      order by s.position, coalesce(ps.position, 2147483647), s.id
    ) - 1 as new_pos
  from public.stories s
  left join public.project_states ps on ps.id = s.state_id
  where s.iteration_id is not null and s.project_id = $1
)
update public.stories s
set position = r.new_pos
from ranked r
where s.id = r.id and s.position is distinct from r.new_pos`;

describe.skipIf(!RUN)("iteration-wide position backfill (TASK-135 integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  let projectId: string;
  let pg: PgClient;
  let stateByName: Record<string, string> = {};

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
    ownerId = auth.data.user.id;

    const { data: project, error } = await owner.from("projects").insert({ name: "position backfill test" }).select("id").single();
    if (error || !project) throw new Error(`Failed to create project: ${error?.message}`);
    projectId = project.id;

    // A current iteration (iterations INSERT is RPC-only, TASK-110).
    const seed = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    if (seed.error) throw new Error(`Failed to seed iteration: ${seed.error.message}`);

    const { data: states } = await admin.from("project_states").select("id, name").eq("project_id", projectId);
    stateByName = Object.fromEntries((states ?? []).map((s) => [s.name, s.id]));

    pg = new PgClient({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await pg.connect();
  });

  afterAll(async () => {
    if (pg) await pg.end();
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
  });

  async function iterationId(): Promise<string> {
    const { data } = await admin
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .order("number", { ascending: false })
      .limit(1)
      .single();
    return data!.id;
  }

  // Inserts a story directly with an explicit (state, position) — the legacy
  // per-column shape that predates move_story_board's iteration-wide sequence.
  async function insertStory(iteration: string, stateName: string, position: number, title: string): Promise<string> {
    const { data, error } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        iteration_id: iteration,
        state_id: stateByName[stateName],
        position,
        title,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to insert story: ${error?.message}`);
    return data.id;
  }

  async function positionsById(): Promise<Map<string, number>> {
    const { data } = await admin.from("stories").select("id, position").eq("project_id", projectId);
    return new Map((data ?? []).map((s) => [s.id, s.position]));
  }

  it("renumbers overlapping per-column positions into one dense iteration-wide sequence", async () => {
    const iter = await iterationId();
    // Classic states: Unstarted (col 0), Started (col 1), Finished (col 2).
    // Two 0-based per-column runs that OVERLAP across columns:
    const a = await insertStory(iter, "Unstarted", 0, "A");
    const b = await insertStory(iter, "Unstarted", 1, "B");
    const c = await insertStory(iter, "Started", 0, "C"); // overlaps A at 0
    const d = await insertStory(iter, "Started", 1, "D"); // overlaps B at 1
    const e = await insertStory(iter, "Finished", 0, "E"); // overlaps A, C at 0

    await pg.query(BACKFILL_SQL, [projectId]);

    const pos = await positionsById();
    // Primary by position, ties broken by state column (left-to-right):
    //   position 0 → A(col0), C(col1), E(col2)
    //   position 1 → B(col0), D(col1)
    // => A,C,E,B,D as 0,1,2,3,4.
    expect([pos.get(a), pos.get(c), pos.get(e), pos.get(b), pos.get(d)]).toEqual([0, 1, 2, 3, 4]);

    // Dense: exactly 0..4, no gaps, no duplicates.
    expect([...pos.values()].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });

  it("is idempotent — a second run changes nothing", async () => {
    const before = await positionsById();
    const result = await pg.query(BACKFILL_SQL, [projectId]);
    expect(result.rowCount).toBe(0); // no rows moved
    const after = await positionsById();
    for (const [id, p] of before) expect(after.get(id)).toBe(p);
  });

  it("leaves backlog stories (iteration_id null) untouched", async () => {
    // A backlog story with a deliberately "colliding-looking" position that the
    // iteration-scoped backfill must not renumber.
    const { data: backlog } = await admin
      .from("stories")
      .insert({ project_id: projectId, iteration_id: null, state_id: null, position: 0, title: "Backlog", created_by: ownerId })
      .select("id")
      .single();

    await pg.query(BACKFILL_SQL, [projectId]);

    const { data } = await admin.from("stories").select("position").eq("id", backlog!.id).single();
    expect(data!.position).toBe(0); // unchanged
  });
});
