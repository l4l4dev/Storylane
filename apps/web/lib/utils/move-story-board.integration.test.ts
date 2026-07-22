import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-56: the transactional board move + reorder RPC (move_story_board,
// 20260715000008, re-anchored onto stories.state_id by TASK-91). Exercises
// the RPC directly to prove the properties the per-action Promise.all
// pattern could not guarantee: an atomic dense resequence, a
// stale-snapshot rejection, current-iteration re-resolution under the
// lock, and the two-table backlog splice.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/move-story-board.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type StoryRow = { id: string; position: number; state_id: string | null; iteration_id: string | null };

describe.skipIf(!RUN)("move_story_board RPC (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asService: SupabaseClient; // service role: fixtures + reads
  let projectId: string;
  let iterationId: string;
  let ownerId: string;
  // classic-template state ids, resolved once the project exists.
  let states: Record<"Unstarted" | "Started" | "Finished" | "Delivered" | "Accepted" | "Rejected", string>;

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

    const { data: stateRows } = await asService.from("project_states").select("id, name").eq("project_id", projectId);
    states = Object.fromEntries((stateRows ?? []).map((s) => [s.name, s.id])) as typeof states;
  });

  afterAll(async () => {
    if (projectId) {
      await asService.from("projects").delete().eq("id", projectId);
    }
  });

  // Fresh iteration + stories per test so ordering assertions don't bleed.
  async function seedCurrentIteration(stories: { stateId: string; position: number }[]): Promise<string[]> {
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
        .insert({
          project_id: projectId,
          title: `s${s.position}`,
          state_id: s.stateId,
          points: 2,
          iteration_id: iterationId,
          position: s.position,
          created_by: ownerId,
        })
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
      { stateId: states.Started, position: 0 },
      { stateId: states.Started, position: 1 },
      { stateId: states.Started, position: 2 },
    ]);
    // Move c before a → expected order c, a, b.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: c },
      p_view: "tracker",
      p_expected: { state_id: states.Started, iteration_id: iterationId },
      p_deltas: {},
      p_anchor: { before: { kind: "story", id: a } },
    });
    expect(error).toBeNull();
    expect(await positionsOf([c, a, b])).toEqual([0, 1, 2]);
  });

  it("applies a state transition and reseats the story in the target column", async () => {
    const [a] = await seedCurrentIteration([
      { stateId: states.Started, position: 0 },
      { stateId: states.Finished, position: 0 },
    ]);
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      p_expected: { state_id: states.Started, iteration_id: iterationId },
      p_deltas: { state_id: states.Finished },
      p_anchor: {}, // append to the finished column
    });
    expect(error).toBeNull();
    const { data } = await asService.from("stories").select("state_id").eq("id", a).single();
    expect((data as { state_id: string }).state_id).toBe(states.Finished);
  });

  it("rejects a move whose snapshot no longer matches (AC #2, stale)", async () => {
    const [a] = await seedCurrentIteration([{ stateId: states.Started, position: 0 }]);
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      p_expected: { state_id: states.Unstarted, iteration_id: iterationId },
      p_deltas: { state_id: states.Finished },
      p_anchor: {},
    });
    expect(error?.message).toMatch(/stale/i);
    // The state must be untouched.
    const { data } = await asService.from("stories").select("state_id").eq("id", a).single();
    expect((data as { state_id: string }).state_id).toBe(states.Started);
  });

  it("rejects the loser of two competing transitions (AC #4)", async () => {
    const [a] = await seedCurrentIteration([{ stateId: states.Started, position: 0 }]);
    const expected = { state_id: states.Started, iteration_id: iterationId };
    const first = await asOwner.rpc("move_story_board", {
      p_project_id: projectId, p_item: { kind: "story", id: a }, p_view: "tracker",
      p_expected: expected, p_deltas: { state_id: states.Finished }, p_anchor: {},
    });
    expect(first.error).toBeNull();
    // Second drag validated against the same (now stale) 'Started' snapshot.
    const second = await asOwner.rpc("move_story_board", {
      p_project_id: projectId, p_item: { kind: "story", id: a }, p_view: "tracker",
      p_expected: expected, p_deltas: { state_id: states.Delivered }, p_anchor: {},
    });
    expect(second.error?.message).toMatch(/stale/i);
  });

  it("re-resolves iteration='current' under the lock", async () => {
    const [a] = await seedCurrentIteration([{ stateId: states.Started, position: 0 }]);
    // Detach to the backlog first.
    await asService.from("stories").update({ iteration_id: null, state_id: states.Unstarted }).eq("id", a);
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      p_expected: { state_id: states.Unstarted, iteration_id: null },
      p_deltas: { state_id: states.Started, iteration: "current" },
      p_anchor: {},
    });
    expect(error).toBeNull();
    const { data } = await asService.from("stories").select("iteration_id, state_id").eq("id", a).single();
    expect((data as StoryRow).iteration_id).toBe(iterationId);
    expect((data as { state_id: string }).state_id).toBe(states.Started);
  });

  it("splices a story into the backlog's shared story+divider sequence", async () => {
    await asService.from("stories").delete().eq("project_id", projectId);
    await asService.from("iterations").delete().eq("project_id", projectId);
    await asService.from("backlog_dividers").delete().eq("project_id", projectId);
    // Backlog order: story s0(pos0), divider d(pos1), story s1(pos2).
    const { data: s0 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "s0", state_id: states.Unstarted, iteration_id: null, position: 0, created_by: ownerId }).select("id").single();
    const { data: d } = await asService.from("backlog_dividers")
      .insert({ project_id: projectId, label: "note", kind: "note", position: 1 }).select("id").single();
    const { data: s1 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "s1", state_id: states.Unstarted, iteration_id: null, position: 2, created_by: ownerId }).select("id").single();

    // Move s1 before the divider → order s0, s1, d.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: s1!.id },
      p_view: "list",
      p_expected: { state_id: states.Unstarted, iteration_id: null },
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
      .insert({ project_id: projectId, title: "scheduled", state_id: states.Started, iteration_id: iter!.id, position: 5, created_by: ownerId }).select("id").single();
    // Backlog: story sb0(pos0), divider d(pos1), story sb1(pos2).
    const { data: sb0 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "sb0", state_id: states.Unstarted, iteration_id: null, position: 0, created_by: ownerId }).select("id").single();
    const { data: d } = await asService.from("backlog_dividers")
      .insert({ project_id: projectId, label: "note", kind: "note", position: 1 }).select("id").single();
    const { data: sb1 } = await asService.from("stories")
      .insert({ project_id: projectId, title: "sb1", state_id: states.Unstarted, iteration_id: null, position: 2, created_by: ownerId }).select("id").single();

    // Move sb1 before the divider → backlog order sb0(0), sb1(1), d(2).
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: sb1!.id },
      p_view: "list",
      p_expected: { state_id: states.Unstarted, iteration_id: null },
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

  // TASK-111 (doc-13 #2): a Kanban within-column reorder must keep positions as
  // ONE iteration-wide sequence so the List view (flat, position-ordered) never
  // interleaves columns wrongly. The old tracker branch re-densified only the
  // moved story's own state column, colliding with other columns' positions.
  it("keeps a single iteration-wide sequence after a Kanban within-column reorder (AC #2)", async () => {
    // Interleaved global layout: Started at 0/2, Finished at 1/3.
    const [sA0, sF0, sA1, sF1] = await seedCurrentIteration([
      { stateId: states.Started, position: 0 },
      { stateId: states.Finished, position: 1 },
      { stateId: states.Started, position: 2 },
      { stateId: states.Finished, position: 3 },
    ]);
    // Kanban-reorder within Started: move sA1 before sA0.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: sA1 },
      p_view: "tracker",
      p_expected: { state_id: states.Started, iteration_id: iterationId },
      p_deltas: {},
      p_anchor: { before: { kind: "story", id: sA0 } },
    });
    expect(error).toBeNull();
    // One dense 0..3 sequence, no cross-column collision: Started column
    // subsequence is [sA1, sA0] (reordered), Finished [sF0, sF1] (untouched).
    // The old per-column densify would have produced position 1 twice.
    expect(await positionsOf([sA1, sA0, sF0, sF1])).toEqual([0, 1, 2, 3]);
  });

  it("drops a Kanban card at a column's end right after that column's tail, not the iteration's (AC #2)", async () => {
    // Started 0/1, Finished 2/3 — Finished sits after Started's tail globally.
    const [sA0, sA1, sF0, sF1] = await seedCurrentIteration([
      { stateId: states.Started, position: 0 },
      { stateId: states.Started, position: 1 },
      { stateId: states.Finished, position: 2 },
      { stateId: states.Finished, position: 3 },
    ]);
    // Move sF0 into the Started column, dropped at its end (no anchor).
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: sF0 },
      p_view: "tracker",
      p_expected: { state_id: states.Finished, iteration_id: iterationId },
      p_deltas: { state_id: states.Started },
      p_anchor: {},
    });
    expect(error).toBeNull();
    // sF0 lands right after Started's tail (sA1), i.e. before sF1 in List order
    // — NOT appended to the iteration's absolute bottom (which would put it
    // after sF1). Result: sA0, sA1, sF0, sF1.
    expect(await positionsOf([sA0, sA1, sF0, sF1])).toEqual([0, 1, 2, 3]);
  });

  // TASK-134: a tracker move whose story is no longer in the current iteration
  // (a done-category story left behind by a mid-drag finalize keeps its
  // iteration_id, and its unchanged state/iteration slips past the staleness
  // check) must be REJECTED, not renumbered into the current iteration's space.
  it("rejects a tracker reorder on a story whose iteration is no longer current (TASK-134)", async () => {
    const [a] = await seedCurrentIteration([{ stateId: states.Accepted, position: 0 }]);
    const staleIterationId = iterationId;
    // The story's iteration is finalized; a newer one becomes current.
    await asService.from("iterations").update({ state: "done" }).eq("id", staleIterationId);
    await asService
      .from("iterations")
      .insert({ project_id: projectId, number: 2, state: "active", start_date: "2026-07-15", end_date: "2026-07-28" });

    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      // The story's own state/iteration are unchanged, so p_expected matches and
      // the existing staleness check can't catch this.
      p_expected: { state_id: states.Accepted, iteration_id: staleIterationId },
      p_deltas: {},
      p_anchor: {},
    });
    expect(error?.message).toMatch(/stale/i);
    // Rolled back: still in its old iteration, position untouched.
    const { data } = await asService.from("stories").select("position, iteration_id").eq("id", a).single();
    expect((data as StoryRow).position).toBe(0);
    expect((data as StoryRow).iteration_id).toBe(staleIterationId);
  });

  // TASK-134 AC #5: the guard must fire for any non-'list' p_view, including a
  // forged/unknown value (the RPC is granted to authenticated and doesn't
  // enum-check p_view), not just the literal 'tracker'.
  it("rejects a forged p_view cross-iteration move too (TASK-134 AC #5)", async () => {
    const [a] = await seedCurrentIteration([{ stateId: states.Accepted, position: 0 }]);
    const staleIterationId = iterationId;
    await asService.from("iterations").update({ state: "done" }).eq("id", staleIterationId);
    await asService
      .from("iterations")
      .insert({ project_id: projectId, number: 2, state: "active", start_date: "2026-07-15", end_date: "2026-07-28" });

    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "sneaky-forged-view",
      p_expected: { state_id: states.Accepted, iteration_id: staleIterationId },
      p_deltas: {},
      p_anchor: {},
    });
    expect(error?.message).toMatch(/stale/i);
  });

  // TASK-136: a reorder rewrites only the AFFECTED RANGE, not the whole
  // iteration. Started at 0,1,2; Finished parked far at 20,21 (a deliberate
  // gap — a whole-iteration re-densify would collapse 20/21 to 3/4). A short
  // within-range reorder must leave the far rows exactly where they are.
  it("rewrites only the affected position range, leaving out-of-range rows untouched (TASK-136)", async () => {
    const [a0, a1, a2, f20, f21] = await seedCurrentIteration([
      { stateId: states.Started, position: 0 },
      { stateId: states.Started, position: 1 },
      { stateId: states.Started, position: 2 },
      { stateId: states.Finished, position: 20 },
      { stateId: states.Finished, position: 21 },
    ]);
    // Move a2 before a1 (affected range = [1,2]).
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a2 },
      p_view: "tracker",
      p_expected: { state_id: states.Started, iteration_id: iterationId },
      p_deltas: {},
      p_anchor: { before: { kind: "story", id: a1 } },
    });
    expect(error).toBeNull();
    // In-range shifted (a0 stays 0, a2→1, a1→2); out-of-range untouched.
    expect(await positionsOf([a0, a2, a1])).toEqual([0, 1, 2]);
    expect(await positionsOf([f20, f21])).toEqual([20, 21]);
  });

  // TASK-136 regression: append must land past the LAST story (max+1), not at
  // count(*). Positions go sparse in production (a List current→backlog drag or
  // finalize vacates a slot and nothing re-densifies), so count would drop the
  // card mid-sequence.
  it("appends to the end of a sparse sequence, not mid-list (TASK-136 gap)", async () => {
    const [a0, f20, f21] = await seedCurrentIteration([
      { stateId: states.Started, position: 0 },
      { stateId: states.Finished, position: 20 },
      { stateId: states.Finished, position: 21 },
    ]);
    // Move a0 into the Finished column, dropped at its end (no anchor).
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a0 },
      p_view: "tracker",
      p_expected: { state_id: states.Started, iteration_id: iterationId },
      p_deltas: { state_id: states.Finished },
      p_anchor: {},
    });
    expect(error).toBeNull();
    const [pa0, pf20, pf21] = await positionsOf([a0, f20, f21]);
    expect(pa0).toBeGreaterThan(pf21); // last in flat order, not at count()=2
    expect([pf20, pf21]).toEqual([20, 21]); // real tail untouched
  });

  // Exercises the in-scope DOWN shift (position - 1) — every other reorder test
  // is an up-move, so this is the only one that shifts a real row downward.
  it("reorders a story later within its column (down move)", async () => {
    const [a, b, c] = await seedCurrentIteration([
      { stateId: states.Started, position: 0 },
      { stateId: states.Started, position: 1 },
      { stateId: states.Started, position: 2 },
    ]);
    // Move a (pos 0) to before c → order b, a, c.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: a },
      p_view: "tracker",
      p_expected: { state_id: states.Started, iteration_id: iterationId },
      p_deltas: {},
      p_anchor: { before: { kind: "story", id: c } },
    });
    expect(error).toBeNull();
    expect(await positionsOf([b, a, c])).toEqual([0, 1, 2]);
  });

  // Exercises the ENTERING branch (shift target..end) into a POPULATED
  // iteration — the only prior entering test moved into an empty iteration
  // (n_others=0), so the shift never touched a row.
  it("moves a backlog story into a populated current iteration at the anchor", async () => {
    const [x, y, z] = await seedCurrentIteration([
      { stateId: states.Started, position: 0 },
      { stateId: states.Started, position: 1 },
      { stateId: states.Started, position: 2 },
    ]);
    const { data: m } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "m", state_id: states.Unstarted, iteration_id: null, position: 0, created_by: ownerId })
      .select("id")
      .single();
    // Schedule m into the current iteration, dropped before y.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: m!.id },
      p_view: "list",
      p_expected: { state_id: states.Unstarted, iteration_id: null },
      p_deltas: { iteration: "current" },
      p_anchor: { before: { kind: "story", id: y } },
    });
    expect(error).toBeNull();
    // m lands before y, shifting y,z up: x(0), m(1), y(2), z(3).
    expect(await positionsOf([x, m!.id, y, z])).toEqual([0, 1, 2, 3]);
  });

  // Exercises the Icebox scope (state_id is null, project-wide) — untested
  // before; the null-scope predicate appears in every branch of the rewrite.
  it("reorders Icebox (null-state) stories", async () => {
    await asService.from("stories").delete().eq("project_id", projectId);
    const { data: i0 } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "i0", state_id: null, iteration_id: null, position: 0, created_by: ownerId })
      .select("id")
      .single();
    const { data: i1 } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "i1", state_id: null, iteration_id: null, position: 1, created_by: ownerId })
      .select("id")
      .single();
    // Move i1 before i0.
    const { error } = await asOwner.rpc("move_story_board", {
      p_project_id: projectId,
      p_item: { kind: "story", id: i1!.id },
      p_view: "list",
      p_expected: { state_id: null, iteration_id: null },
      p_deltas: {},
      p_anchor: { before: { kind: "story", id: i0!.id } },
    });
    expect(error).toBeNull();
    expect(await positionsOf([i1!.id, i0!.id])).toEqual([0, 1]);
  });
});
