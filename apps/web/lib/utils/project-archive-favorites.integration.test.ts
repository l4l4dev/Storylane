// apps/web/lib/utils/project-archive-favorites.integration.test.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-8: exercises toggle_project_favorite and the archive-permission
// behavior (supabase/migrations/20260715000001_archive_favorites.sql)
// against a running local Supabase instance, following the precedent set
// by invite-search.integration.test.ts / move-copy.integration.test.ts.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/project-archive-favorites.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("toggle_project_favorite / archive permissions (integration)", () => {
  let owner: SupabaseClient;
  let admin: SupabaseClient;
  let member: SupabaseClient;
  let projectId: string;
  let memberUserId: string;
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

    owner = createClient(url, anonKey);
    const { error: ownerAuthError } = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuthError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${ownerAuthError.message}`);
    }

    const { data: project, error: projectError } = await owner
      .from("projects")
      .insert({ name: "archive-favorites integration test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const email = `archive-favorites-member-${Date.now()}@storylane.local`;
    const { data: created, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: "Archive Favorites Member" },
    });
    if (createUserError || !created.user) throw new Error(`Failed to create test member: ${createUserError?.message}`);
    memberUserId = created.user.id;
    createdUserIds.push(memberUserId);

    const { error: memberInsertError } = await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: memberUserId, role: "member" });
    if (memberInsertError) throw new Error(`Failed to add test member: ${memberInsertError.message}`);

    member = createClient(url, anonKey);
    const { error: memberAuthError } = await member.auth.signInWithPassword({
      email,
      password: "integration-test-only-password",
    });
    if (memberAuthError) throw new Error(`Member sign-in failed: ${memberAuthError.message}`);
  });

  afterAll(async () => {
    if (projectId) {
      await admin.from("projects").delete().eq("id", projectId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("lets the owner toggle their own favorite without affecting the member's row", async () => {
    const { error } = await owner.rpc("toggle_project_favorite", { p_project_id: projectId, p_favorite: true });
    expect(error).toBeNull();

    const { data: rows } = await admin
      .from("project_members")
      .select("user_id, is_favorite, role")
      .eq("project_id", projectId);
    const ownerRow = rows?.find((r) => r.role === "owner");
    const memberRow = rows?.find((r) => r.user_id === memberUserId);
    expect(ownerRow?.is_favorite).toBe(true);
    expect(memberRow?.is_favorite).toBe(false);
  });

  it("lets a non-owner member toggle their own favorite without touching role", async () => {
    const { error } = await member.rpc("toggle_project_favorite", { p_project_id: projectId, p_favorite: true });
    expect(error).toBeNull();

    const { data: row } = await admin
      .from("project_members")
      .select("is_favorite, role")
      .eq("project_id", projectId)
      .eq("user_id", memberUserId)
      .single();
    expect(row?.is_favorite).toBe(true);
    expect(row?.role).toBe("member");
  });

  it("rejects a null p_favorite", async () => {
    const { error } = await owner.rpc("toggle_project_favorite", { p_project_id: projectId, p_favorite: null });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/p_favorite is required/i);
  });

  it("rejects a caller who isn't a project member", async () => {
    const outsiderEmail = `archive-favorites-outsider-${Date.now()}@storylane.local`;
    const { data: outsider, error: outsiderCreateError } = await admin.auth.admin.createUser({
      email: outsiderEmail,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: "Outsider" },
    });
    if (outsiderCreateError || !outsider.user) {
      throw new Error(`Failed to create outsider: ${outsiderCreateError?.message}`);
    }
    createdUserIds.push(outsider.user.id);

    const outsiderClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: signInError } = await outsiderClient.auth.signInWithPassword({
      email: outsiderEmail,
      password: "integration-test-only-password",
    });
    if (signInError) throw new Error(`Outsider sign-in failed: ${signInError.message}`);

    const { error } = await outsiderClient.rpc("toggle_project_favorite", {
      p_project_id: projectId,
      p_favorite: true,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not a project member/i);
  });

  it("rejects a non-owner's direct PATCH to their own project_members row (regression: the direct-write path stays closed)", async () => {
    await member.from("project_members").update({ is_favorite: false }).eq("project_id", projectId).eq("user_id", memberUserId);
    // "owners can update member roles" is owner-gated for the whole row —
    // RLS filters the row out of the caller's updatable set rather than
    // raising, so PostgREST reports success with 0 rows affected. Assert
    // via an admin read that the value is unchanged from the earlier
    // toggle-true test, not via an error.
    const { data: row } = await admin
      .from("project_members")
      .select("is_favorite")
      .eq("project_id", projectId)
      .eq("user_id", memberUserId)
      .single();
    expect(row?.is_favorite).toBe(true);
  });

  it("lets the owner set archived_at but rejects a non-owner's attempt (existing owner-gated policy, exercised now that the column exists)", async () => {
    await member.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", projectId);
    const { data: afterMemberAttempt } = await admin.from("projects").select("archived_at").eq("id", projectId).single();
    expect(afterMemberAttempt?.archived_at).toBeNull();

    const { error: ownerError } = await owner
      .from("projects")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", projectId);
    expect(ownerError).toBeNull();
    const { data: afterOwner } = await admin.from("projects").select("archived_at").eq("id", projectId).single();
    expect(afterOwner?.archived_at).not.toBeNull();

    await admin.from("projects").update({ archived_at: null }).eq("id", projectId);
  });
});
