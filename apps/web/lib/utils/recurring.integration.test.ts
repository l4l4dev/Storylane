import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-16.4 AC #5/#7: exercises the real `generate_recurring_stories` RPC
// (supabase/migrations/20260709000008_recurring_stories.sql) against a
// running local Supabase instance. This codebase has no other precedent
// for automated DB-RPC testing — `finalize_iteration`'s identical
// claim-then-insert pattern was verified manually only (see
// velocity.test.ts) — but AC #5 explicitly requires the concurrent-claim
// guarantee to be "covered by a test", which a pure-TS unit test can't do
// since the guarantee lives in a single atomic UPDATE statement. Gated
// behind an explicit opt-in so the default `pnpm test` (and CI, unless it
// sets this) never depends on a live local Supabase instance:
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/recurring.integration.test.ts
//
// Requires `supabase start` (or `supabase db reset`) to already be running
// locally with the seeded dev user (apps/web/app/auth/login/page.tsx).
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("generate_recurring_stories RPC (integration)", () => {
  let supabase: SupabaseClient;
  let projectId: string;
  let statusId: string;

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        // vitest runs from the apps/web package root (not this file's own
        // directory) — import.meta.url doesn't reflect the real path under
        // Vite's transform, so resolve relative to the process cwd instead.
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

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .insert({ name: "recurring-stories RPC integration test", workflow_mode: "free" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;

    const { data: status, error: statusError } = await supabase
      .from("custom_statuses")
      .insert({ project_id: projectId, name: "To do", position: 0, is_done: false })
      .select("id")
      .single();
    if (statusError || !status) {
      throw new Error(`Failed to create test status: ${statusError?.message}`);
    }
    statusId = status.id;
  });

  afterAll(async () => {
    if (projectId) {
      // ON DELETE CASCADE takes custom_statuses/recurring_stories/stories/
      // project_members with it (supabase/migrations/20260627000002_projects.sql).
      await supabase.from("projects").delete().eq("id", projectId);
    }
  });

  it("claims a due rule exactly once even when two generation calls race (AC #5)", async () => {
    const { data: rule, error: ruleError } = await supabase
      .from("recurring_stories")
      .insert({ project_id: projectId, title: "Daily standup note", custom_status_id: statusId, cadence: "daily" })
      .select("id")
      .single();
    if (ruleError || !rule) {
      throw new Error(`Failed to create test rule: ${ruleError?.message}`);
    }

    const [first, second] = await Promise.all([
      supabase.rpc("generate_recurring_stories", { p_project_id: projectId }),
      supabase.rpc("generate_recurring_stories", { p_project_id: projectId }),
    ]);
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const { data: stories, error: storiesError } = await supabase
      .from("stories")
      .select("id")
      .eq("project_id", projectId)
      .eq("title", "Daily standup note");
    expect(storiesError).toBeNull();
    expect(stories).toHaveLength(1);
  });

  it("does not regenerate a rule's story after the generated instance is deleted (AC #7)", async () => {
    const { data: stories } = await supabase
      .from("stories")
      .select("id")
      .eq("project_id", projectId)
      .eq("title", "Daily standup note");
    expect(stories).toHaveLength(1);

    await supabase.from("stories").delete().eq("id", stories![0].id);

    const { error } = await supabase.rpc("generate_recurring_stories", { p_project_id: projectId });
    expect(error).toBeNull();

    const { data: afterRegeneration } = await supabase
      .from("stories")
      .select("id")
      .eq("project_id", projectId)
      .eq("title", "Daily standup note");
    expect(afterRegeneration).toHaveLength(0);
  });
});
