import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-87 (doc-8 §3-§5): the cadence rules live in SQL — the trigger that
// logs a cadence change, the override RPC's advisory lock, and the 1-day
// working-day selection inside finalize_iteration — so only a real DB proves
// them. Same opt-in gate as the other integration suites:
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/flexible-cadence.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) with the seeded dev user.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type Iteration = {
  id: string;
  number: number;
  start_date: string;
  end_date: string;
  state: string;
};

const MS_PER_DAY = 86_400_000;

/** ISO weekday (1=Mon .. 7=Sun) of a YYYY-MM-DD string, read as a wall date. */
function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

describe.skipIf(!RUN)("flexible cadence (integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  const projectIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // .env.local not found — the explicit check below fails loudly instead.
      }
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set");
    }

    supabase = createClient(url, anonKey);
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (authError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${authError.message}`);
    }
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await supabase.from("projects").delete().eq("id", id);
    }
  });

  async function createProject(name: string, fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await supabase
      .from("projects")
      .insert({ name, ...fields })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Failed to create test project: ${error?.message}`);
    }
    projectIds.push(data.id);
    return data.id;
  }

  async function iterationsOf(projectId: string): Promise<Iteration[]> {
    const { data } = await supabase
      .from("iterations")
      .select("id, number, start_date, end_date, state")
      .eq("project_id", projectId)
      .order("number", { ascending: true });
    return (data ?? []) as Iteration[];
  }

  async function finish(projectId: string, iterationId: string) {
    const { error } = await supabase.rpc("finalize_iteration", {
      p_project_id: projectId,
      p_manual: true,
      p_iteration_id: iterationId,
    });
    expect(error).toBeNull();
  }

  it("applies a cadence change to the next iteration only, and logs it (AC #1)", async () => {
    const projectId = await createProject("cadence change", { iteration_length: 14 });

    await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    const [first] = await iterationsOf(projectId);
    expect(daysBetween(first.start_date, first.end_date)).toBe(13);

    const { error: updateError } = await supabase
      .from("projects")
      .update({ iteration_length: 7 })
      .eq("id", projectId);
    expect(updateError).toBeNull();

    // The running iteration keeps the length it was created with.
    const [unchanged] = await iterationsOf(projectId);
    expect(unchanged.end_date).toBe(first.end_date);

    await finish(projectId, first.id);
    const [, second] = await iterationsOf(projectId);
    expect(daysBetween(second.start_date, second.end_date)).toBe(6);

    const { data: logs } = await supabase
      .from("activity_logs")
      .select("action, payload")
      .eq("project_id", projectId)
      .eq("action", "project.cadence_changed");
    expect(logs).toHaveLength(1);
    expect(logs?.[0].payload).toEqual({ from: 14, to: 7 });
  });

  it("overrides one iteration's end date without touching the cadence (AC #2)", async () => {
    const projectId = await createProject("length override", { iteration_length: 14 });

    await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    const [first] = await iterationsOf(projectId);
    const stretched = new Date(Date.parse(`${first.end_date}T00:00:00Z`) + 7 * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);

    const { error } = await supabase.rpc("override_iteration_length", {
      p_iteration_id: first.id,
      p_end_date: stretched,
    });
    expect(error).toBeNull();

    const [overridden] = await iterationsOf(projectId);
    expect(overridden.end_date).toBe(stretched);
    expect(overridden.start_date).toBe(first.start_date);

    // A past end date is rejected: the next lazy rollover would finalize the
    // iteration, making this an unconfirmed "Finish iteration".
    const { error: backwards } = await supabase.rpc("override_iteration_length", {
      p_iteration_id: first.id,
      p_end_date: "2000-01-01",
    });
    expect(backwards?.message).toContain("or in the past");

    // And so is a span past the 90-day ceiling projects.iteration_length has.
    const { error: tooLong } = await supabase.rpc("override_iteration_length", {
      p_iteration_id: first.id,
      p_end_date: new Date(Date.parse(`${first.start_date}T00:00:00Z`) + 90 * MS_PER_DAY)
        .toISOString()
        .slice(0, 10),
    });
    expect(tooLong?.message).toContain("longer than 90 days");

    // The boundary move is auditable, same as a settings-level cadence change.
    const { data: overrideLogs } = await supabase
      .from("activity_logs")
      .select("action, payload")
      .eq("project_id", projectId)
      .eq("action", "iteration.length_overridden");
    expect(overrideLogs).toHaveLength(1);
    expect(overrideLogs?.[0].payload).toMatchObject({
      number: first.number,
      from: first.end_date,
      to: stretched,
    });

    // Re-sending the same end date is not a move: no second history row.
    const { data: unchanged } = await supabase.rpc("override_iteration_length", {
      p_iteration_id: first.id,
      p_end_date: stretched,
    });
    expect(unchanged).toMatchObject({ kind: "unchanged" });
    const { data: afterResend } = await supabase
      .from("activity_logs")
      .select("action")
      .eq("project_id", projectId)
      .eq("action", "iteration.length_overridden");
    expect(afterResend).toHaveLength(1);

    // The cadence itself is untouched: the successor is a normal 14-day row.
    await finish(projectId, first.id);
    const [, second] = await iterationsOf(projectId);
    expect(daysBetween(second.start_date, second.end_date)).toBe(13);

    // A finished iteration reports a no-op rather than moving (the outcome a
    // rollover racing an override produces).
    const { data: noop } = await supabase.rpc("override_iteration_length", {
      p_iteration_id: first.id,
      p_end_date: stretched,
    });
    expect(noop).toMatchObject({ kind: "noop", reason: "already_finished" });
  });

  it("keeps concurrent override and finalize from corrupting boundaries (AC #2)", async () => {
    const projectId = await createProject("override race", { iteration_length: 14 });

    await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    const [first] = await iterationsOf(projectId);
    const stretched = new Date(Date.parse(`${first.end_date}T00:00:00Z`) + 7 * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);

    // Both take the same advisory lock, so one fully precedes the other.
    await Promise.all([
      supabase.rpc("override_iteration_length", { p_iteration_id: first.id, p_end_date: stretched }),
      supabase.rpc("finalize_iteration", {
        p_project_id: projectId,
        p_manual: true,
        p_iteration_id: first.id,
      }),
    ]);

    const rows = await iterationsOf(projectId);
    // Whichever won, the chain stays contiguous and gap-free: every row starts
    // the day after its predecessor ends, and no row ends before it starts.
    for (const row of rows) {
      expect(daysBetween(row.start_date, row.end_date)).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < rows.length; i++) {
      expect(daysBetween(rows[i - 1].end_date, rows[i].start_date)).toBe(1);
    }
  });

  // TASK-116 (doc-13 finding #8): override_iteration_length re-checks the
  // caller's project role AFTER acquiring the advisory lock, not only before.
  // A raw pg connection holds the same lock (session-level) so the RPC blocks
  // AFTER passing its pre-lock check; the owner is de-membered while it waits,
  // and the post-lock re-check must then reject it. Without the re-check the
  // stretch would silently commit. Needs a real Postgres connection because
  // supabase-js (PostgREST) can't hold an advisory lock across statements.
  it("rejects an override when the caller is de-membered while blocked on the lock (AC #2)", async () => {
    const projectId = await createProject("override role-revoke race", { iteration_length: 14 });
    await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    const [first] = await iterationsOf(projectId);
    // A valid stretch that would succeed if the caller were still a member —
    // so a failure can only come from the post-lock re-check, not the bounds.
    const stretched = new Date(Date.parse(`${first.end_date}T00:00:00Z`) + 7 * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ownerId = user!.id;

    const holder = new PgClient({
      connectionString:
        process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await holder.connect();
    try {
      // Hold the exact lock override_iteration_length takes (session-level, so
      // it outlives a single statement and conflicts with the RPC's xact lock).
      await holder.query("select pg_advisory_lock(hashtext('iteration_finalize:' || $1))", [projectId]);

      // Fire the override without awaiting its RESULT: it passes the pre-lock
      // membership check, then blocks on pg_advisory_xact_lock behind our held
      // lock. Promise.resolve assimilates the thenable, which is what actually
      // dispatches the request — supabase-js's builder is LAZY and only issues
      // the HTTP call from its own .then(), so holding it unawaited would send
      // nothing and the revoke below would beat the RPC to the pre-lock guard,
      // asserting that instead of the post-lock re-check (TASK-142).
      const overridePromise = Promise.resolve(
        supabase.rpc("override_iteration_length", {
          p_iteration_id: first.id,
          p_end_date: stretched,
        }),
      );
      // Give the request time to reach the DB and park on the lock.
      await new Promise((r) => setTimeout(r, 400));

      // Revoke the owner's membership while the RPC is parked.
      const { error: revokeError } = await admin
        .from("project_members")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", ownerId);
      expect(revokeError).toBeNull();

      // Release the lock so the parked RPC proceeds to its post-lock re-check.
      await holder.query("select pg_advisory_unlock(hashtext('iteration_finalize:' || $1))", [projectId]);

      const { error } = await overridePromise;
      expect(error?.code).toBe("42501"); // require_project_role: 'not authorized'

      // The stretch never landed — end date is unchanged.
      const { data: after } = await admin
        .from("iterations")
        .select("end_date")
        .eq("id", first.id)
        .single();
      expect(after!.end_date).toBe(first.end_date);
    } finally {
      await holder.end();
      // Owner was removed, so the afterAll owner-scoped delete can't reach this
      // project — clean it up with the service role here.
      await admin.from("projects").delete().eq("id", projectId);
    }
  });

  it("lands 1-day iterations on working days and covers the weekend (AC #3)", async () => {
    const projectId = await createProject("one day cadence", {
      iteration_length: 1,
      working_weekdays: [1, 2, 3, 4, 5],
    });

    // Asserted on the boundaries each row is CREATED with, reported by the
    // RPC's 'started' events — not on the stored rows afterwards. Finishing
    // a not-yet-started iteration skips it (end_date := start_date), which
    // is the pre-existing skip rule, and this test walks forward by finishing
    // repeatedly within a single real day.
    const started: { start_date: string; end_date: string }[] = [];

    async function collect(iterationId?: string) {
      const { data, error } = await supabase.rpc("finalize_iteration", {
        p_project_id: projectId,
        p_manual: iterationId !== undefined,
        p_iteration_id: iterationId ?? null,
      });
      expect(error).toBeNull();
      for (const event of (data ?? []) as { kind: string; start_date: string; end_date: string }[]) {
        if (event.kind === "started") {
          started.push({ start_date: event.start_date, end_date: event.end_date });
        }
      }
    }

    await collect();
    // Walk two full weeks so a Friday is always among them, whatever day the
    // suite runs on.
    for (let i = 0; i < 12; i++) {
      const rows = await iterationsOf(projectId);
      await collect(rows[rows.length - 1].id);
    }

    for (const iteration of started) {
      // Every iteration starts on a working day, and covers every day up to
      // the next one — so a Friday spans Fri-Sun and nothing falls between.
      const weekday = isoWeekday(iteration.start_date);
      expect(weekday).toBeLessThanOrEqual(5);
      expect(daysBetween(iteration.start_date, iteration.end_date)).toBe(weekday === 5 ? 2 : 0);
    }
    expect(started.some((iteration) => isoWeekday(iteration.start_date) === 5)).toBe(true);
  });

  it("never moves an existing iteration when the calendar changes (AC #3)", async () => {
    const projectId = await createProject("calendar immutability", {
      iteration_length: 1,
      working_weekdays: [1, 2, 3, 4, 5],
    });

    await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    const [before] = await iterationsOf(projectId);

    const { error } = await supabase
      .from("project_calendar_exceptions")
      .insert({ project_id: projectId, date: before.start_date, kind: "holiday" });
    expect(error).toBeNull();

    // Declaring the running iteration's own day a holiday must not rewrite it.
    await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    const [after] = await iterationsOf(projectId);
    expect(after.start_date).toBe(before.start_date);
    expect(after.end_date).toBe(before.end_date);
  });

  it("skips project holidays when picking a 1-day start (AC #3)", async () => {
    const projectId = await createProject("holiday skip", {
      iteration_length: 1,
      working_weekdays: [1, 2, 3, 4, 5, 6, 7],
    });

    // Every weekday works, so the next start is exactly tomorrow — unless
    // tomorrow is a declared holiday, which is what this asserts.
    await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    const [first] = await iterationsOf(projectId);
    const tomorrow = new Date(Date.parse(`${first.end_date}T00:00:00Z`) + MS_PER_DAY)
      .toISOString()
      .slice(0, 10);

    await supabase
      .from("project_calendar_exceptions")
      .insert({ project_id: projectId, date: tomorrow, kind: "holiday" });

    await finish(projectId, first.id);
    const [, second] = await iterationsOf(projectId);
    expect(second.start_date).not.toBe(tomorrow);
    expect(daysBetween(tomorrow, second.start_date)).toBe(1);
  });

  it("refuses a cadence outside the supported range", async () => {
    const projectId = await createProject("cadence bounds");
    const { error } = await supabase.from("projects").update({ iteration_length: 0 }).eq("id", projectId);
    expect(error?.message).toContain("projects_iteration_length_range");
  });

  it("does not expose next_working_day to clients", async () => {
    const projectId = await createProject("next_working_day grants");
    const { error } = await supabase.rpc("next_working_day", {
      p_project_id: projectId,
      p_from: "2026-07-17",
    });
    expect(error).not.toBeNull();

    // Friday 2026-07-17 in a Mon-Fri project: the next working day is Monday.
    await admin.from("projects").update({ working_weekdays: [1, 2, 3, 4, 5] }).eq("id", projectId);
    const { data } = await admin.rpc("next_working_day", {
      p_project_id: projectId,
      p_from: "2026-07-18",
    });
    expect(data).toBe("2026-07-20");
  });
});
