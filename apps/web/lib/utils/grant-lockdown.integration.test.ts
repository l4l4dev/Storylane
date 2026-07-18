import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-55 backstop: asserts the function EXECUTE lockdown
// (supabase/migrations/20260715000005_function_grant_lockdown.sql) holds, and
// keeps holding. `alter default privileges ... revoke` does NOT make new
// functions private-by-default (Postgres still grants EXECUTE to PUBLIC on
// CREATE), so a future migration that adds a public function without managing
// its grants would silently ship it callable by `authenticated`/`anon`. This
// test fails loudly in that case. Adding a legitimate new RPC means adding it
// to AUTHENTICATED_ALLOWLIST below — the intended friction that forces a
// conscious grant decision.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/grant-lockdown.integration.test.ts
//
// Uses the service-role client to read the catalog (has_function_privilege).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

// The only public functions `authenticated` may execute: the 3 policy-referenced
// helpers + the web app's .rpc() entry points. Keep in sync with
// 20260715000005 (and every later migration that adds/removes a user-facing RPC).
const AUTHENTICATED_ALLOWLIST = new Set([
  // policy-referenced (executed by the querying role inside RLS)
  "project_role",
  "is_project_member",
  "shares_project_with",
  // web entry-point RPCs
  "change_member_role",
  "remove_member",
  "invite_member",
  "finalize_iteration",
  "promote_story_to_epic",
  "move_story_to_project",
  "copy_story_to_project",
  "search_users_for_invite",
  "search_users_for_new_project",
  "toggle_project_favorite",
  "update_story",
  "move_story_board",
  "insert_board_item",
  "transition_story",
]);

type FnPriv = { name: string; auth: boolean; anon: boolean };

describe.skipIf(!RUN)("function EXECUTE grant lockdown (integration)", () => {
  let admin: SupabaseClient;
  let rows: FnPriv[];

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

    // _grant_audit (20260715000005, service_role-only) returns
    // has_function_privilege for every public function in one round-trip —
    // PostgREST can't select pg_proc directly.
    const { data, error } = await admin.rpc("_grant_audit");
    if (error || !data) {
      throw new Error(`_grant_audit RPC failed (is the local DB migrated?): ${error?.message}`);
    }
    rows = data as FnPriv[];
  });

  afterAll(() => {
    // no-op: read-only test
  });

  it("authenticated can execute only the allowlisted functions", () => {
    const unexpected = rows.filter((r) => r.auth && !AUTHENTICATED_ALLOWLIST.has(r.name));
    expect(unexpected.map((r) => r.name)).toEqual([]);
  });

  it("every allowlisted function is actually executable by authenticated", () => {
    const present = new Set(rows.filter((r) => r.auth).map((r) => r.name));
    const missing = [...AUTHENTICATED_ALLOWLIST].filter((n) => !present.has(n));
    expect(missing).toEqual([]);
  });

  it("anon can execute no public function", () => {
    const anonExecutable = rows.filter((r) => r.anon).map((r) => r.name);
    expect(anonExecutable).toEqual([]);
  });
});
