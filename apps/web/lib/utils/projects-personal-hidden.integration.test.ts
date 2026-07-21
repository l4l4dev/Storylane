import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-103 (doc-11 D1): the projects list + sidebar hide the VIEWER'S OWN
// personal project via the filter `is_personal.eq.false OR created_by.neq.<me>`
// (PostgREST `.or`). This asserts the exact filter the app uses hides the
// viewer's own "My Tasks" but keeps team projects AND a personal project the
// viewer was invited to (created by someone else) — the correction the
// advisor flagged against a naive bare-is_personal filter.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/projects-personal-hidden.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("personal project hidden from the viewer's own list (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  let otherUserId: string;
  const projectIds: string[] = [];

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

    // A second user; their signup trigger creates THEIR personal project.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: `personal-hidden-other-${Date.now()}@example.test`,
      password: "fixture-local-only-password",
      email_confirm: true,
    });
    if (createErr || !created.user) throw new Error(`Failed to create other user: ${createErr?.message}`);
    otherUserId = created.user.id;
  });

  afterAll(async () => {
    for (const id of projectIds) await admin.from("projects").delete().eq("id", id);
    if (otherUserId) {
      // Delete the other user's own personal project first (created_by FK has
      // no cascade), then the user.
      await admin.from("projects").delete().eq("created_by", otherUserId);
      await admin.auth.admin.deleteUser(otherUserId);
    }
  });

  it("hides the viewer's own personal project but keeps team + invited-personal projects", async () => {
    // The dev user's own personal project (created by the seed signup).
    const { data: ownPersonal } = await admin
      .from("projects")
      .select("id")
      .eq("created_by", ownerId)
      .eq("is_personal", true)
      .single();
    expect(ownPersonal).not.toBeNull();

    // A team project owned by the dev user.
    const { data: team } = await owner.from("projects").insert({ name: "hidden-test team" }).select("id").single();
    projectIds.push(team!.id);

    // The other user's personal project, with the dev user invited as a member
    // — from the dev user's perspective it is NOT their own personal project,
    // so it must stay visible.
    const { data: otherPersonal } = await admin
      .from("projects")
      .select("id")
      .eq("created_by", otherUserId)
      .eq("is_personal", true)
      .single();
    expect(otherPersonal).not.toBeNull();
    const { error: memberErr } = await admin
      .from("project_members")
      .insert({ project_id: otherPersonal!.id, user_id: ownerId, role: "member" });
    expect(memberErr).toBeNull();

    // Run the exact filter dashboard/page.tsx + sidebar-data.ts use, as the
    // dev user (anon key → RLS applies).
    const { data: visible, error } = await owner
      .from("projects")
      .select("id")
      .or(`is_personal.eq.false,created_by.neq.${ownerId}`);
    expect(error).toBeNull();
    const visibleIds = new Set((visible ?? []).map((p) => p.id));

    expect(visibleIds.has(ownPersonal!.id)).toBe(false); // own personal — hidden
    expect(visibleIds.has(team!.id)).toBe(true); // team — shown
    expect(visibleIds.has(otherPersonal!.id)).toBe(true); // invited personal — shown
  });

  it("pins is_personal against UPDATE (a co-owner can't flip a shared project personal)", async () => {
    // The BEFORE UPDATE trigger forces is_personal back to its old value, so
    // even a service-role UPDATE (which bypasses RLS but not triggers) can't
    // change it — is_personal is settable only at INSERT (signup).
    const { data: team } = await owner.from("projects").insert({ name: "pin-test team" }).select("id").single();
    projectIds.push(team!.id);

    const { error } = await admin.from("projects").update({ is_personal: true }).eq("id", team!.id);
    expect(error).toBeNull(); // the write "succeeds" but the trigger neutralizes it

    const { data: after } = await admin.from("projects").select("is_personal").eq("id", team!.id).single();
    expect(after!.is_personal).toBe(false);
  });
});
