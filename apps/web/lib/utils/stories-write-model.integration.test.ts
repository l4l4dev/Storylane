import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-70 (re-anchored by TASK-91: transition_story -> set_story_state):
// proves the three story write paths (direct `stories` UPDATE via RLS,
// set_story_state, move_story_board) now agree — owner decision (a),
// Pivotal-style: any project member may operate any story, not just its
// author/assignee. move_story_board already enforced this independently;
// this test is the evidence that the RLS-gated paths (direct UPDATE,
// update_story, set_story_state) were relaxed to match, and that viewer
// stays excluded from all three.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/stories-write-model.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("stories write-permission model (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let member: SupabaseClient; // plain member — neither author nor assignee of any test story
  let viewer: SupabaseClient;
  let memberUserId: string;
  let viewerUserId: string;
  let projectId: string;
  let ownerId: string;
  let unstartedStateId: string;
  let startedStateId: string;

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
    ownerId = ownerAuth.data.user.id;

    const { data: project, error: projectError } = await owner
      .from("projects")
      .insert({ name: "stories write-model integration test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const { data: stateRows } = await admin.from("project_states").select("id, name").eq("project_id", projectId);
    unstartedStateId = stateRows!.find((s) => s.name === "Unstarted")!.id;
    startedStateId = stateRows!.find((s) => s.name === "Started")!.id;

    // set_story_state's auto-assign-on-entering-in_progress rule pulls a
    // backlog story into whichever iteration is current — an active
    // iteration must exist, but its id isn't otherwise needed here.
    const { error: iterError } = await admin
      .from("iterations")
      .insert({ project_id: projectId, number: 1, state: "active", start_date: "2026-07-01", end_date: "2026-07-14" });
    if (iterError) throw new Error(`Failed to seed iteration: ${iterError.message}`);

    async function createRoleUser(label: string, role: "member" | "viewer") {
      const email = `write-model-${label}-${Date.now()}@storylane.local`;
      const password = "integration-test-only-password";
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError || !created.user) throw new Error(`Failed to create ${label} user: ${createError?.message}`);
      const { error: memberError } = await admin
        .from("project_members")
        .insert({ project_id: projectId, user_id: created.user.id, role });
      if (memberError) throw new Error(`Failed to add ${label}: ${memberError.message}`);
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(`${label} sign-in failed: ${signInError.message}`);
      return { client, userId: created.user.id };
    }

    const [memberUser, viewerUser] = await Promise.all([
      createRoleUser("member", "member"),
      createRoleUser("viewer", "viewer"),
    ]);
    member = memberUser.client;
    memberUserId = memberUser.userId;
    viewer = viewerUser.client;
    viewerUserId = viewerUser.userId;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    if (memberUserId) await admin.auth.admin.deleteUser(memberUserId);
    if (viewerUserId) await admin.auth.admin.deleteUser(viewerUserId);
  });

  // Fresh, owner-authored, unassigned, estimated+unstarted story per test —
  // owner-authored so the acting role is never its author, unassigned so
  // it's never its assignee either. Estimated so a state change into
  // in_progress reaches the permission check, not the unestimated-feature
  // gate.
  async function createOwnerStory(title: string) {
    const { data, error } = await admin
      .from("stories")
      .insert({ project_id: projectId, title, story_type: "feature", points: 2, state_id: unstartedStateId, created_by: ownerId })
      .select("id, state_id, iteration_id, focus")
      .single();
    if (error || !data) throw new Error(`Failed to seed story: ${error?.message}`);
    return data;
  }

  describe("member — any project member may operate any story (TASK-70 owner decision (a))", () => {
    it("direct stories UPDATE succeeds for a non-author, non-assignee member", async () => {
      const story = await createOwnerStory("member direct update");
      const { data, error } = await member.from("stories").update({ points: 3 }).eq("id", story.id).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("set_story_state succeeds for a non-author, non-assignee member", async () => {
      const story = await createOwnerStory("member transition");
      const { data, error } = await member.rpc("set_story_state", { p_story_id: story.id, p_state_id: startedStateId });
      expect(error).toBeNull();
      expect((data as { state_id: string }).state_id).toBe(startedStateId);
    });

    it("move_story_board succeeds for a non-author, non-assignee member", async () => {
      const story = await createOwnerStory("member move");
      const { error } = await member.rpc("move_story_board", {
        p_project_id: projectId,
        p_item: { kind: "story", id: story.id },
        p_view: "tracker",
        p_expected: { state_id: story.state_id, iteration_id: story.iteration_id, focus: story.focus },
        p_deltas: {},
        p_anchor: {},
      });
      expect(error).toBeNull();
    });
  });

  describe("viewer — read-only, excluded from all three write paths", () => {
    it("direct stories UPDATE is denied (RLS-filtered, 0 rows) for a viewer", async () => {
      const story = await createOwnerStory("viewer direct update");
      const { data, error } = await viewer.from("stories").update({ points: 3 }).eq("id", story.id).select("id");
      expect(error).toBeNull(); // RLS filters silently, not a Postgres error
      expect(data).toHaveLength(0);
    });

    it("set_story_state is denied for a viewer", async () => {
      const story = await createOwnerStory("viewer transition");
      const { error } = await viewer.rpc("set_story_state", { p_story_id: story.id, p_state_id: startedStateId });
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/not allowed to change this story's state/i);
    });

    it("move_story_board is denied for a viewer", async () => {
      const story = await createOwnerStory("viewer move");
      const { error } = await viewer.rpc("move_story_board", {
        p_project_id: projectId,
        p_item: { kind: "story", id: story.id },
        p_view: "tracker",
        p_expected: { state_id: story.state_id, iteration_id: story.iteration_id, focus: story.focus },
        p_deltas: {},
        p_anchor: {},
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    });
  });
});
