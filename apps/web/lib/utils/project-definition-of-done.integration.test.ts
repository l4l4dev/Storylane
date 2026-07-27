// apps/web/lib/utils/project-definition-of-done.integration.test.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-206: projects.definition_of_done rides the existing owner-only
// "owners can update projects" policy (20260627000002_projects.sql) — the
// same one name/description/iteration_term already use. This confirms the
// new column inherited that gate rather than something looser, following
// the precedent in project-archive-favorites.integration.test.ts (member
// UPDATE silently no-ops under RLS, owner UPDATE succeeds).
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/project-definition-of-done.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("projects.definition_of_done RLS (integration)", () => {
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let member: SupabaseClient;
  let viewer: SupabaseClient;
  let projectId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // .env.local not found — fall through and let the missing env vars fail loudly below.
      }
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not set for the integration test",
      );
    }

    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: ownerAuthError } = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuthError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${ownerAuthError.message}`);
    }

    const { data: project, error: projectError } = await owner
      .from("projects")
      .insert({ name: "definition-of-done integration test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const memberEmail = `dod-member-${Date.now()}@storylane.local`;
    const { data: memberCreated, error: memberCreateError } = await admin.auth.admin.createUser({
      email: memberEmail,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: "DoD Member" },
    });
    if (memberCreateError || !memberCreated.user) {
      throw new Error(`Failed to create test member: ${memberCreateError?.message}`);
    }
    createdUserIds.push(memberCreated.user.id);

    const { error: memberInsertError } = await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: memberCreated.user.id, role: "member" });
    if (memberInsertError) throw new Error(`Failed to add test member: ${memberInsertError.message}`);

    member = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: memberAuthError } = await member.auth.signInWithPassword({
      email: memberEmail,
      password: "integration-test-only-password",
    });
    if (memberAuthError) throw new Error(`Member sign-in failed: ${memberAuthError.message}`);

    const viewerEmail = `dod-viewer-${Date.now()}@storylane.local`;
    const { data: viewerCreated, error: viewerCreateError } = await admin.auth.admin.createUser({
      email: viewerEmail,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: "DoD Viewer" },
    });
    if (viewerCreateError || !viewerCreated.user) {
      throw new Error(`Failed to create test viewer: ${viewerCreateError?.message}`);
    }
    createdUserIds.push(viewerCreated.user.id);

    const { error: viewerInsertError } = await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: viewerCreated.user.id, role: "viewer" });
    if (viewerInsertError) throw new Error(`Failed to add test viewer: ${viewerInsertError.message}`);

    viewer = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: viewerAuthError } = await viewer.auth.signInWithPassword({
      email: viewerEmail,
      password: "integration-test-only-password",
    });
    if (viewerAuthError) throw new Error(`Viewer sign-in failed: ${viewerAuthError.message}`);
  });

  afterAll(async () => {
    if (projectId) {
      await admin.from("projects").delete().eq("id", projectId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("lets the owner set it but rejects a member's and a viewer's attempt (matches name/description)", async () => {
    const { error: memberError } = await member
      .from("projects")
      .update({ definition_of_done: "member attempt" })
      .eq("id", projectId);
    expect(memberError).toBeNull(); // RLS: silent zero-row no-op, not a thrown error.

    const { error: viewerError } = await viewer
      .from("projects")
      .update({ definition_of_done: "viewer attempt" })
      .eq("id", projectId);
    expect(viewerError).toBeNull();

    const { data: afterNonOwnerAttempts } = await admin
      .from("projects")
      .select("definition_of_done")
      .eq("id", projectId)
      .single();
    expect(afterNonOwnerAttempts?.definition_of_done).toBeNull();

    const { data: ownerUpdated, error: ownerError } = await owner
      .from("projects")
      .update({ definition_of_done: "Tests pass. Reviewed. Deployed." })
      .eq("id", projectId)
      .select("definition_of_done")
      .single();
    expect(ownerError).toBeNull();
    expect(ownerUpdated?.definition_of_done).toBe("Tests pass. Reviewed. Deployed.");
  });

  it("is readable by owner, member, and viewer alike (whole-row SELECT policy)", async () => {
    await admin.from("projects").update({ definition_of_done: "Readable by everyone" }).eq("id", projectId);

    for (const client of [owner, member, viewer]) {
      const { data, error } = await client
        .from("projects")
        .select("definition_of_done")
        .eq("id", projectId)
        .single();
      expect(error).toBeNull();
      expect(data?.definition_of_done).toBe("Readable by everyone");
    }
  });
});
