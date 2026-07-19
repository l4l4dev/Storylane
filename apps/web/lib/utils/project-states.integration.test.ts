import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import stateTemplates from "../../../../spec/fixtures/state-templates.json";

// The DB seed (seed_project_states) and the packages/core golden fixture
// must never silently drift apart (spec/data-model.md "Default templates").
// Snake-cased to match the DB column names this test queries.
function expectedSeedRows(template: "classic" | "minimal") {
  return stateTemplates[template].states.map((s) => ({
    name: s.name,
    action_label: s.actionLabel,
    category: s.category,
    position: s.position,
  }));
}

// TASK-91 (doc-8 §2): project_states integrity — category immutability and
// the >=1 unstarted / >=1 done minimums (including the concurrent-delete
// race and the project-deletion cascade short-circuit, both called out as
// required test coverage by the task's own AC#1). Also covers the
// classic/minimal template auto-seeding trigger.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/project-states.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("project_states integrity (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;

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
    owner = createClient(url, anonKey);
    const ownerAuth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error.message}`);
    }
  });

  // Every fresh project auto-seeds the classic template (Unstarted/Started/
  // Finished/Delivered/Accepted/Rejected) via the on_project_created_seed_states
  // trigger, so every test below starts from that baseline rather than an
  // empty state set.
  async function freshProject(name: string): Promise<string> {
    const { data, error } = await owner.from("projects").insert({ name }).select("id").single();
    if (error || !data) throw new Error(`Failed to create project: ${error?.message}`);
    return data.id;
  }

  async function stateId(projectId: string, name: string): Promise<string> {
    const { data } = await admin.from("project_states").select("id").eq("project_id", projectId).eq("name", name).single();
    return data!.id;
  }

  it("category cannot be changed after creation", async () => {
    const pid = await freshProject("category-immutable test");
    const id = await stateId(pid, "Unstarted");

    const { error } = await owner.from("project_states").update({ category: "in_progress" }).eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/category.*cannot be changed/i);

    await admin.from("projects").delete().eq("id", pid);
  });

  // A member of two projects could otherwise move an unused state to a
  // project they don't own, bypassing that table's owner-only DELETE
  // policy and the minimums trigger below.
  it("project_id cannot be changed after creation", async () => {
    const pidA = await freshProject("project-id-immutable A");
    const pidB = await freshProject("project-id-immutable B");
    const id = await stateId(pidA, "Rejected"); // deletable/movable-looking: not a minimums-guarded category

    const { error } = await owner.from("project_states").update({ project_id: pidB }).eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/moved to a different project/i);

    await admin.from("projects").delete().eq("id", pidA);
    await admin.from("projects").delete().eq("id", pidB);
  });

  it("rejects deleting the last unstarted-category state", async () => {
    const pid = await freshProject("last-unstarted test");
    const id = await stateId(pid, "Unstarted"); // the classic template's only unstarted-category state

    const { error } = await owner.from("project_states").delete().eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/at least one unstarted-category state/i);

    await admin.from("projects").delete().eq("id", pid);
  });

  it("rejects deleting the last done-category state", async () => {
    const pid = await freshProject("last-done test");
    const id = await stateId(pid, "Accepted"); // the classic template's only done-category state

    const { error } = await owner.from("project_states").delete().eq("id", id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/at least one done-category state/i);

    await admin.from("projects").delete().eq("id", pid);
  });

  it("allows deleting a done-category state when another one remains", async () => {
    const pid = await freshProject("done-with-spare test");
    await owner.from("project_states").insert({ project_id: pid, name: "Done B", category: "done", position: 10 });
    const acceptedId = await stateId(pid, "Accepted");

    const { error } = await owner.from("project_states").delete().eq("id", acceptedId);
    expect(error).toBeNull();

    await admin.from("projects").delete().eq("id", pid);
  });

  it("a project with project_states can still be deleted (cascade must not trip the minimum-count trigger)", async () => {
    const pid = await freshProject("cascade-delete test");

    const { error } = await admin.from("projects").delete().eq("id", pid);
    expect(error).toBeNull();

    const { data: remaining } = await admin.from("projects").select("id").eq("id", pid);
    expect(remaining ?? []).toHaveLength(0);
  });

  it("serializes two concurrent deletes of the last two done-category states — exactly one wins", async () => {
    const pid = await freshProject("concurrent-delete test");
    const { data: doneB } = await owner
      .from("project_states")
      .insert({ project_id: pid, name: "Done B", category: "done", position: 10 })
      .select("id")
      .single();
    const acceptedId = await stateId(pid, "Accepted");

    const results = await Promise.allSettled([
      owner.from("project_states").delete().eq("id", acceptedId),
      owner.from("project_states").delete().eq("id", doneB!.id),
    ]);

    // Both PostgREST calls resolve (not reject) — the RLS-layer response
    // carries the DB exception as `.error`, so check that field, not
    // promise rejection.
    const responses = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    const errors = responses.map((r) => r?.error ?? null);
    const succeeded = errors.filter((e) => e === null);
    const failed = errors.filter((e) => e !== null);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.message).toMatch(/at least one done-category state/i);

    const { data: remainingStates } = await admin.from("project_states").select("id, category").eq("project_id", pid);
    expect((remainingStates ?? []).filter((s) => s.category === "done")).toHaveLength(1);

    await admin.from("projects").delete().eq("id", pid);
  });

  it("seeds the classic template (6 states) by default on project creation, matching the golden fixture", async () => {
    const pid = await freshProject("classic seed test");
    const { data: states } = await admin
      .from("project_states")
      .select("name, action_label, category, position")
      .eq("project_id", pid)
      .order("position");
    expect(states).toEqual(expectedSeedRows("classic"));
    await admin.from("projects").delete().eq("id", pid);
  });

  it("seeds the minimal template (3 states) when requested, matching the golden fixture", async () => {
    const { data: project } = await owner
      .from("projects")
      .insert({ name: "minimal seed test", state_template: "minimal" })
      .select("id")
      .single();
    const { data: states } = await admin
      .from("project_states")
      .select("name, action_label, category, position")
      .eq("project_id", project!.id)
      .order("position");
    expect(states).toEqual(expectedSeedRows("minimal"));
    await admin.from("projects").delete().eq("id", project!.id);
  });

  // reorder_project_state (20260719000013) backs the Settings "States"
  // section's up/down arrows — swaps a state with its nearest same-category
  // neighbour's position value. Regression coverage the rls-security-reviewer
  // flagged as missing (the RPC it supersedes, swap_adjacent, shipped one).
  describe("reorder_project_state", () => {
    async function positionsByName(projectId: string): Promise<Record<string, number>> {
      const { data } = await admin.from("project_states").select("name, position").eq("project_id", projectId);
      return Object.fromEntries((data ?? []).map((s) => [s.name, s.position]));
    }

    it("swaps a state with its nearest same-category neighbour, leaving every other state untouched", async () => {
      const pid = await freshProject("reorder swap test");
      const before = await positionsByName(pid);
      const startedId = await stateId(pid, "Started");

      const { error } = await owner.rpc("reorder_project_state", {
        p_project_id: pid,
        p_state_id: startedId,
        p_direction: "down",
      });
      expect(error).toBeNull();

      const after = await positionsByName(pid);
      // Started <-> Finished (both in_progress) swap positions...
      expect(after.Started).toBe(before.Finished);
      expect(after.Finished).toBe(before.Started);
      // ...and nothing else moves.
      for (const name of ["Unstarted", "Delivered", "Accepted", "Rejected"]) {
        expect(after[name]).toBe(before[name]);
      }

      await admin.from("projects").delete().eq("id", pid);
    });

    it("is a no-op at a category's edge (the only unstarted state moved up)", async () => {
      const pid = await freshProject("reorder edge test");
      const before = await positionsByName(pid);
      const unstartedId = await stateId(pid, "Unstarted");

      const { error } = await owner.rpc("reorder_project_state", {
        p_project_id: pid,
        p_state_id: unstartedId,
        p_direction: "up",
      });
      expect(error).toBeNull();
      expect(await positionsByName(pid)).toEqual(before);

      await admin.from("projects").delete().eq("id", pid);
    });

    it("rejects a viewer-role member", async () => {
      const pid = await freshProject("reorder viewer test");
      const startedId = await stateId(pid, "Started");

      const email = `reorder-viewer-${Date.now()}@storylane.local`;
      const { data: created } = await admin.auth.admin.createUser({ email, password: "viewer-pw", email_confirm: true });
      await admin.from("project_members").insert({ project_id: pid, user_id: created!.user.id, role: "viewer" });
      const viewer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      await viewer.auth.signInWithPassword({ email, password: "viewer-pw" });

      const { error } = await viewer.rpc("reorder_project_state", {
        p_project_id: pid,
        p_state_id: startedId,
        p_direction: "down",
      });
      expect(error?.code).toBe("42501");

      await admin.from("projects").delete().eq("id", pid);
      await admin.auth.admin.deleteUser(created!.user.id);
    });

    it("rejects a state id from a different project (cross-tenant scoping)", async () => {
      const pidA = await freshProject("reorder tenant A");
      const pidB = await freshProject("reorder tenant B");
      const foreignId = await stateId(pidB, "Started");
      const beforeB = await positionsByName(pidB);

      const { error } = await owner.rpc("reorder_project_state", {
        p_project_id: pidA,
        p_state_id: foreignId,
        p_direction: "down",
      });
      expect(error?.code).toBe("P0002");
      // Project B's states are untouched.
      expect(await positionsByName(pidB)).toEqual(beforeB);

      await admin.from("projects").delete().eq("id", pidA);
      await admin.from("projects").delete().eq("id", pidB);
    });
  });

  // create_project_state (20260719000014): the original client-side insert
  // appended every new state at the end of the whole project's position
  // sequence instead of its own category's block, which broke
  // computeStateGate's per-category-contiguous assumption (packages/core
  // story-state.ts) — e.g. an in_progress state landing after Rejected.
  // This RPC must keep every category contiguous from the moment of
  // creation, including when the target category has zero existing rows
  // in the project (e.g. the 'minimal' template has no 'rejected' row).
  describe("create_project_state", () => {
    async function orderedNames(projectId: string): Promise<string[]> {
      const { data } = await admin
        .from("project_states")
        .select("name, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true });
      return (data ?? []).map((s) => s.name);
    }

    it("inserts a new in_progress state at the end of the in_progress block, not the end of the whole sequence", async () => {
      const pid = await freshProject("create-state placement test");

      const { data: newId, error } = await owner.rpc("create_project_state", {
        p_project_id: pid,
        p_name: "In Review",
        p_category: "in_progress",
      });
      expect(error).toBeNull();
      expect(newId).toBeTruthy();

      // Classic template order: Unstarted, Started, Finished, Delivered,
      // Accepted, Rejected. The new in_progress state must land right after
      // Delivered (the last in_progress state) and before Accepted/Rejected
      // — never after them.
      expect(await orderedNames(pid)).toEqual([
        "Unstarted",
        "Started",
        "Finished",
        "Delivered",
        "In Review",
        "Accepted",
        "Rejected",
      ]);

      await admin.from("projects").delete().eq("id", pid);
    });

    it("inserts a category's first-ever state after the nearest preceding category's block, not at position 0", async () => {
      const { data: pid, error: projectError } = await owner
        .from("projects")
        .insert({ name: "create-state empty-category test", state_template: "minimal" })
        .select("id")
        .single();
      expect(projectError).toBeNull();

      // The 'minimal' template (Todo/Doing/Done) seeds zero 'rejected' rows —
      // computing the insertion point off an empty same-category set must
      // not default to position 0 (ahead of Todo).
      const { error } = await owner.rpc("create_project_state", {
        p_project_id: pid!.id,
        p_name: "Cancelled",
        p_category: "rejected",
      });
      expect(error).toBeNull();
      expect(await orderedNames(pid!.id)).toEqual(["Todo", "Doing", "Done", "Cancelled"]);

      await admin.from("projects").delete().eq("id", pid!.id);
    });

    it("rejects a non-member", async () => {
      const pid = await freshProject("create-state auth test");
      const email = `create-state-outsider-${Date.now()}@storylane.local`;
      const { data: created } = await admin.auth.admin.createUser({ email, password: "outsider-pw", email_confirm: true });
      const outsider = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      await outsider.auth.signInWithPassword({ email, password: "outsider-pw" });

      const { error } = await outsider.rpc("create_project_state", {
        p_project_id: pid,
        p_name: "Sneaky",
        p_category: "in_progress",
      });
      expect(error?.code).toBe("42501");

      await admin.from("projects").delete().eq("id", pid);
      await admin.auth.admin.deleteUser(created!.user.id);
    });
  });
});
