import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolvePlanningCapacity, startPlanningCapacityFetch } from "./planning-capacity";

// TASK-99: proves resolvePlanningCapacity's fallback path — the estimated
// range startPlanningCapacityFetch queries almost always covers the real
// one, but when it doesn't (a projected sprint far outside the horizon),
// resolvePlanningCapacity must re-query the exact range rather than silently
// reporting a budget computed from incomplete data.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/planning-capacity.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("planning capacity (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  const projectIds: string[] = [];

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function shiftDate(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  }

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
    if (auth.error) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error.message}`);
    }
    const {
      data: { user },
    } = await owner.auth.getUser();
    ownerId = user!.id;
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await admin.from("projects").delete().eq("id", id);
    }
  });

  async function createProject(name: string, patch: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await owner.from("projects").insert({ name, ...patch }).select("id").single();
    if (error || !data) throw new Error(`Failed to create project: ${error?.message}`);
    projectIds.push(data.id);
    return data.id;
  }

  it("still reflects a far-future calendar exception the estimated range never queried", async () => {
    // Every day counts as a working day, so exceptions are the only variable
    // in the budget math below — no day-of-week guesswork needed.
    const workingWeekdays = [1, 2, 3, 4, 5, 6, 7];
    const projectId = await createProject("planning capacity fallback", {
      iteration_length: 7,
      working_weekdays: workingWeekdays,
    });

    const seed = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seed.error).toBeNull();

    const { data: iteration } = await owner
      .from("iterations")
      .select("start_date, end_date")
      .eq("project_id", projectId)
      .eq("number", 1)
      .single();
    expect(iteration).not.toBeNull();

    // A holiday inside the current iteration: covered by even the
    // conservative estimate, so this exercises the normal (no-fallback) path.
    const { error: nearError } = await admin
      .from("project_calendar_exceptions")
      .insert({ project_id: projectId, date: iteration!.start_date, kind: "holiday" });
    expect(nearError).toBeNull();

    const capacityMembers = [{ userId: ownerId, role: "owner" }];
    const rate = 2;
    const currentIteration = { start: iteration!.start_date, end: iteration!.end_date };

    // Far outside estimatePlanningRange's forward horizon at this cadence
    // (7 * 27 = 189 days) — this is what forces resolvePlanningCapacity's
    // fallback branch.
    const farStart = shiftDate(today(), 5000);
    const farEnd = shiftDate(farStart, 4);
    const { error: farError } = await admin
      .from("project_calendar_exceptions")
      .insert({ project_id: projectId, date: farStart, kind: "holiday" });
    expect(farError).toBeNull();

    const fetch = startPlanningCapacityFetch(
      owner,
      projectId,
      capacityMembers.map((m) => m.userId),
      today(),
      7,
    );
    const result = await resolvePlanningCapacity(owner, projectId, fetch, {
      rate,
      workingWeekdays,
      capacityMembers,
      currentIteration,
      projectedSprints: [{ start: farStart, end: farEnd }],
    });

    // Current iteration: 7 days - 1 holiday = 6 working days x 1 member x
    // rate 2.
    expect(result.currentBudget).toBe(12);
    // Far-future sprint: 5 days - 1 holiday = 4 working days x 1 member x
    // rate 2. Would be 10 (no holiday applied) if the fallback hadn't
    // re-queried past the estimated range.
    expect(result.backlogBudgets).toEqual([8]);
  });

  it("computes the same budget for a range the estimate already covers (no fallback needed)", async () => {
    const workingWeekdays = [1, 2, 3, 4, 5, 6, 7];
    const projectId = await createProject("planning capacity in-range", {
      iteration_length: 7,
      working_weekdays: workingWeekdays,
    });

    const seed = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seed.error).toBeNull();

    const { data: iteration } = await owner
      .from("iterations")
      .select("start_date, end_date")
      .eq("project_id", projectId)
      .eq("number", 1)
      .single();
    expect(iteration).not.toBeNull();

    const { error } = await admin
      .from("project_calendar_exceptions")
      .insert({ project_id: projectId, date: iteration!.start_date, kind: "holiday" });
    expect(error).toBeNull();

    const capacityMembers = [{ userId: ownerId, role: "owner" }];
    const fetch = startPlanningCapacityFetch(
      owner,
      projectId,
      capacityMembers.map((m) => m.userId),
      today(),
      7,
    );
    const result = await resolvePlanningCapacity(owner, projectId, fetch, {
      rate: 2,
      workingWeekdays,
      capacityMembers,
      currentIteration: { start: iteration!.start_date, end: iteration!.end_date },
      projectedSprints: [],
    });

    expect(result.currentBudget).toBe(12);
    expect(result.backlogBudgets).toEqual([]);
  });
});
