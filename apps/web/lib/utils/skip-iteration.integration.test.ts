import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-38 AC #3/#4/#5: exercises the real `finalize_iteration` RPC
// (supabase/migrations/20260715000002_skip_iteration.sql) against a running
// local Supabase instance — the skip semantics and the double-click guard
// live inside the SQL and can't be proven by a pure-TS unit test. Same
// opt-in gate and setup as recurring.integration.test.ts:
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/skip-iteration.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) running locally with
// the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type FinalizeEvent = {
  kind: string;
  number?: number;
  skipped?: boolean;
  reason?: string;
};

describe.skipIf(!RUN)("finalize_iteration skip behaviour (integration)", () => {
  let supabase: SupabaseClient;
  let projectId: string;

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

    // Tracker project (iteration_length
    // to 14 — 20260627000002_projects.sql). Creating it makes the dev user
    // its owner, so manual finish (owner/member only) is permitted.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: "skip-iteration RPC integration test" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await supabase.from("projects").delete().eq("id", projectId);
    }
  });

  async function latestIterations() {
    const { data } = await supabase
      .from("iterations")
      .select("id, number, start_date, end_date, state, skipped")
      .eq("project_id", projectId)
      .order("number", { ascending: true });
    return data ?? [];
  }

  it("skips a not-yet-started iteration and keeps the double-click safe (AC #3/#4/#5)", async () => {
    const todayKey = new Date().toISOString().slice(0, 10);

    // Bootstrap iteration #1 (fresh project → starts today).
    const seed = await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seed.error).toBeNull();

    let iterations = await latestIterations();
    expect(iterations).toHaveLength(1);
    const iter1 = iterations[0];

    // Manual finish #1 → #1 done, #2 created starting tomorrow (future).
    const finish1 = await supabase.rpc("finalize_iteration", {
      p_project_id: projectId,
      p_manual: true,
      p_iteration_id: iter1.id,
    });
    expect(finish1.error).toBeNull();

    iterations = await latestIterations();
    expect(iterations).toHaveLength(2);
    const iter2 = iterations[1];
    expect(iter2.number).toBe(2);
    expect(iter2.skipped).toBe(false);
    // #2 starts strictly in the future (tomorrow), so finishing it is a skip.
    expect(iter2.start_date > todayKey).toBe(true);

    // Manual finish #2 (not yet started) → SKIP.
    const finish2 = await supabase.rpc("finalize_iteration", {
      p_project_id: projectId,
      p_manual: true,
      p_iteration_id: iter2.id,
    });
    expect(finish2.error).toBeNull();
    const events2 = finish2.data as FinalizeEvent[];
    const finalized = events2.find((e) => e.kind === "finalized" && e.number === 2);
    expect(finalized?.skipped).toBe(true);
    expect(events2.some((e) => e.kind === "started" && e.number === 3)).toBe(true);

    iterations = await latestIterations();
    expect(iterations).toHaveLength(3);
    const skipped = iterations[1];
    const successor = iterations[2];
    expect(skipped.number).toBe(2);
    expect(skipped.state).toBe("done");
    expect(skipped.skipped).toBe(true);
    // Zero-length: end_date collapsed onto start_date (never before it).
    expect(skipped.end_date).toBe(skipped.start_date);
    // Successor starts the day after the skipped iteration's start_date.
    expect(successor.number).toBe(3);
    expect(successor.start_date > skipped.start_date).toBe(true);
    expect(successor.skipped).toBe(false);

    // Double-click / raced second finish naming the already-skipped #2:
    // must no-op, not cascade into skipping the fresh #3.
    const doubleClick = await supabase.rpc("finalize_iteration", {
      p_project_id: projectId,
      p_manual: true,
      p_iteration_id: iter2.id,
    });
    expect(doubleClick.error).toBeNull();
    const events3 = doubleClick.data as FinalizeEvent[];
    expect(events3.some((e) => e.kind === "noop" && e.reason === "already_finished")).toBe(true);

    // No runaway iteration creation — still exactly #1/#2/#3.
    const after = await latestIterations();
    expect(after).toHaveLength(3);

    // AC #4: the skipped row carries the flag the velocity-window filter
    // (board/page.tsx, dashboard/page.tsx) keys on to drop its 0 velocity.
    // The exclusion arithmetic itself is unit-tested in velocity.test.ts;
    // this proves the DB actually sets the flag.
    expect(skipped.skipped).toBe(true);
    expect(skipped.state).toBe("done");
  });
});
