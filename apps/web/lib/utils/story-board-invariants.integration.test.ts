import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-208: the estimation gate and "in_progress needs an iteration" used to
// live only inside set_story_state, while the stories UPDATE policy
// (20260719000002) lets any member write any column. A plain PostgREST update
// therefore reached a done state on an unestimated feature -- and stamped
// completed_at on the way, making it count toward velocity.
// stories_enforce_board_invariants (20260728040100) moves both rules into the
// DB so every write path inherits them.
//
// Every rejection case here is exercised as the MEMBER, i.e. the exact path
// that bypassed the rules, not as the service role.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/story-board-invariants.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("story board invariants (integration)", () => {
  let admin: SupabaseClient;
  let member: SupabaseClient;
  let projectId: string;
  let memberId: string;
  let unstartedId: string;
  let inProgressId: string;
  let doneId: string;
  let iterationId: string;
  let nextIterationId: string;

  async function seed(fields: Record<string, unknown>): Promise<string> {
    const { data, error } = await admin
      .from("stories")
      .insert({ project_id: projectId, title: "s", story_type: "feature", created_by: memberId, ...fields })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed failed: ${error?.message}`);
    return data.id;
  }

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
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    member = createClient(url, anonKey, { auth: { persistSession: false } });
    const auth = await member.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    memberId = auth.data.user.id;

    const { data: project, error: projectError } = await member
      .from("projects")
      .insert({ name: "story board invariants integration test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const { data: stateRows } = await admin
      .from("project_states")
      .select("id, name, category")
      .eq("project_id", projectId);
    unstartedId = stateRows!.find((s) => s.category === "unstarted")!.id;
    inProgressId = stateRows!.find((s) => s.name === "Started")!.id;
    doneId = stateRows!.find((s) => s.category === "done")!.id;

    const { data: iters } = await admin
      .from("iterations")
      .insert([
        { project_id: projectId, number: 1, start_date: "2026-07-01", end_date: "2026-07-14" },
        { project_id: projectId, number: 2, start_date: "2026-07-15", end_date: "2026-07-28" },
      ])
      .select("id, number");
    iterationId = iters!.find((i) => i.number === 1)!.id;
    nextIterationId = iters!.find((i) => i.number === 2)!.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
  });

  it("rejects a member moving an unestimated feature into a done state (AC #1)", async () => {
    const id = await seed({ points: null, state_id: unstartedId });

    const { error } = await member.from("stories").update({ state_id: doneId }).eq("id", id);
    expect(error?.message).toMatch(/unestimated feature/i);

    // The pre-fix bypass also stamped completed_at, so assert the row is intact
    // rather than just that an error came back.
    const { data } = await admin.from("stories").select("state_id, completed_at").eq("id", id).single();
    expect(data).toMatchObject({ state_id: unstartedId, completed_at: null });
  });

  it("rejects the same move on INSERT, not only on UPDATE (AC #1)", async () => {
    const { error } = await member
      .from("stories")
      .insert({ project_id: projectId, title: "born done", story_type: "feature", points: null, state_id: doneId, iteration_id: iterationId });
    expect(error?.message).toMatch(/unestimated feature/i);
  });

  it("still allows an unestimated NON-feature to reach done (the gate is feature-only)", async () => {
    const id = await seed({ story_type: "chore", points: null, state_id: unstartedId, iteration_id: iterationId });

    const { error } = await member.from("stories").update({ state_id: doneId }).eq("id", id);
    expect(error).toBeNull();
  });

  it("rejects clearing the estimate on a feature already resting in done (AC #1)", async () => {
    // /code-review high finding: gating on category movement alone let the
    // forbidden end state be reached in two writes — estimate, move to done,
    // then clear the estimate — leaving completed_at stamped and the story
    // counting toward velocity.
    const id = await seed({ points: 3, state_id: unstartedId, iteration_id: iterationId });
    const moved = await member.from("stories").update({ state_id: doneId }).eq("id", id);
    expect(moved.error).toBeNull();

    const { error } = await member.from("stories").update({ points: null }).eq("id", id);
    expect(error?.message).toMatch(/unestimated feature/i);

    const { data } = await admin.from("stories").select("points").eq("id", id).single();
    expect(data!.points).toBe(3);
  });

  it("still allows clearing the estimate on an in_progress story (rollover must keep working)", async () => {
    // The mirror of the case above: this shape has to stay legal or
    // finalize_iteration's rollover raises for the whole project.
    const id = await seed({ points: 3, state_id: inProgressId, iteration_id: iterationId });

    const { error } = await member.from("stories").update({ points: null }).eq("id", id);
    expect(error).toBeNull();
  });

  it("rejects entering an in_progress state with no iteration (AC #4)", async () => {
    const id = await seed({ points: 3, state_id: unstartedId, iteration_id: null });

    const { error } = await member.from("stories").update({ state_id: inProgressId }).eq("id", id);
    expect(error?.message).toMatch(/no active iteration/i);
  });

  it("rejects clearing iteration_id on a story already in_progress (AC #4)", async () => {
    // The category never moves here, so a transition-only check would miss it.
    const id = await seed({ points: 3, state_id: inProgressId, iteration_id: iterationId });

    const { error } = await member.from("stories").update({ iteration_id: null }).eq("id", id);
    expect(error?.message).toMatch(/no active iteration/i);
  });

  it("rejects a container gaining a board state on a direct write (AC #2)", async () => {
    const parent = await seed({ points: null, state_id: null });
    const child = await seed({ points: null, state_id: null });
    await admin.from("stories").update({ parent_id: parent }).eq("id", child);

    const { error } = await member.from("stories").update({ state_id: unstartedId }).eq("id", parent);
    expect(error).not.toBeNull();

    const { data } = await admin.from("stories").select("is_container, state_id").eq("id", parent).single();
    expect(data).toMatchObject({ is_container: true, state_id: null });
  });

  it("still rolls an in_progress story whose estimate was cleared into the next iteration", async () => {
    // The regression the fable-advisor review caught: finalize_iteration's
    // rollover writes iteration_id ALONE, and "in_progress with points NULL" is
    // reachable through update_story, which applies no state-based gate to
    // points. Re-validating the estimate on any write touching the row would
    // make the whole finalize RPC raise here.
    const id = await seed({ points: 3, state_id: inProgressId, iteration_id: iterationId });
    await member.rpc("update_story", {
      p_story_id: id,
      p_title: "estimate cleared",
      p_description: null,
      p_story_type: "feature",
      p_points: null,
      p_parent_id: null,
      p_assignee_id: null,
    });
    const { data: cleared } = await admin.from("stories").select("points").eq("id", id).single();
    expect(cleared!.points).toBeNull();

    const { error } = await admin.from("stories").update({ iteration_id: nextIterationId }).eq("id", id);
    expect(error).toBeNull();
  });

  it("leaves the sanctioned RPC path working, including its auto-assign (AC #3)", async () => {
    const id = await seed({ points: 3, state_id: unstartedId, iteration_id: null });

    const { error } = await member.rpc("set_story_state", { p_story_id: id, p_state_id: inProgressId });
    expect(error).toBeNull();

    // set_story_state, not the trigger, is what resolves and fills the
    // iteration — the trigger is deliberately reject-only.
    const { data } = await admin.from("stories").select("state_id, iteration_id").eq("id", id).single();
    expect(data!.state_id).toBe(inProgressId);
    expect(data!.iteration_id).not.toBeNull();
  });

  it("exempts personal projects from both gates (doc-15)", async () => {
    const { data: personal } = await admin
      .from("projects")
      .select("id")
      .eq("is_personal", true)
      .eq("created_by", memberId)
      .maybeSingle();
    // The dev user's personal project is created on first My Work visit; skip
    // rather than fabricate a second one (one per owner is a unique constraint).
    if (!personal) return;

    const { data: personalDone } = await admin
      .from("project_states")
      .select("id")
      .eq("project_id", personal.id)
      .eq("category", "done")
      .limit(1)
      .maybeSingle();
    if (!personalDone) return;

    const { data: story, error: seedError } = await admin
      .from("stories")
      .insert({ project_id: personal.id, title: "personal", story_type: "feature", points: null, created_by: memberId })
      .select("id")
      .single();
    expect(seedError).toBeNull();

    const { error } = await admin.from("stories").update({ state_id: personalDone.id }).eq("id", story!.id);
    expect(error).toBeNull();

    await admin.from("stories").delete().eq("id", story!.id);
  });
});
