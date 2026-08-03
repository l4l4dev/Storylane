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
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const ownerAuth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }
    ownerId = ownerAuth.data.user.id;

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
  /** A story on the board with a state and an iteration — the shape whose
   *  containerization actually produces all three bookkeeping rows. */
  async function createBoardStory(fields: { title: string; points?: number | null }) {
    const { data: state } = await admin
      .from("project_states")
      .select("id")
      .eq("project_id", projectId)
      .eq("category", "unstarted")
      .limit(1)
      .single();
    let { data: iteration } = await admin
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    if (!iteration) {
      const created = await admin
        .from("iterations")
        .insert({ project_id: projectId, number: 1, start_date: "2026-08-01", end_date: "2026-08-14" })
        .select("id")
        .single();
      iteration = created.data;
    }
    const { data, error } = await owner
      .from("stories")
      .insert({
        project_id: projectId,
        story_type: "feature",
        state_id: state!.id,
        iteration_id: iteration!.id,
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(`board story insert failed: ${error.message}`);
    return data!.id as string;
  }

  // Containerizing is one action that writes four activity_logs rows: the
  // explicit story.containerized, plus the state/iteration/points clearing that
  // log_story_activity records from the same UPDATE. The three are kept (the
  // burndown replays them) but marked, so the readers can tell them apart.
  it("marks the rows its bookkeeping UPDATE produces, and leaves the others alone", async () => {
    const parentId = await createBoardStory({ title: "To containerize", points: 5 });
    const child = await createStory(projectId, { title: "Child", parent_id: parentId });
    expect(child.error).toBeNull();

    const { data: logs } = await admin
      .from("activity_logs")
      .select("action, payload")
      .eq("story_id", parentId)
      .order("created_at", { ascending: true });

    const marked = (logs ?? [])
      .filter((l) => (l.payload as { bookkeeping?: string })?.bookkeeping === "containerize")
      .map((l) => l.action)
      .sort();
    // Spelled out rather than derived from what was written: an expectation
    // built from the actual rows cannot fail when a row goes missing.
    expect(marked).toEqual(["story.iteration_changed", "story.points_changed", "story.state_changed"]);

    // The two that describe the action itself must NOT be marked, or the feed
    // would hide the only rows left to render.
    for (const action of ["story.created", "story.containerized"]) {
      const row = (logs ?? []).find((l) => l.action === action);
      expect(row, `${action} should exist`).toBeDefined();
      expect((row!.payload as { bookkeeping?: string })?.bookkeeping ?? null).toBeNull();
    }

    // What the activity feed actually renders — the same filter it applies.
    const { data: visible } = await admin
      .from("activity_logs")
      .select("action")
      .eq("story_id", parentId)
      .filter("payload->>bookkeeping", "is", null);
    expect((visible ?? []).map((l) => l.action).sort()).toEqual(["story.containerized", "story.created"]);

    // The story-detail panel reads through its own action whitelist, so the
    // filter alone is not enough there — drop story.containerized from that
    // list and epic-ing a story leaves no trace in the panel at all.
    const { data: detailHistory } = await admin
      .from("activity_logs")
      .select("action")
      .eq("story_id", parentId)
      .in("action", [
        "story.created",
        "story.state_changed",
        "story.column_changed",
        "story.points_changed",
        "story.containerized",
      ])
      .filter("payload->>bookkeeping", "is", null);
    expect((detailHistory ?? []).map((l) => l.action)).toContain("story.containerized");
  });

  // The three rows are hidden on the understanding that story.containerized
  // speaks for them, so it has to be written even with no estimate to lose —
  // otherwise containerizing an unestimated story leaves no trace anywhere.
  it("records the containerization of a story that was never estimated", async () => {
    const parentId = await createBoardStory({ title: "Unestimated epic to be" });
    const child = await createStory(projectId, { title: "Child", parent_id: parentId });
    expect(child.error).toBeNull();

    const { data: visible } = await admin
      .from("activity_logs")
      .select("action, payload")
      .eq("story_id", parentId)
      .filter("payload->>bookkeeping", "is", null);
    const containerized = (visible ?? []).find((l) => l.action === "story.containerized");
    expect(containerized).toBeDefined();
    expect((containerized!.payload as { old_points: number | null }).old_points).toBeNull();
  });

  // actor_id is NOT NULL and recompute_is_container's insert is unconditional,
  // so a caller without auth.uid() would abort the whole containerization.
  // admin holds the service role key, which carries no sub claim.
  it("containerizes for a caller with no authenticated user", async () => {
    const { data: state } = await admin
      .from("project_states")
      .select("id")
      .eq("project_id", projectId)
      .eq("category", "unstarted")
      .limit(1)
      .single();
    const { data: parent, error: parentError } = await admin
      .from("stories")
      .insert({
        project_id: projectId,
        story_type: "feature",
        title: "service-role containerize",
        state_id: state!.id,
        created_by: ownerId,
      })
      .select("id")
      .single();
    expect(parentError).toBeNull();

    const { error: childError } = await admin.from("stories").insert({
      project_id: projectId,
      story_type: "feature",
      title: "Child",
      parent_id: parent!.id,
      created_by: ownerId,
    });
    expect(childError).toBeNull();

    const { data: containerized } = await admin
      .from("activity_logs")
      .select("actor_id")
      .eq("story_id", parent!.id)
      .eq("action", "story.containerized")
      .single();
    // Falls back to the story's creator rather than failing the write.
    expect(containerized?.actor_id).toBe(ownerId);
  });

  // The other way a story becomes an epic. It never routes through
  // recompute_is_container — stories_maintain_is_container fires on parent_id
  // writes and this one touches epic_pinned — so it carries its own copy of
  // the audit-then-clear and needs the same treatment.
  it("marks the rows the Turn-into-epic RPC produces", async () => {
    const parentId = await createBoardStory({ title: "Pin me", points: 5 });
    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: parentId, p_pinned: true });
    expect(error).toBeNull();

    const { data: logs } = await admin
      .from("activity_logs")
      .select("action, payload")
      .eq("story_id", parentId);
    const marked = (logs ?? [])
      .filter((l) => (l.payload as { bookkeeping?: string })?.bookkeeping === "containerize")
      .map((l) => l.action)
      .sort();
    expect(marked).toEqual(["story.iteration_changed", "story.points_changed", "story.state_changed"]);

    const { data: visible } = await admin
      .from("activity_logs")
      .select("action")
      .eq("story_id", parentId)
      .filter("payload->>bookkeeping", "is", null);
    expect((visible ?? []).map((l) => l.action).sort()).toEqual(["story.containerized", "story.created"]);
  });

  // The unestimated case through the RPC path too: the HIGH that reached
  // review was precisely a path covered on one side and not the other.
  it("records a never-estimated story pinned via the Turn-into-epic RPC", async () => {
    const parentId = await createBoardStory({ title: "Unestimated pin" });
    const { error } = await owner.rpc("set_epic_pinned", { p_story_id: parentId, p_pinned: true });
    expect(error).toBeNull();

    const { data: visible } = await admin
      .from("activity_logs")
      .select("action, payload")
      .eq("story_id", parentId)
      .filter("payload->>bookkeeping", "is", null);
    const containerized = (visible ?? []).find((l) => l.action === "story.containerized");
    expect(containerized).toBeDefined();
    expect((containerized!.payload as { old_points: number | null }).old_points).toBeNull();
  });

  it("queues no Slack notification for the Turn-into-epic RPC either", async () => {
    const { error: integrationError } = await admin.from("integrations").insert({
      project_id: projectId,
      provider: "slack",
      config: { webhook_url: "https://hooks.slack.com/services/test" },
    });
    expect(integrationError).toBeNull();

    try {
      const parentId = await createBoardStory({ title: "Pinned, not announced", points: 3 });
      const { error } = await owner.rpc("set_epic_pinned", { p_story_id: parentId, p_pinned: true });
      expect(error).toBeNull();

      const { data: cleared } = await admin
        .from("activity_logs")
        .select("id")
        .eq("story_id", parentId)
        .eq("action", "story.state_changed");
      expect(cleared ?? []).toHaveLength(1);

      const { data: queued } = await admin
        .from("slack_notifications")
        .select("ref_id")
        .eq("project_id", projectId)
        .eq("event_type", "story_state_changed");
      expect(new Set((queued ?? []).map((n) => n.ref_id)).has(cleared![0].id)).toBe(false);
    } finally {
      await admin.from("integrations").delete().eq("project_id", projectId).eq("provider", "slack");
    }
  });

  // slack-notify renders a null `to` as "moved to the Icebox", so an unmarked
  // state-clearing row announces a move that never happened.
  it("queues no Slack notification for the state it clears", async () => {
    const { error: integrationError } = await admin.from("integrations").insert({
      project_id: projectId,
      provider: "slack",
      config: { webhook_url: "https://hooks.slack.com/services/test" },
    });
    expect(integrationError).toBeNull();

    try {
      // The parent needs a state for there to be one to clear — createStory
      // leaves state_id null, and clearing null is not a change.
      const { data: unstarted } = await admin
        .from("project_states")
        .select("id")
        .eq("project_id", projectId)
        .eq("category", "unstarted")
        .limit(1)
        .single();
      const { data: parentRow, error: parentError } = await owner
        .from("stories")
        .insert({
          project_id: projectId,
          story_type: "feature",
          title: "Epic to be",
          points: 2,
          state_id: unstarted!.id,
        })
        .select("id")
        .single();
      expect(parentError).toBeNull();
      const parent = { id: parentRow!.id };
      const child = await createStory(projectId, { title: "Child", parent_id: parent.id });
      expect(child.error).toBeNull();

      // The row exists either way — this is about whether it reaches Slack, so
      // asserting it is present keeps the check below from passing vacuously.
      const { data: cleared } = await admin
        .from("activity_logs")
        .select("id")
        .eq("story_id", parent.id)
        .eq("action", "story.state_changed");
      expect(cleared ?? []).toHaveLength(1);

      // ref_id is polymorphic and carries no FK, so it cannot be embedded.
      const { data: queued } = await admin
        .from("slack_notifications")
        .select("ref_id")
        .eq("project_id", projectId)
        .eq("event_type", "story_state_changed");
      const refIds = new Set((queued ?? []).map((n) => n.ref_id));
      expect(refIds.has(cleared![0].id)).toBe(false);
    } finally {
      await admin.from("integrations").delete().eq("project_id", projectId).eq("provider", "slack");
    }
  });

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
