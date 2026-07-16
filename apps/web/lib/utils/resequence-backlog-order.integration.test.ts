import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// TASK-56 slice 2: resequence_backlog_order (20260715000009) — the migration-
// period wrapper persistBacklogOrder now calls to rewrite the whole backlog
// position sequence under the same advisory lock as move_story_board. Exercises
// the dense rewrite plus the two guards the advisor required (both the same
// cross-tenant class rls-security-reviewer found in slice 1's divider branch):
// every id must belong to the project, and the kind/id arrays must line up.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/resequence-backlog-order.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("resequence_backlog_order RPC (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asService: SupabaseClient; // service role: fixtures + reads
  let projectId: string;
  let ownerId: string;

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
    const ownerAuth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }
    ownerId = ownerAuth.data.user.id;

    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name: "resequence_backlog_order integration test", workflow_mode: "tracker" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await asService.from("projects").delete().eq("id", projectId);
    }
  });

  beforeEach(async () => {
    await asService.from("stories").delete().eq("project_id", projectId);
    await asService.from("backlog_dividers").delete().eq("project_id", projectId);
  });

  // Seeds a backlog of two stories + one divider at arbitrary positions and
  // returns their ids so tests can hand a new order to the RPC.
  async function seedBacklog(): Promise<{ s0: string; s1: string; d: string }> {
    const { data: s0 } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "s0", state: "unstarted", iteration_id: null, position: 5, created_by: ownerId })
      .select("id")
      .single();
    const { data: s1 } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "s1", state: "unstarted", iteration_id: null, position: 9, created_by: ownerId })
      .select("id")
      .single();
    const { data: d } = await asService
      .from("backlog_dividers")
      .insert({ project_id: projectId, label: "note", kind: "note", position: 7 })
      .select("id")
      .single();
    return { s0: s0!.id, s1: s1!.id, d: d!.id };
  }

  it("dense-rewrites the interleaved story+divider sequence", async () => {
    const { s0, s1, d } = await seedBacklog();
    // Target order: s1(0), d(1), s0(2).
    const { error } = await asOwner.rpc("resequence_backlog_order", {
      p_project_id: projectId,
      p_kinds: ["story", "divider", "story"],
      p_story_ids: [s1, s0],
      p_divider_ids: [d],
    });
    expect(error).toBeNull();

    const { data: stories } = await asService.from("stories").select("id, position").in("id", [s0, s1]);
    const storyPos = new Map((stories as { id: string; position: number }[]).map((r) => [r.id, r.position]));
    const { data: dRow } = await asService.from("backlog_dividers").select("position").eq("id", d).single();
    expect(storyPos.get(s1)).toBe(0);
    expect((dRow as { position: number }).position).toBe(1);
    expect(storyPos.get(s0)).toBe(2);
  });

  it("rejects an id from another project without touching it (cross-tenant guard)", async () => {
    const { s0 } = await seedBacklog();
    const { data: other } = await asOwner
      .from("projects")
      .insert({ name: "other project", workflow_mode: "tracker" })
      .select("id")
      .single();
    const { data: foreign } = await asService
      .from("stories")
      .insert({ project_id: other!.id, title: "foreign", state: "unstarted", iteration_id: null, position: 3, created_by: ownerId })
      .select("id")
      .single();

    const { error } = await asOwner.rpc("resequence_backlog_order", {
      p_project_id: projectId,
      p_kinds: ["story", "story"],
      p_story_ids: [s0, foreign!.id],
      p_divider_ids: [],
    });
    expect(error?.message).toMatch(/story not in project/i);

    // The foreign story's position is untouched (the guard fires before any write).
    const { data: after } = await asService.from("stories").select("position").eq("id", foreign!.id).single();
    expect((after as { position: number }).position).toBe(3);

    await asService.from("projects").delete().eq("id", other!.id);
  });

  it("rejects a kind/id array length mismatch", async () => {
    const { s0, d } = await seedBacklog();
    // Two 'story' kinds but only one story id.
    const { error } = await asOwner.rpc("resequence_backlog_order", {
      p_project_id: projectId,
      p_kinds: ["story", "story", "divider"],
      p_story_ids: [s0],
      p_divider_ids: [d],
    });
    expect(error?.message).toMatch(/mismatch/i);
  });
});
