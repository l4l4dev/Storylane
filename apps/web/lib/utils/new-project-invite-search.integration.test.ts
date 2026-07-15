import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-7: exercises search_users_for_new_project
// (supabase/migrations/20260713000001_search_users_for_new_project.sql)
// against a running local Supabase instance, following the precedent set
// by invite-search.integration.test.ts.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/new-project-invite-search.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) already running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("search_users_for_new_project RPC (integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  const createdUserIds: string[] = [];
  let selfId: string;

  async function createSearchableUser(usernameSuffix: string, displayName: string) {
    const email = `new-project-search-${usernameSuffix}-${Date.now()}@storylane.local`;
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: "integration-test-only-password",
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !created.user) throw new Error(`Failed to create test user: ${error?.message}`);
    createdUserIds.push(created.user.id);
    const username = `npsearch_${usernameSuffix}_${created.user.id.replace(/-/g, "").slice(0, 8)}`;
    const { error: profileError } = await admin
      .from("profiles")
      .update({ username, display_name: displayName })
      .eq("id", created.user.id);
    if (profileError) throw new Error(`Failed to set test profile: ${profileError.message}`);
    return { id: created.user.id, username };
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
    const { data: me } = await supabase.auth.getUser();
    selfId = me.user!.id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("matches an exact username case-insensitively", async () => {
    const target = await createSearchableUser("exact", "Exact Match User");
    const { data, error } = await supabase.rpc("search_users_for_new_project", {
      p_query: target.username.toUpperCase(),
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].id).toBe(target.id);
  });

  it("returns nothing for a partial/substring match", async () => {
    const target = await createSearchableUser("partial", "Partial Match User");
    const { data, error } = await supabase.rpc("search_users_for_new_project", {
      p_query: target.username.slice(0, target.username.length - 2),
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("returns nothing for a query that fails the username format check", async () => {
    const { data, error } = await supabase.rpc("search_users_for_new_project", {
      p_query: "a b!",
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("excludes the caller's own username", async () => {
    const { data: mine } = await admin.from("profiles").select("username").eq("id", selfId).single();
    const { data, error } = await supabase.rpc("search_users_for_new_project", {
      p_query: mine!.username,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("rejects an unauthenticated call", async () => {
    const anonClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await anonClient.rpc("search_users_for_new_project", { p_query: "anyone" });
    expect(error).not.toBeNull();
    // Post-TASK-55: anon has no EXECUTE grant on the function, so PostgREST
    // rejects it at the permission layer before the internal "not signed in"
    // guard even runs — defense in depth. Either message is a valid rejection.
    expect(error?.message).toMatch(/permission denied for function|not signed in/i);
  });
});
