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
  let trackerProjectId: string;
  let freeProjectId: string;

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

    const { data: tracker, error: trackerError } = await asOwner
      .from("projects")
      .insert({ name: "position sequence test (tracker)", workflow_mode: "tracker" })
      .select("id")
      .single();
    if (trackerError || !tracker) throw new Error(`Failed to create project: ${trackerError?.message}`);
    trackerProjectId = tracker.id;

    const { data: free, error: freeError } = await asOwner
      .from("projects")
      .insert({ name: "position sequence test (free)", workflow_mode: "free" })
      .select("id")
      .single();
    if (freeError || !free) throw new Error(`Failed to create project: ${freeError?.message}`);
    freeProjectId = free.id;
  });

  afterAll(async () => {
    for (const id of [trackerProjectId, freeProjectId]) {
      if (id) await asService.from("projects").delete().eq("id", id);
    }
  });

  beforeEach(async () => {
    await asService.from("stories").delete().eq("project_id", trackerProjectId);
    await asService.from("backlog_dividers").delete().eq("project_id", trackerProjectId);
    await asService.from("custom_statuses").delete().eq("project_id", freeProjectId);
  });

  // An icebox story sits outside the backlog zone, so the splice never rewrites
  // it: its position is the raw sequence value, which makes it a probe for how
  // far the frontier has moved.
  async function frontierProbe(title: string): Promise<number> {
    const { data, error } = await asOwner
      .from("stories")
      .insert({ project_id: trackerProjectId, title, story_type: "feature", state: "unscheduled" })
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
        p_project_id: trackerProjectId,
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
      p_project_id: trackerProjectId,
      p_kind: "divider",
      p_payload: { label: "a divider", kind: "note" },
      p_anchor: {},
    });
    expect(error).toBeNull();

    const after = await frontierProbe("probe after divider");
    // Dividers share stories_position_seq: the divider + this probe.
    expect(after - before).toBeGreaterThanOrEqual(2);
  });

  async function statusProbe(name: string): Promise<number> {
    const { data, error } = await asOwner
      .from("custom_statuses")
      .insert({ project_id: freeProjectId, name, color: "#000000" })
      .select("position")
      .single();
    if (error || !data) throw new Error(`probe insert failed: ${error?.message}`);
    return data.position;
  }

  it("keeps free-mode template columns in order and consumes the sequence for each", async () => {
    const before = await statusProbe("probe before");

    // Mirrors dashboard/actions.ts createProject: one multi-row insert, no
    // explicit positions. Postgres evaluates the default per row in VALUES
    // order, so array order becomes board order.
    const { error: templateError } = await asOwner.from("custom_statuses").insert([
      { project_id: freeProjectId, name: "Todo", color: "#6b7280", is_done: false },
      { project_id: freeProjectId, name: "This week", color: "#a855f7", is_done: false },
      { project_id: freeProjectId, name: "Today", color: "#f59e0b", is_done: false },
      { project_id: freeProjectId, name: "In progress", color: "#3b82f6", is_done: false },
      { project_id: freeProjectId, name: "Done", color: "#22c55e", is_done: true },
    ]);
    expect(templateError).toBeNull();

    const { data: seeded } = await asService
      .from("custom_statuses")
      .select("name, position")
      .eq("project_id", freeProjectId)
      .in("name", ["Todo", "This week", "Today", "In progress", "Done"])
      .order("position");
    expect(seeded?.map((s) => s.name)).toEqual(["Todo", "This week", "Today", "In progress", "Done"]);

    // createCustomStatus: lands to the right of the whole template, and the
    // delta proves the template rows each took a sequence value rather than
    // being numbered 0..4 behind the frontier's back.
    const after = await statusProbe("probe after");
    expect(after - before).toBeGreaterThanOrEqual(6);
    expect(after).toBeGreaterThan(Math.max(...(seeded ?? []).map((s) => s.position)));
  });

  // TASK-58 slice 2b: UNIQUE(project_id, position), deferrable but enforced at
  // commit. Forcing a collision by hand must be rejected.
  it("rejects two custom_statuses sharing a position in a project", async () => {
    const { data: first, error: firstError } = await asService
      .from("custom_statuses")
      .insert({ project_id: freeProjectId, name: "constraint probe A", color: "#000000" })
      .select("position")
      .single();
    expect(firstError).toBeNull();

    const { error } = await asService
      .from("custom_statuses")
      .insert({ project_id: freeProjectId, name: "constraint probe B", color: "#000000", position: first!.position });
    expect(error?.code).toBe("23505");
  });
});
