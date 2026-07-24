import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Exercises the REAL doc-18 hierarchy triggers (enforce_single_level_nesting,
// maintain_is_container) against the local stack — the unit suite mocks the DB,
// so trigger logic can only be validated here.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/nesting.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("parent_id hierarchy triggers (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let projectId: string;
  let otherProjectId: string;

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
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }

    const p1 = await owner.from("projects").insert({ name: "nesting test" }).select("id").single();
    const p2 = await owner.from("projects").insert({ name: "nesting test other" }).select("id").single();
    if (p1.error || !p1.data || p2.error || !p2.data) {
      throw new Error(`Project setup failed: ${p1.error?.message ?? p2.error?.message}`);
    }
    projectId = p1.data.id;
    otherProjectId = p2.data.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    if (otherProjectId) await admin.from("projects").delete().eq("id", otherProjectId);
  });

  async function createStory(
    project: string,
    fields: { title: string; points?: number | null; parent_id?: string | null; epic_color?: string | null } = {
      title: "s",
    },
  ): Promise<{ id: string; error: string | null }> {
    const { data, error } = await owner
      .from("stories")
      .insert({ project_id: project, story_type: "feature", ...fields })
      .select("id")
      .single();
    return { id: data?.id ?? "", error: error?.message ?? null };
  }

  it("auto-containerizes a parent when a child is added, and reverts when it is removed", async () => {
    const parent = await createStory(projectId, { title: "Parent", points: 3 });
    const child = await createStory(projectId, { title: "Child", parent_id: parent.id });
    expect(child.error).toBeNull();

    const containerized = await admin
      .from("stories")
      .select("is_container, points, state_id, iteration_id")
      .eq("id", parent.id)
      .single();
    expect(containerized.data).toMatchObject({
      is_container: true,
      points: null,
      state_id: null,
      iteration_id: null,
    });

    // The lost points are audited (doc-18 §4).
    const log = await admin
      .from("activity_logs")
      .select("action, payload")
      .eq("story_id", parent.id)
      .eq("action", "story.containerized")
      .single();
    expect(log.data?.payload).toMatchObject({ old_points: 3 });

    // Remove the only child -> parent reverts to a normal story.
    await owner.from("stories").update({ parent_id: null }).eq("id", child.id);
    const reverted = await admin.from("stories").select("is_container").eq("id", parent.id).single();
    expect(reverted.data?.is_container).toBe(false);
  });

  // fable-advisor (TASK-183 review): a normal story has no epic_color, so
  // containerizing it via split_story or the Parent picker left epics
  // colorless — a regression vs. the old promote flow's default. Fixed on
  // the false->true flip itself (the single authority for containerization,
  // regardless of which path triggered it).
  it("defaults epic_color to #6366f1 on containerization when the story had none", async () => {
    const parent = await createStory(projectId, { title: "Colorless" });
    await createStory(projectId, { title: "Child2", parent_id: parent.id });

    const row = await admin.from("stories").select("epic_color").eq("id", parent.id).single();
    expect(row.data?.epic_color).toBe("#6366f1");
  });

  it("never overwrites an existing epic_color on containerization", async () => {
    const parent = await createStory(projectId, { title: "AlreadyColored", epic_color: "#ff0000" });
    await createStory(projectId, { title: "Child3", parent_id: parent.id });

    const row = await admin.from("stories").select("epic_color").eq("id", parent.id).single();
    expect(row.data?.epic_color).toBe("#ff0000");
  });

  it("rejects a grandchild (max depth 1)", async () => {
    const parent = await createStory(projectId, { title: "P" });
    const child = await createStory(projectId, { title: "C", parent_id: parent.id });
    const grandchild = await createStory(projectId, { title: "G", parent_id: child.id });
    expect(grandchild.error).toMatch(/max depth = 1/i);
  });

  it("rejects a story with children from becoming a child itself", async () => {
    const parent = await createStory(projectId, { title: "P2" });
    await createStory(projectId, { title: "C2", parent_id: parent.id });
    const other = await createStory(projectId, { title: "Other" });
    const { error } = await owner.from("stories").update({ parent_id: other.id }).eq("id", parent.id);
    expect(error?.message).toMatch(/with children cannot become a child/i);
  });

  it("rejects a cross-project parent", async () => {
    const here = await createStory(projectId, { title: "Here" });
    const there = await createStory(otherProjectId, { title: "There" });
    const { error } = await owner.from("stories").update({ parent_id: there.id }).eq("id", here.id);
    expect(error?.message).toMatch(/same project/i);
  });

  it("rejects a self-parent", async () => {
    const s = await createStory(projectId, { title: "Self" });
    const { error } = await owner.from("stories").update({ parent_id: s.id }).eq("id", s.id);
    expect(error?.message).toMatch(/its own parent/i);
  });

  it("set_story_state rejects a container with an actionable message (doc-18 §4)", async () => {
    const parent = await createStory(projectId, { title: "Container" });
    await createStory(projectId, { title: "Kid", parent_id: parent.id });

    const state = await owner
      .from("project_states")
      .select("id")
      .eq("project_id", projectId)
      .eq("category", "in_progress")
      .order("position")
      .limit(1)
      .single();

    const { error } = await owner.rpc("set_story_state", { p_story_id: parent.id, p_state_id: state.data!.id });
    expect(error?.message).toMatch(/container has no board state/i);
  });

  // TASK-182 (rls-security-reviewer): is_container is trigger-derived from
  // actual child membership, so a raw client UPDATE cannot forge it and route
  // around the off-board CHECK / set_story_state guard.
  it("neutralizes a raw client attempt to un-containerize a real epic", async () => {
    const parent = await createStory(projectId, { title: "Epic", points: 3 });
    await createStory(projectId, { title: "Kid", parent_id: parent.id });

    await owner.from("stories").update({ is_container: false }).eq("id", parent.id);

    const row = await admin.from("stories").select("is_container").eq("id", parent.id).single();
    expect(row.data!.is_container).toBe(true); // forced back to the truth (has a child)
  });

  it("rejects the combined un-containerize + re-estimate attack via the off-board CHECK", async () => {
    const parent = await createStory(projectId, { title: "Epic2", points: 3 });
    await createStory(projectId, { title: "Kid2", parent_id: parent.id });

    // is_container is forced true (has a child), so points=5 violates the CHECK.
    const { error } = await owner.from("stories").update({ is_container: false, points: 5 }).eq("id", parent.id);
    expect(error).not.toBeNull();

    const row = await admin.from("stories").select("is_container, points").eq("id", parent.id).single();
    expect(row.data).toMatchObject({ is_container: true, points: null });
  });

  it("neutralizes forging a plain story into a container", async () => {
    const leaf = await createStory(projectId, { title: "Leaf" });
    await owner.from("stories").update({ is_container: true }).eq("id", leaf.id);

    const row = await admin.from("stories").select("is_container").eq("id", leaf.id).single();
    expect(row.data!.is_container).toBe(false); // no children -> stays a plain story
  });
});
