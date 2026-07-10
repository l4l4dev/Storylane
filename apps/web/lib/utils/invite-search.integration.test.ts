import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-6 AC #1/#4/#5: exercises the real search_users_for_invite /
// invite_member RPCs (supabase/migrations/20260712000001_invite_by_user_search.sql)
// against a running local Supabase instance, following the precedent set by
// promote.integration.test.ts / move-copy.integration.test.ts.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/invite-search.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("search_users_for_invite / invite_member RPCs (integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  let projectId: string;
  const createdUserIds: string[] = [];

  async function createSearchableUser(usernameSuffix: string, displayName: string) {
    const email = `invite-search-${usernameSuffix}-${Date.now()}@storylane.local`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !created.user) throw new Error(`Failed to create test user: ${error?.message}`);
    createdUserIds.push(created.user.id);
    const username = `search_${usernameSuffix}_${created.user.id.replace(/-/g, "").slice(0, 8)}`;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ username, display_name: displayName })
      .eq("id", created.user.id);
    if (profileError) throw new Error(`Failed to set test profile: ${profileError.message}`);
    return { id: created.user.id, username, email };
  }

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

    supabase = createClient(url, anonKey);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (authError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${authError.message}`);
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: "invite-search RPC integration test", workflow_mode: "tracker" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await supabase.from("projects").delete().eq("id", projectId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("returns nothing for a query shorter than 2 characters", async () => {
    await createSearchableUser("short", "Short Query Match");
    const { data, error } = await supabase.rpc("search_users_for_invite", {
      p_query: "s",
      p_project_id: projectId,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("matches on username and display_name, escaping literal _ in the query", async () => {
    const target = await createSearchableUser("under_score", "Underscore Match");
    // The literal id-suffixed username always contains "_" (search_under_score_xxxxxxxx) —
    // querying for a substring containing the literal "_" character must not
    // ILIKE-wildcard-match a differently-spelled username.
    const queryWithUnderscore = target.username.slice(0, 14); // e.g. "search_under_s"
    expect(queryWithUnderscore).toContain("_");

    const { data, error } = await supabase.rpc("search_users_for_invite", {
      p_query: queryWithUnderscore,
      p_project_id: projectId,
    });
    expect(error).toBeNull();
    expect(data?.map((r: { id: string }) => r.id)).toContain(target.id);

    const decoy = queryWithUnderscore.replace(/_/g, "x");
    const { data: decoyResults } = await supabase.rpc("search_users_for_invite", {
      p_query: decoy,
      p_project_id: projectId,
    });
    expect(decoyResults?.map((r: { id: string }) => r.id)).not.toContain(target.id);
  });

  it("excludes users already in the project from results", async () => {
    const target = await createSearchableUser("existing", "Existing Member Match");
    await admin.from("project_members").insert({ project_id: projectId, user_id: target.id, role: "member" });

    const { data, error } = await supabase.rpc("search_users_for_invite", {
      p_query: "Existing Member Match",
      p_project_id: projectId,
    });
    expect(error).toBeNull();
    expect(data?.map((r: { id: string }) => r.id)).not.toContain(target.id);
  });

  it("caps results at 10", async () => {
    const users = await Promise.all(
      Array.from({ length: 11 }, (_, i) => createSearchableUser(`cap${i}`, `Cap Limit Match ${i}`)),
    );
    expect(users).toHaveLength(11);

    const { data, error } = await supabase.rpc("search_users_for_invite", {
      p_query: "Cap Limit Match",
      p_project_id: projectId,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(10);
  });

  it("rejects an unauthenticated-style call with a nonexistent project id (no membership oracle)", async () => {
    const { error } = await supabase.rpc("search_users_for_invite", {
      p_query: "anything",
      p_project_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only project owners/i);
  });

  it("rejects a non-owner caller when p_project_id is given", async () => {
    const member = await createSearchableUser("nonowner", "Non Owner Caller");
    await admin.from("project_members").insert({ project_id: projectId, user_id: member.id, role: "member" });
    const memberClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error: signInError } = await memberClient.auth.signInWithPassword({
      email: member.email,
      password: "integration-test-only-password",
    });
    if (signInError) throw new Error(`Sign-in failed: ${signInError.message}`);

    const { error } = await memberClient.rpc("search_users_for_invite", {
      p_query: "anything",
      p_project_id: projectId,
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/only project owners/i);
  });

  it("invites a found user by id and rejects an invalid role", async () => {
    const target = await createSearchableUser("invitee", "Invitee Match");

    const { error: badRoleError } = await supabase.rpc("invite_member", {
      p_project_id: projectId,
      p_user_id: target.id,
      p_role: "admin",
    });
    expect(badRoleError).not.toBeNull();

    const { error } = await supabase.rpc("invite_member", {
      p_project_id: projectId,
      p_user_id: target.id,
      p_role: "viewer",
    });
    expect(error).toBeNull();

    const { data: member } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", target.id)
      .single();
    expect(member?.role).toBe("viewer");
  });

  it("rejects inviting a non-existent user id", async () => {
    const { error } = await supabase.rpc("invite_member", {
      p_project_id: projectId,
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_role: "member",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/no such user/i);
  });
});
