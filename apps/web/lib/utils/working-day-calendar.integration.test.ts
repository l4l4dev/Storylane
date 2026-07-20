import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-85 AC #1/#2: RLS on the working-day calendar tables
// (supabase/migrations/20260720000001_working_day_calendar.sql). Needs two
// real users to prove the cross-user rules, so it creates a second one via
// the service-role admin API. Same opt-in gate as the other integration
// tests:
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/working-day-calendar.integration.test.ts
//
// Requires `supabase start` running locally with the seeded dev user.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const OTHER_EMAIL = "task85-other@storylane.local";
const OTHER_PASSWORD = "task85-local-only-password";

describe.skipIf(!RUN)("working-day calendar RLS (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asOther: SupabaseClient; // second user, membership toggled per test
  let asService: SupabaseClient;
  let ownerId: string;
  let otherId: string;
  let projectId: string;

  async function joinProject(role: "owner" | "member" | "viewer") {
    await asService
      .from("project_members")
      .upsert({ project_id: projectId, user_id: otherId, role }, { onConflict: "project_id,user_id" });
  }

  async function leaveProject() {
    await asService.from("project_members").delete().eq("project_id", projectId).eq("user_id", otherId);
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

    asService = createClient(url, serviceKey, { auth: { persistSession: false } });

    const created = await asService.auth.admin.createUser({
      email: OTHER_EMAIL,
      password: OTHER_PASSWORD,
      email_confirm: true,
    });
    if (created.data.user) {
      otherId = created.data.user.id;
    } else {
      const { data: list } = await asService.auth.admin.listUsers();
      const existing = list.users.find((u) => u.email === OTHER_EMAIL);
      if (!existing) {
        throw new Error(`Could not create or find the second test user: ${created.error?.message}`);
      }
      otherId = existing.id;
    }

    asOwner = createClient(url, anonKey);
    const ownerAuth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }
    ownerId = ownerAuth.data.user.id;

    asOther = createClient(url, anonKey);
    const otherAuth = await asOther.auth.signInWithPassword({
      email: OTHER_EMAIL,
      password: OTHER_PASSWORD,
    });
    if (otherAuth.error) {
      throw new Error(`Second-user sign-in failed: ${otherAuth.error.message}`);
    }

    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name: "working-day calendar integration test" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await asService.from("projects").delete().eq("id", projectId);
    }
    if (otherId) {
      await asService.from("user_time_off").delete().eq("user_id", otherId);
      await asService.auth.admin.deleteUser(otherId);
    }
    if (ownerId) {
      await asService.from("user_time_off").delete().eq("user_id", ownerId);
    }
  });

  describe("projects.working_weekdays", () => {
    it("defaults to Mon-Fri and rejects an out-of-range weekday", async () => {
      const { data } = await asOwner
        .from("projects")
        .select("working_weekdays")
        .eq("id", projectId)
        .single();
      expect(data?.working_weekdays).toEqual([1, 2, 3, 4, 5]);

      const { error } = await asOwner
        .from("projects")
        .update({ working_weekdays: [0, 8] })
        .eq("id", projectId);
      expect(error?.code).toBe("23514"); // check_violation
    });

    // The server action guards this too, but the anon key lets an owner PATCH
    // the column directly, so the constraint is the one that actually holds.
    it("rejects an empty weekday set at the database", async () => {
      const { error } = await asOwner
        .from("projects")
        .update({ working_weekdays: [] })
        .eq("id", projectId);
      expect(error?.code).toBe("23514");

      const { data } = await asOwner
        .from("projects")
        .select("working_weekdays")
        .eq("id", projectId)
        .single();
      expect(data?.working_weekdays).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe("project_calendar_exceptions", () => {
    it("is invisible to a non-member and writable only by owner/member", async () => {
      await leaveProject();

      const { data: created, error: createError } = await asOwner
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-11", kind: "holiday" })
        .select("id")
        .single();
      expect(createError).toBeNull();
      const exceptionId = created!.id;

      // Non-member: no read, no write.
      const { data: unseen } = await asOther
        .from("project_calendar_exceptions")
        .select("id")
        .eq("project_id", projectId);
      expect(unseen).toEqual([]);

      const { error: strangerInsert } = await asOther
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-12", kind: "holiday" });
      expect(strangerInsert?.code).toBe("42501");

      // Viewer: reads, cannot write.
      await joinProject("viewer");
      const { data: viewerSees } = await asOther
        .from("project_calendar_exceptions")
        .select("id")
        .eq("project_id", projectId);
      expect(viewerSees?.map((row) => row.id)).toEqual([exceptionId]);

      const { error: viewerInsert } = await asOther
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-12", kind: "holiday" });
      expect(viewerInsert?.code).toBe("42501");

      const { error: viewerDelete, count: viewerDeleted } = await asOther
        .from("project_calendar_exceptions")
        .delete({ count: "exact" })
        .eq("id", exceptionId);
      expect(viewerDelete).toBeNull();
      expect(viewerDeleted).toBe(0);

      // Member: full write.
      await joinProject("member");
      const { error: memberInsert } = await asOther
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-12", kind: "extra_workday" });
      expect(memberInsert).toBeNull();

      await asService.from("project_calendar_exceptions").delete().eq("project_id", projectId);
      await leaveProject();
    });

    // Backs deleteCalendarException's choice not to assert a row count: the
    // second of two members deleting the same row must not see an error.
    it("reports no error when the row is already gone", async () => {
      const { data: created } = await asOwner
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-16", kind: "holiday" })
        .select("id")
        .single();

      const first = await asOwner
        .from("project_calendar_exceptions")
        .delete()
        .eq("id", created!.id)
        .eq("project_id", projectId);
      expect(first.error).toBeNull();

      const second = await asOwner
        .from("project_calendar_exceptions")
        .delete()
        .eq("id", created!.id)
        .eq("project_id", projectId);
      expect(second.error).toBeNull();
    });

    it("cannot be re-parented to another project the caller also belongs to", async () => {
      const { data: other } = await asOwner
        .from("projects")
        .insert({ name: "calendar reparent target" })
        .select("id")
        .single();
      const { data: created } = await asOwner
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-14", kind: "holiday" })
        .select("id")
        .single();

      const { error } = await asOwner
        .from("project_calendar_exceptions")
        .update({ project_id: other!.id })
        .eq("id", created!.id);
      expect(error?.code).toBe("P0001");

      await asService.from("projects").delete().eq("id", other!.id);
      await asService.from("project_calendar_exceptions").delete().eq("project_id", projectId);
    });

    it("rejects an unknown kind and a duplicate date", async () => {
      const { error: badKind } = await asOwner
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-13", kind: "vacation" });
      expect(badKind?.code).toBe("23514");

      await asOwner
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-13", kind: "holiday" });
      const { error: duplicate } = await asOwner
        .from("project_calendar_exceptions")
        .insert({ project_id: projectId, date: "2026-08-13", kind: "extra_workday" });
      expect(duplicate?.code).toBe("23505");

      await asService.from("project_calendar_exceptions").delete().eq("project_id", projectId);
    });
  });

  describe("user_time_off", () => {
    it("is readable cross-user only through a shared project (AC #2)", async () => {
      await leaveProject();
      await asService.from("user_time_off").delete().eq("user_id", ownerId);
      const { error: insertError } = await asOwner
        .from("user_time_off")
        .insert({ user_id: ownerId, date: "2026-08-20", kind: "off" });
      expect(insertError).toBeNull();

      const { data: beforeJoin } = await asOther
        .from("user_time_off")
        .select("date")
        .eq("user_id", ownerId);
      expect(beforeJoin).toEqual([]);

      // Viewer is enough — the accepted trade-off documented in spec/rls.md.
      await joinProject("viewer");
      const { data: afterJoin } = await asOther
        .from("user_time_off")
        .select("date")
        .eq("user_id", ownerId);
      expect(afterJoin?.map((row) => row.date)).toEqual(["2026-08-20"]);

      await leaveProject();
    });

    it("is writable only by its own user, even from a shared project (AC #2)", async () => {
      await joinProject("member");

      const { error: foreignInsert } = await asOther
        .from("user_time_off")
        .insert({ user_id: ownerId, date: "2026-08-21", kind: "off" });
      expect(foreignInsert?.code).toBe("42501");

      const { error: foreignUpdate, count: updated } = await asOther
        .from("user_time_off")
        .update({ kind: "off" }, { count: "exact" })
        .eq("user_id", ownerId);
      expect(foreignUpdate).toBeNull();
      expect(updated).toBe(0);

      const { error: foreignDelete, count: deleted } = await asOther
        .from("user_time_off")
        .delete({ count: "exact" })
        .eq("user_id", ownerId);
      expect(foreignDelete).toBeNull();
      expect(deleted).toBe(0);

      // Their own row still goes through.
      const { error: ownInsert } = await asOther
        .from("user_time_off")
        .insert({ user_id: otherId, date: "2026-08-22", kind: "off" });
      expect(ownInsert).toBeNull();

      await leaveProject();
    });

    it("has no free-text column to leak (AC #2)", async () => {
      const row = { user_id: ownerId, date: "2026-08-23", kind: "off", reason: "surgery" };
      const { error } = await asOwner.from("user_time_off").insert(row);
      expect(error?.code).toBe("PGRST204"); // column not found in schema cache
    });
  });
});
