import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// TASK-93 (doc-8 §4): a fresh signup gets a personal project ("My Tasks",
// 1-day cadence, minimal state template) with zero setup, via the
// handle_new_user trigger (supabase/migrations/20260721000001_personal_project_on_signup.sql).
// This is the only path that exercises the trigger end to end — it fires on
// auth.users INSERT, which nothing in the app calls directly.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/personal-project-signup.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("personal project on signup (integration)", () => {
  let admin: SupabaseClient;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // fall through; missing env fails loudly below.
      }
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  });

  afterEach(async () => {
    // created_by -> profiles has no ON DELETE CASCADE (deliberately, so a
    // project always names a real creator) — the project row must go before
    // the user, or deleteUser's cascade into profiles hits that FK.
    for (const id of createdUserIds) {
      await admin.from("projects").delete().eq("created_by", id);
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
  });

  it("creates exactly one personal project with a minimal 1-day board and owner membership", async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `personal-project-${Date.now()}@example.test`,
      password: "fixture-local-only-password",
      email_confirm: true,
    });
    expect(error).toBeNull();
    const userId = data.user!.id;
    createdUserIds.push(userId);

    const { data: profile } = await admin.from("profiles").select("id").eq("id", userId).single();
    expect(profile).not.toBeNull();

    const { data: projects } = await admin
      .from("projects")
      .select("id, name, iteration_length, state_template, created_by, is_personal")
      .eq("created_by", userId);
    expect(projects).toHaveLength(1);
    const project = projects![0];
    expect(project.name).toBe("My Tasks");
    expect(project.iteration_length).toBe(1);
    expect(project.state_template).toBe("minimal");
    expect(project.is_personal).toBe(true); // TASK-103

    // TASK-103: the partial unique index enforces one personal project per
    // owner — a second is_personal insert for the same creator is rejected.
    const { error: dupError } = await admin
      .from("projects")
      .insert({ name: "Second personal", iteration_length: 1, is_personal: true, created_by: userId });
    expect(dupError).not.toBeNull();
    expect(dupError?.code).toBe("23505"); // unique_violation

    const { data: membership } = await admin
      .from("project_members")
      .select("role")
      .eq("project_id", project.id)
      .eq("user_id", userId)
      .single();
    expect(membership?.role).toBe("owner");

    const { data: states } = await admin
      .from("project_states")
      .select("name, category, position")
      .eq("project_id", project.id)
      .order("position", { ascending: true });
    // seed_project_states' minimal template (20260719000006_stories_state_id.sql).
    expect(states?.map((s) => s.category)).toEqual(["unstarted", "in_progress", "done"]);
  });

  it("does not create a second personal project for a repeat signup with a different id", async () => {
    // Two independent signups must each get exactly their own project — no
    // shared/singleton row, no cross-contamination via created_by lookups.
    const emails = [`personal-project-a-${Date.now()}@example.test`, `personal-project-b-${Date.now()}@example.test`];
    const userIds: string[] = [];
    for (const email of emails) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: "fixture-local-only-password",
        email_confirm: true,
      });
      expect(error).toBeNull();
      userIds.push(data.user!.id);
      createdUserIds.push(data.user!.id);
    }

    for (const userId of userIds) {
      const { data: projects } = await admin.from("projects").select("id").eq("created_by", userId);
      expect(projects).toHaveLength(1);
    }
  });
});
