import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// TASK-58 slice 2a: `position` is issued by a per-table sequence
// (20260716000004) and the guarantee that a default insert appends rests on one
// invariant — every INSERT into a positioned table consumes the sequence
// (20260716000005). The rewrites only write dense ranks, and a rank stays below
// the row count, so the frontier outruns them only while nothing inserts behind
// its back. These tests pin that: they fail if a writer starts passing an
// explicit position again.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/position-sequence.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("position sequence invariant (integration)", () => {
  let asOwner: SupabaseClient;
  let asService: SupabaseClient;
  let projectId: string;

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // fall through; missing env fails loudly below.
      }
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    asService = createClient(url, serviceKey, { auth: { persistSession: false } });
    asOwner = createClient(url, anonKey);
    const auth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error.message}`);
    }

    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name: "position sequence test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create project: ${projectError?.message}`);
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) await asService.from("projects").delete().eq("id", projectId);
  });

  beforeEach(async () => {
    await asService.from("stories").delete().eq("project_id", projectId);
    await asService.from("backlog_dividers").delete().eq("project_id", projectId);
  });

  // An icebox story sits outside the backlog zone, so the splice never rewrites
  // it: its position is the raw sequence value, which makes it a probe for how
  // far the frontier has moved.
  async function frontierProbe(title: string): Promise<number> {
    const { data, error } = await asOwner
      .from("stories")
      .insert({ project_id: projectId, title, story_type: "feature", state_id: null })
      .select("position")
      .single();
    if (error || !data) throw new Error(`probe insert failed: ${error?.message}`);
    return data.position;
  }

  // Measured as a delta, not against a fixed value: the sequence is global and
  // whatever else the suite created has already moved it, so only the distance
  // between two probes says whether the calls in between consumed. Asserting
  // "lands above the densified backlog" instead would pass for free whenever
  // the frontier happens to sit high, which is how the missing consumption
  // survived review in the first place.
  it("advances the story position sequence once per backlog insert", async () => {
    const before = await frontierProbe("probe before");

    for (let i = 0; i < 5; i++) {
      const { error } = await asOwner.rpc("insert_board_item", {
        p_project_id: projectId,
        p_kind: "story",
        p_payload: { title: `backlog ${i}` },
        p_anchor: {},
      });
      expect(error).toBeNull();
    }

    const after = await frontierProbe("probe after");
    // 5 backlog stories + this probe itself.
    expect(after - before).toBeGreaterThanOrEqual(6);
  });

  it("advances the story position sequence for a divider too", async () => {
    const before = await frontierProbe("probe before divider");

    const { error } = await asOwner.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "divider",
      p_payload: { label: "a divider", kind: "note" },
      p_anchor: {},
    });
    expect(error).toBeNull();

    const after = await frontierProbe("probe after divider");
    // Dividers share stories_position_seq: the divider + this probe.
    expect(after - before).toBeGreaterThanOrEqual(2);
  });
});
