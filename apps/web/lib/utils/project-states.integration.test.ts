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
});
