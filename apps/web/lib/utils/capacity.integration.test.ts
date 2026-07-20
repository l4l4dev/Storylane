import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import capacityFixture from "../../../../spec/fixtures/capacity.json";

// TASK-86 (doc-8 §7): the SQL half of the capacity formula
// (public.project_capacity, supabase/migrations/20260720000002_iteration_capacity.sql)
// against the SAME golden fixture packages/core/src/capacity.test.ts asserts
// the TS half against — that cross-check is the whole point of having two
// implementations. Also pins the finalize-time snapshot rules, which only
// exist inside finalize_iteration and cannot be proven in pure TS.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/capacity.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type FinalizeEvent = { kind: string; number?: number; velocity?: number; capacity?: number; skipped?: boolean };

describe.skipIf(!RUN)("project capacity (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  // The fixture's largest member set; created once and re-mapped per case.
  const extraUserIds: string[] = [];
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

    const maxMembers = Math.max(...capacityFixture.cases.map((c) => c.members.length));
    for (let i = 0; i < maxMembers; i++) {
      const { data, error } = await admin.auth.admin.createUser({
        email: `capacity-fixture-${i}-${Date.now()}@example.test`,
        password: "fixture-local-only-password",
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`Failed to create fixture user: ${error?.message}`);
      extraUserIds.push(data.user.id);
    }
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await admin.from("projects").delete().eq("id", id);
    }
    for (const id of extraUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  async function createProject(name: string, patch: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await owner.from("projects").insert({ name, ...patch }).select("id").single();
    if (error || !data) throw new Error(`Failed to create project: ${error?.message}`);
    projectIds.push(data.id);
    return data.id;
  }

  describe("project_capacity matches spec/fixtures/capacity.json", () => {
    for (const [index, testCase] of capacityFixture.cases.entries()) {
      it(testCase.name, async () => {
        const projectId = await createProject(`capacity fixture #${index}`, {
          working_weekdays: testCase.working_weekdays,
        });

        // The creator is auto-enrolled as owner; the fixture defines the
        // member set exactly, including the empty one.
        const { error: clearError } = await admin.from("project_members").delete().eq("project_id", projectId);
        expect(clearError).toBeNull();

        const userIds = testCase.members.map((_, i) => extraUserIds[i]);
        if (userIds.length > 0) {
          const { error } = await admin.from("project_members").insert(
            testCase.members.map((member, i) => ({
              project_id: projectId,
              user_id: extraUserIds[i],
              role: member.role,
            })),
          );
          expect(error).toBeNull();
        }

        if (testCase.exceptions.length > 0) {
          const { error } = await admin
            .from("project_calendar_exceptions")
            .insert(testCase.exceptions.map((e) => ({ project_id: projectId, date: e.date, kind: e.kind })));
          expect(error).toBeNull();
        }

        const timeOff = testCase.members.flatMap((member, i) =>
          member.time_off.map((date) => ({ user_id: extraUserIds[i], date, kind: "off" })),
        );
        if (timeOff.length > 0) {
          const { error } = await admin.from("user_time_off").insert(timeOff);
          expect(error).toBeNull();
        }

        try {
          const { data, error } = await admin.rpc("project_capacity", {
            p_project_id: projectId,
            p_start: testCase.start,
            p_end: testCase.end,
          });
          expect(error).toBeNull();
          expect(Number(data)).toBe(testCase.expected);
        } finally {
          // user_time_off is cross-project and global to the user, so it
          // must not leak into the next case.
          for (const id of userIds) {
            await admin.from("user_time_off").delete().eq("user_id", id);
          }
        }
      });
    }
  });

  describe("finalize_iteration snapshots capacity", () => {
    it("writes a real capacity on the iteration the team worked in, and freezes it (AC #1)", async () => {
      // Seven working days, one member (the owner), so capacity is
      // unambiguous whichever weekday the suite happens to run on.
      const projectId = await createProject("capacity finalize", {
        iteration_length: 3,
        working_weekdays: [1, 2, 3, 4, 5, 6, 7],
      });

      const seed = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
      expect(seed.error).toBeNull();

      const { data: iter1 } = await owner
        .from("iterations")
        .select("id")
        .eq("project_id", projectId)
        .eq("number", 1)
        .single();

      const finish = await owner.rpc("finalize_iteration", {
        p_project_id: projectId,
        p_manual: true,
        p_iteration_id: iter1!.id,
      });
      expect(finish.error).toBeNull();

      const { data: finalized } = await owner
        .from("iterations")
        .select("capacity, end_date, start_date")
        .eq("id", iter1!.id)
        .single();
      // Manual finish truncates end_date to today, so a 3-day iteration
      // started today is one day long — capacity must be computed AFTER
      // that truncation, not from the original end_date.
      expect(finalized!.start_date).toBe(finalized!.end_date);
      expect(Number(finalized!.capacity)).toBe(1);

      // A later calendar edit and a re-finalization must not rewrite it.
      const { error: exceptionError } = await admin
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: finalized!.start_date, kind: "holiday" });
      expect(exceptionError).toBeNull();

      const refinalize = await owner.rpc("finalize_iteration", {
        p_project_id: projectId,
        p_manual: true,
        p_iteration_id: iter1!.id,
      });
      expect(refinalize.error).toBeNull();

      const { data: unchanged } = await owner.from("iterations").select("capacity").eq("id", iter1!.id).single();
      expect(Number(unchanged!.capacity)).toBe(1);

      // AC #1's real teeth: `iterations` UPDATE RLS is row-level and lets
      // any member write the row, so only a trigger can stop a direct
      // PostgREST PATCH from rewriting the snapshot. Forging a tiny
      // capacity here would inflate the project's rate — and every future
      // sprint's point budget — for everyone.
      const forge = await owner.from("iterations").update({ capacity: 0.001 }).eq("id", iter1!.id);
      expect(forge.error).not.toBeNull();

      const { data: stillOne } = await owner.from("iterations").select("capacity").eq("id", iter1!.id).single();
      expect(Number(stillOne!.capacity)).toBe(1);

      // Same guard on the numerator.
      const forgeVelocity = await owner.from("iterations").update({ velocity: 999 }).eq("id", iter1!.id);
      expect(forgeVelocity.error).not.toBeNull();

      // ...but a finished iteration's goal is still editable — the guard is
      // scoped to the two snapshot columns, not the whole row.
      const editGoal = await owner.from("iterations").update({ goal: "retro note" }).eq("id", iter1!.id);
      expect(editGoal.error).toBeNull();
    });

    it("rejects a negative capacity at the schema level", async () => {
      const projectId = await createProject("capacity negative", { iteration_length: 1 });
      const seed = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
      expect(seed.error).toBeNull();

      const { data: iter1 } = await owner
        .from("iterations")
        .select("id")
        .eq("project_id", projectId)
        .eq("number", 1)
        .single();
      const { error } = await admin.from("iterations").update({ capacity: -1 }).eq("id", iter1!.id);
      expect(error).not.toBeNull();
    });

    it("pins every catch-up gap row to capacity 0 (AC #2)", async () => {
      // A 1-day cadence project whose first iteration is a week in the past:
      // one finalize call walks forward, inserting and immediately
      // finalizing a chain of empty rows.
      const projectId = await createProject("capacity catch-up", {
        iteration_length: 1,
        working_weekdays: [1, 2, 3, 4, 5, 6, 7],
      });

      const start = shiftDate(today(), -7);
      const { error: seedError } = await admin
        .from("iterations")
        .insert({ project_id: projectId, number: 1, start_date: start, end_date: start });
      expect(seedError).toBeNull();

      const rollover = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
      expect(rollover.error).toBeNull();
      const finalizedEvents = (rollover.data as FinalizeEvent[]).filter((e) => e.kind === "finalized");
      expect(finalizedEvents.length).toBeGreaterThan(1);

      const { data: rows } = await owner
        .from("iterations")
        .select("number, state, capacity")
        .eq("project_id", projectId)
        .eq("state", "done")
        .order("number", { ascending: true });

      expect(Number(rows![0].capacity)).toBe(1);
      for (const gap of rows!.slice(1)) {
        expect(Number(gap.capacity)).toBe(0);
      }
    });

    it("reports capacity on the finalized event", async () => {
      const projectId = await createProject("capacity event", {
        iteration_length: 1,
        working_weekdays: [1, 2, 3, 4, 5, 6, 7],
      });
      const seed = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
      expect(seed.error).toBeNull();

      const { data: iter1 } = await owner
        .from("iterations")
        .select("id")
        .eq("project_id", projectId)
        .eq("number", 1)
        .single();
      const finish = await owner.rpc("finalize_iteration", {
        p_project_id: projectId,
        p_manual: true,
        p_iteration_id: iter1!.id,
      });
      const event = (finish.data as FinalizeEvent[]).find((e) => e.kind === "finalized");
      expect(Number(event?.capacity)).toBe(1);
    });

    it("still snapshots capacity for a skipped iteration (the window drops it on `skipped`)", async () => {
      const projectId = await createProject("capacity skip", {
        iteration_length: 3,
        working_weekdays: [1, 2, 3, 4, 5, 6, 7],
      });
      const seed = await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
      expect(seed.error).toBeNull();

      const { data: iter1 } = await owner
        .from("iterations")
        .select("id")
        .eq("project_id", projectId)
        .eq("number", 1)
        .single();
      await owner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: true, p_iteration_id: iter1!.id });

      // #2 starts tomorrow, so finishing it is a skip (zero-length).
      const { data: iter2 } = await owner
        .from("iterations")
        .select("id")
        .eq("project_id", projectId)
        .eq("number", 2)
        .single();
      const skip = await owner.rpc("finalize_iteration", {
        p_project_id: projectId,
        p_manual: true,
        p_iteration_id: iter2!.id,
      });
      expect(skip.error).toBeNull();

      const { data: skipped } = await owner
        .from("iterations")
        .select("skipped, capacity")
        .eq("id", iter2!.id)
        .single();
      expect(skipped!.skipped).toBe(true);
      expect(Number(skipped!.capacity)).toBe(1);
    });
  });
});
