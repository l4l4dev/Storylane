import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-56: the transactional board move + reorder RPC (move_story_board,
// 20260715000008). Exercises the RPC directly to prove the properties the
// per-action Promise.all pattern could not guarantee: an atomic dense
// resequence, a stale-snapshot rejection, current-iteration re-resolution
// under the lock, and the two-table backlog splice.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/move-story-board.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type StoryRow = { id: string; position: number; state: string; iteration_id: string | null };

describe.skipIf(!RUN)("move_story_board RPC (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asService: SupabaseClient; // service role: fixtures + reads
  let projectId: string;
  let iterationId: string;
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
      .insert({ name: "move_story_board integration test" })
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

  // Fresh iteration + stories per test so ordering assertions don't bleed.
  async function seedCurrentIteration(stories: { state: string; position: number }[]): Promise<string[]> {
    await asService.from("stories").delete().eq("project_id", projectId);
    await asService.from("iterations").delete().eq("project_id", projectId);
    const { data: iter, error: iterError } = await asService
      .from("iterations")
      .insert({ project_id: projectId, number: 1, state: "active", start_date: "2026-07-01", end_date: "2026-07-14" })
      .select("id")
      .single();
    if (iterError || !iter) {
      throw new Error(`Failed to seed iteration: ${iterError?.message}`);
    }
    iterationId = iter.id;
    const ids: string[] = [];
    for (const s of stories) {
      const { data, error } = await asService
        .from("stories")
        .insert({ project_id: projectId, title: `s${s.position}`, state: s.state, iteration_id: iterationId, position: s.position, created_by: ownerId })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed story: ${error?.message}`);
      }
      ids.push(data.id);
    }
    return ids;
  }

  async function positionsOf(ids: string[]): Promise<number[]> {
    const { data } = await asService.from("stories").select("id, position").in("id", ids);
    const byId = new Map((data as StoryRow[]).map((r) => [r.id, r.position]));
    return ids.map((id) => byId.get(id)!);
  }

  it("reorders a column densely and atomically (AC #1)", async () => {
    const [a, b, c] = await seedCurrentIteration([
      { state: "started", position: 0 },
      { state: "started", position: 1 },
      { state: "started", position: 2 },
    ]);
    // Move c before a → expected order c, a, b.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: c },
      p_view: "tracker",
      p_expected: { state: "started", iteration_id: iterationId, focus: null },
      p_deltas: {},
      p_anchor: { before: { kind: "story", id: a } },
    });
    expect(error).toBeNull();
    expect(await positionsOf([c, a, b])).toEqual([0, 1, 2]);
  });

  it("applies a state transition and reseats the story in the target column", async () => {
    const [a] = await seedCurrentIteration([
      { state: "started", position: 0 },
      { state: "finished", position: 0 },
    ]);
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      p_expected: { state: "started", iteration_id: iterationId, focus: null },
      p_deltas: { state: "finished" },
      p_anchor: {}, // append to the finished column
    });
    expect(error).toBeNull();
    const { data } = await asService.from("stories").select("state").eq("id", a).single();
    expect((data as { state: string }).state).toBe("finished");
  });

  it("rejects a move whose snapshot no longer matches (AC #2, stale)", async () => {
    const [a] = await seedCurrentIteration([{ state: "started", position: 0 }]);
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      p_expected: { state: "unstarted", iteration_id: iterationId, focus: null },
      p_deltas: { state: "finished" },
      p_anchor: {},
    });
    expect(error?.message).toMatch(/stale/i);
    // The state must be untouched.
    const { data } = await asService.from("stories").select("state").eq("id", a).single();
    expect((data as { state: string }).state).toBe("started");
  });

  it("rejects the loser of two competing transitions (AC #4)", async () => {
    const [a] = await seedCurrentIteration([{ state: "started", position: 0 }]);
    const expected = { state: "started", iteration_id: iterationId, focus: null };
    const first = await asOwner.rpc("move_story_board", {
      p_project_id: projectId, p_item: { kind: "story", id: a }, p_view: "tracker",
      p_expected: expected, p_deltas: { state: "finished" }, p_anchor: {},
    });
    expect(first.error).toBeNull();
    // Second drag validated against the same (now stale) 'started' snapshot.
    const second = await asOwner.rpc("move_story_board", {
      p_project_id: projectId, p_item: { kind: "story", id: a }, p_view: "tracker",
      p_expected: expected, p_deltas: { state: "delivered" }, p_anchor: {},
    });
    expect(second.error?.message).toMatch(/stale/i);
  });

  it("re-resolves iteration='current' under the lock", async () => {
    const [a] = await seedCurrentIteration([{ state: "started", position: 0 }]);
    // Detach to the backlog first.
    await asService.from("stories").update({ iteration_id: null, state: "unstarted" }).eq("id", a);
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      p_expected: { state: "unstarted", iteration_id: null, focus: null },
      p_deltas: { state: "started", iteration: "current" },
      p_anchor: {},
    });
    expect(error).toBeNull();
    const { data } = await asService.from("stories").select("iteration_id, state").eq("id", a).single();
    expect((data as StoryRow).iteration_id).toBe(iterationId);
    expect((data as { state: string }).state).toBe("started");
  });

  it("splices a story into the backlog's shared story+divider sequence", async () => {
    await asService.from("stories").delete().eq("project_id", projectId);
    await asService.from("iterations").delete().eq("project_id", projectId);
    await asService.from("backlog_dividers").delete().eq("project_id", projectId);
    // Backlog order: story s0(pos0), divider d(pos1), story s1(pos2).
    const { data: s0 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "s0", state: "unstarted", iteration_id: null, position: 0, created_by: ownerId }).select("id").single();
    const { data: d } = await asService.from("backlog_dividers")
      .insert({ project_id: projectId, label: "note", kind: "note", position: 1 }).select("id").single();
    const { data: s1 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "s1", state: "unstarted", iteration_id: null, position: 2, created_by: ownerId }).select("id").single();

    // Move s1 before the divider → order s0, s1, d.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: s1!.id },
      p_view: "list",
      p_expected: { state: "unstarted", iteration_id: null, focus: null },
      p_deltas: {},
      p_anchor: { before: { kind: "divider", id: d!.id } },
    });
    expect(error).toBeNull();
    const sp = await positionsOf([s0!.id, s1!.id]);
    const { data: dRow } = await asService.from("backlog_dividers").select("position").eq("id", d!.id).single();
    expect(sp).toEqual([0, 1]);
    expect((dRow as { position: number }).position).toBe(2);
  });

  it("splices into the Backlog zone while an active iteration exists (doc-3 #1 regression)", async () => {
    // The List Backlog zone predicate was NULL-unsafe: a backlog story has
    // iteration_id NULL, so `v_new_iteration = v_current_id` was NULL and the
    // zone fell through to 'single' whenever an active iteration existed —
    // renumbering the CURRENT iteration's stories instead of the two-table
    // backlog. This seeds BOTH an active iteration and a backlog, moves within
    // the backlog, and asserts the iteration is untouched.
    await asService.from("stories").delete().eq("project_id", projectId);
    await asService.from("iterations").delete().eq("project_id", projectId);
    await asService.from("backlog_dividers").delete().eq("project_id", projectId);
    const { data: iter } = await asService
      .from("iterations")
      .insert({ project_id: projectId, number: 1, state: "active", start_date: "2026-07-01", end_date: "2026-07-14" })
      .select("id")
      .single();
    // A scheduled story at a non-dense position 5 — if the buggy 'single' path
    // renumbers the current iteration, this becomes 0.
    const { data: iterStory } = await asService.from("stories")
      .insert({ project_id: projectId, title: "scheduled", state: "started", iteration_id: iter!.id, position: 5, created_by: ownerId }).select("id").single();
    // Backlog: story sb0(pos0), divider d(pos1), story sb1(pos2).
    const { data: sb0 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "sb0", state: "unstarted", iteration_id: null, position: 0, created_by: ownerId }).select("id").single();
    const { data: d } = await asService.from("backlog_dividers")
      .insert({ project_id: projectId, label: "note", kind: "note", position: 1 }).select("id").single();
    const { data: sb1 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "sb1", state: "unstarted", iteration_id: null, position: 2, created_by: ownerId }).select("id").single();

    // Move sb1 before the divider → backlog order sb0(0), sb1(1), d(2).
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: sb1!.id },
      p_view: "list",
      p_expected: { state: "unstarted", iteration_id: null, focus: null },
      p_deltas: {},
      p_anchor: { before: { kind: "divider", id: d!.id } },
    });
    expect(error).toBeNull();
    expect(await positionsOf([sb0!.id, sb1!.id])).toEqual([0, 1]);
    const { data: dRow } = await asService.from("backlog_dividers").select("position").eq("id", d!.id).single();
    expect((dRow as { position: number }).position).toBe(2);
    // The active iteration's story keeps its position — the backlog splice must
    // not have touched the 'single' current-iteration zone.
    const { data: iterRow } = await asService.from("stories").select("position").eq("id", iterStory!.id).single();
    expect((iterRow as { position: number }).position).toBe(5);
  });

  it("rejects moving a divider that isn't in this project (cross-tenant guard)", async () => {
    // A divider owned by a *different* project must not be mutable via this
    // project's move — SECURITY DEFINER bypasses RLS, so the RPC must guard.
    // Created via asOwner so the projects owner-membership trigger has an
    // auth.uid(); the caller owning both projects still exercises the guard,
    // which is project-scoped (divider not in p_project_id), not membership-scoped.
    const { data: other } = await asOwner
      .from("projects")
      .insert({ name: "other project" })
      .select("id")
      .single();
    const { data: foreign } = await asOwner
      .from("backlog_dividers")
      .insert({ project_id: other!.id, label: "foreign", kind: "note", position: 7 })
      .select("id")
      .single();

    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "divider", id: foreign!.id },
      p_view: "list",
      p_expected: {},
      p_deltas: {},
      p_anchor: {},
    });
    expect(error?.message).toMatch(/divider not found/i);
    // The foreign divider's position is untouched.
    const { data: after } = await asService.from("backlog_dividers").select("position").eq("id", foreign!.id).single();
    expect((after as { position: number }).position).toBe(7);

    await asService.from("projects").delete().eq("id", other!.id);
  });
});
