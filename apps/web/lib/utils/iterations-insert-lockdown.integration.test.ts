import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-110 (doc-13 finding #1): iterations INSERT is locked down to the
// SECURITY DEFINER RPCs — a member must not be able to forge a finished-sprint
// row (state/number/velocity/capacity) straight through PostgREST. RLS can't
// restrict values, so the guard is a revoked table-level INSERT grant +
// dropped INSERT policy (20260721000006_iterations_insert_lockdown.sql); only
// a real DB proves both halves (client INSERT denied, RPC path unaffected):
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/iterations-insert-lockdown.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) with the seeded dev user.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("iterations INSERT lockdown (integration)", () => {
  let supabase: SupabaseClient;
  const projectIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // .env.local not found — the explicit check below fails loudly instead.
      }
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY must be set");
    }
    supabase = createClient(url, anonKey);
    const { error } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (error) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${error.message}`);
    }
  });

  afterAll(async () => {
    for (const id of projectIds) {
      await supabase.from("projects").delete().eq("id", id);
    }
  });

  async function createProject(name: string): Promise<string> {
    const { data, error } = await supabase
      .from("projects")
      .insert({ name, iteration_length: 14 })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to create test project: ${error?.message}`);
    projectIds.push(data.id);
    return data.id;
  }

  it("rejects a direct authenticated INSERT into iterations (the forged-history exploit)", async () => {
    const projectId = await createProject("insert-lockdown attack");

    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("iterations").insert({
      project_id: projectId,
      number: 999999,
      start_date: today,
      end_date: today,
      state: "done",
      velocity: 999999,
      capacity: 0.001,
    });

    // The revoked grant surfaces as a permission error, not a silent success.
    expect(error).not.toBeNull();

    const { data: rows } = await supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .eq("number", 999999);
    expect(rows ?? []).toHaveLength(0);
  });

  it("still lets finalize_iteration (SECURITY DEFINER) create iterations", async () => {
    const projectId = await createProject("insert-lockdown rpc path");

    const { error } = await supabase.rpc("finalize_iteration", {
      p_project_id: projectId,
      p_manual: false,
    });
    expect(error).toBeNull();

    const { data: rows } = await supabase
      .from("iterations")
      .select("id, number, state")
      .eq("project_id", projectId);
    expect((rows ?? []).length).toBeGreaterThanOrEqual(1);
    expect(rows?.[0]?.number).toBe(1);
  });
});
