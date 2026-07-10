import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// TASK-25 (follow-up from TASK-7 PR #2): exercises the
// projects_velocity_window_check CHECK constraint added in
// supabase/migrations/20260714000001_velocity_window_check.sql against a
// running local Supabase instance.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/velocity-window-check.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("projects_velocity_window_check (integration)", () => {
  let supabase: SupabaseClient;
  const createdProjectIds: string[] = [];

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
    if (!url || !anonKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set for the integration test");
    }

    supabase = createClient(url, anonKey);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (authError) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running locally?): ${authError.message}`);
    }
  });

  afterEach(async () => {
    for (const id of createdProjectIds.splice(0)) {
      await supabase.from("projects").delete().eq("id", id);
    }
  });

  it("rejects a 0 velocity_window", async () => {
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: "velocity-window-check zero", velocity_window: 0 })
      .select("id")
      .single();
    if (data) createdProjectIds.push(data.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/projects_velocity_window_check/i);
  });

  it("rejects a negative velocity_window", async () => {
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: "velocity-window-check negative", velocity_window: -5 })
      .select("id")
      .single();
    if (data) createdProjectIds.push(data.id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/projects_velocity_window_check/i);
  });

  it("accepts a positive velocity_window", async () => {
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: "velocity-window-check positive", velocity_window: 5 })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data) createdProjectIds.push(data.id);
  });
});
