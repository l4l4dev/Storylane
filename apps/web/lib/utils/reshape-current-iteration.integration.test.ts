import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-105 (doc-11 D3): reshape_current_iteration re-derives the current
// iteration's end_date from the project's (already-updated) iteration_length,
// under the finalize advisory lock. The 1-day working-day derivation and the
// lock only exist DB-side, so a real DB proves them.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/reshape-current-iteration.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const MS_PER_DAY = 86_400_000;
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}
function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

describe.skipIf(!RUN)("reshape_current_iteration (integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  const projectIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // fall through
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
    const { error } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (error) throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${error.message}`);
  });

  afterAll(async () => {
    for (const id of projectIds) await admin.from("projects").delete().eq("id", id);
  });

  async function createProject(fields: Record<string, unknown>): Promise<string> {
    const { data, error } = await supabase.from("projects").insert({ name: "reshape test", ...fields }).select("id").single();
    if (error || !data) throw new Error(`Failed to create project: ${error?.message}`);
    projectIds.push(data.id);
    return data.id;
  }

  // Seeds iteration #1 starting today via the shared finalize path.
  async function seedCurrentIteration(projectId: string): Promise<{ id: string; start_date: string; end_date: string }> {
    const { error } = await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(error).toBeNull();
    const { data } = await supabase
      .from("iterations")
      .select("id, start_date, end_date")
      .eq("project_id", projectId)
      .eq("number", 1)
      .single();
    return data!;
  }

  it("reshapes a just-created multi-day iteration down to a 1-day working-day span", async () => {
    const workingWeekdays = [1, 2, 3, 4, 5, 6, 7]; // every day works → 1-day end == start
    const projectId = await createProject({ iteration_length: 14, working_weekdays: workingWeekdays });
    const iter = await seedCurrentIteration(projectId);
    expect(iter.start_date).toBe(today());
    expect(iter.end_date).toBe(shift(today(), 13)); // 14-day span

    // The Settings save updates length first, then calls the RPC.
    await supabase.from("projects").update({ iteration_length: 1 }).eq("id", projectId);
    const { data, error } = await supabase.rpc("reshape_current_iteration", { p_project_id: projectId });
    expect(error).toBeNull();
    expect((data as { kind: string }).kind).toBe("reshaped");

    const { data: after } = await admin.from("iterations").select("end_date").eq("id", iter.id).single();
    // Every day is a working day, so next_working_day(start+1) = start+1, end = start.
    expect(after!.end_date).toBe(iter.start_date);
  });

  it("spans a 1-day Friday iteration across the weekend (Mon–Fri calendar)", async () => {
    // Only run the weekend-span assertion when today is a weekday, else the
    // 1-day end is just the next working day generically; assert that instead.
    const workingWeekdays = [1, 2, 3, 4, 5];
    const projectId = await createProject({ iteration_length: 7, working_weekdays: workingWeekdays });
    const iter = await seedCurrentIteration(projectId);

    await supabase.from("projects").update({ iteration_length: 1 }).eq("id", projectId);
    const { error } = await supabase.rpc("reshape_current_iteration", { p_project_id: projectId });
    expect(error).toBeNull();

    const { data: after } = await admin.from("iterations").select("start_date, end_date").eq("id", iter.id).single();
    // end = the day before the next working day after start. If today is not a
    // working day (weekend), finalize would have started it on the next
    // working day, so start is always a working day here.
    const start = after!.start_date;
    // The next working day strictly after start:
    let probe = shift(start, 1);
    while (!workingWeekdays.includes(isoWeekday(probe))) probe = shift(probe, 1);
    expect(after!.end_date).toBe(shift(probe, -1));
    expect(after!.end_date >= start).toBe(true); // never lands before start
  });

  it("no-ops (no error) when the project has no current iteration", async () => {
    const projectId = await createProject({ iteration_length: 14 });
    // No finalize call → no iteration row.
    const { data, error } = await supabase.rpc("reshape_current_iteration", { p_project_id: projectId });
    expect(error).toBeNull();
    expect(data as { kind: string; reason: string }).toMatchObject({ kind: "noop", reason: "no_current_iteration" });
  });

  it("no-ops when shrinking would push the end before today (a running, already-elapsed sprint)", async () => {
    const projectId = await createProject({ iteration_length: 14, working_weekdays: [1, 2, 3, 4, 5, 6, 7] });
    // Seed a current iteration that started well in the past (a long-running
    // sprint), so reshaping to 1-day would end in the past.
    const start = shift(today(), -10);
    const { data: iter, error: seedErr } = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 1, start_date: start, end_date: shift(start, 13) })
      .select("id, end_date")
      .single();
    expect(seedErr).toBeNull();

    await supabase.from("projects").update({ iteration_length: 1 }).eq("id", projectId);
    const { data, error } = await supabase.rpc("reshape_current_iteration", { p_project_id: projectId });
    expect(error).toBeNull();
    expect(data as { kind: string; reason: string }).toMatchObject({ kind: "noop", reason: "would_end_in_past" });

    // The current iteration is left untouched.
    const { data: after } = await admin.from("iterations").select("end_date").eq("id", iter!.id).single();
    expect(after!.end_date).toBe(iter!.end_date);
  });

  it("rejects a non-member caller", async () => {
    const projectId = await createProject({ iteration_length: 14 });
    await seedCurrentIteration(projectId);
    // A fresh anon client that never signed in has no membership.
    const outsider = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await outsider.rpc("reshape_current_iteration", { p_project_id: projectId });
    expect(error).not.toBeNull(); // project_role gate raises for a non-member
  });

  // TASK-116 (doc-13 finding #8): reshape_current_iteration re-checks the
  // caller's role AFTER acquiring the advisory lock, mirroring
  // override_iteration_length. A raw pg connection holds the same lock so the
  // RPC blocks after its pre-lock check; the owner is de-membered while it
  // waits, and the post-lock re-check must reject it (without it, the reshape
  // to a 1-day span would silently commit). See flexible-cadence.integration
  // for the same pattern on override_iteration_length.
  it("rejects a reshape when the caller is de-membered while blocked on the lock (AC #2)", async () => {
    const projectId = await createProject({ iteration_length: 14, working_weekdays: [1, 2, 3, 4, 5, 6, 7] });
    const iter = await seedCurrentIteration(projectId);
    // Length change the Settings save makes before calling the RPC — a real
    // reshape (to a 1-day span) that would succeed if the caller stayed a member.
    await supabase.from("projects").update({ iteration_length: 1 }).eq("id", projectId);

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
      await holder.query("select pg_advisory_lock(hashtext('iteration_finalize:' || $1))", [projectId]);

      const reshapePromise = supabase.rpc("reshape_current_iteration", { p_project_id: projectId });
      await new Promise((r) => setTimeout(r, 400)); // let it park on the lock

      const { error: revokeError } = await admin
        .from("project_members")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", ownerId);
      expect(revokeError).toBeNull();

      await holder.query("select pg_advisory_unlock(hashtext('iteration_finalize:' || $1))", [projectId]);

      const { error } = await reshapePromise;
      expect(error?.code).toBe("42501"); // require_project_role: 'not authorized'

      // The reshape never landed — end date is still the original 14-day span.
      const { data: after } = await admin.from("iterations").select("end_date").eq("id", iter.id).single();
      expect(after!.end_date).toBe(iter.end_date);
    } finally {
      await holder.end();
    }
  });
});
