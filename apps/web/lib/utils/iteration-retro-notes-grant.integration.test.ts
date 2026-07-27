// apps/web/lib/utils/iteration-retro-notes-grant.integration.test.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-205/207 (Codex review on PR #7): 20260720000002_iteration_capacity.sql
// revoked table-level UPDATE on iterations and granted back only
// `update (goal)` to authenticated. iterations.retro_notes
// (20260727100000_iteration_retro_notes.sql) landed with a bare ALTER TABLE
// that never extended that grant, so every owner/member save through
// updateIterationRetroNotes hit 42501 (permission denied for table
// iterations) before the "members can update iterations" RLS policy was
// even evaluated -- a live production bug from the moment that migration
// deployed until 20260727130000_grant_iteration_retro_notes.sql added the
// missing column grant. The existing action/component tests all mock the
// Supabase call, so none of them would have caught the grant being wrong
// (or a regression un-granting it later) -- this is the first test that
// exercises the real privilege.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/iteration-retro-notes-grant.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("iterations.retro_notes grant (integration)", () => {
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let member: SupabaseClient;
  let viewer: SupabaseClient;
  let projectId: string;
  let iterationId: string;
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
      .insert({ name: "retro-notes-grant integration test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const { data: iteration, error: iterationError } = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 1, start_date: "2026-07-01", end_date: "2026-07-14" })
      .select("id")
      .single();
    if (iterationError || !iteration) throw new Error(`Failed to seed iteration: ${iterationError?.message}`);
    iterationId = iteration.id;

    const memberEmail = `retro-member-${Date.now()}@storylane.local`;
    const { data: memberCreated, error: memberCreateError } = await admin.auth.admin.createUser({
      email: memberEmail,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: "Retro Member" },
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

    const viewerEmail = `retro-viewer-${Date.now()}@storylane.local`;
    const { data: viewerCreated, error: viewerCreateError } = await admin.auth.admin.createUser({
      email: viewerEmail,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: "Retro Viewer" },
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

  it("lets an owner save retro notes (the exact write updateIterationRetroNotes performs)", async () => {
    const { data, error } = await owner
      .from("iterations")
      .update({ retro_notes: "Went well: shipped on time." })
      .eq("id", iterationId)
      .select("retro_notes")
      .single();
    expect(error).toBeNull();
    expect(data?.retro_notes).toBe("Went well: shipped on time.");
  });

  it("lets a member save retro notes too", async () => {
    const { data, error } = await member
      .from("iterations")
      .update({ retro_notes: "Member's retro." })
      .eq("id", iterationId)
      .select("retro_notes")
      .single();
    expect(error).toBeNull();
    expect(data?.retro_notes).toBe("Member's retro.");
  });

  it("rejects a viewer's attempt via RLS, not the column grant (silent no-op, no thrown error)", async () => {
    await admin.from("iterations").update({ retro_notes: "before viewer attempt" }).eq("id", iterationId);

    const { error } = await viewer.from("iterations").update({ retro_notes: "viewer attempt" }).eq("id", iterationId);
    // The column grant now permits authenticated to write retro_notes at all
    // (that's what this task's fix added) — RLS is what actually blocks a
    // viewer, and RLS violations are a silent zero-row no-op, not an error.
    expect(error).toBeNull();

    const { data } = await admin.from("iterations").select("retro_notes").eq("id", iterationId).single();
    expect(data?.retro_notes).toBe("before viewer attempt");
  });
});
