import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// What stories(project_id, assignee_id) -> project_members(project_id, user_id)
// (20260730030000) decides, and nothing else does:
//
//  - a non-member assignee is rejected on every write path, not only the two
//    cross-project RPCs that probe membership themselves
//  - removing a member unassigns their stories in that project, through
//    ON DELETE SET NULL rather than any code in remove_member
//  - move/copy still DROP a non-member assignee instead of failing, the
//    behaviour spec/features.md asks for and the reason their unlocked
//    membership branch is not redundant with the constraint
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/assignee-membership-fk.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const FK = "stories_assignee_project_fkey";

describe.skipIf(!RUN)("assignee membership FK (integration)", () => {
  let asOwner: SupabaseClient; // dev user, owner of every project here
  let asService: SupabaseClient; // service role: fixtures and reads that must bypass RLS
  let ownerId: string;
  let memberId: string; // added to the projects that need a second member
  let outsiderId: string; // a real profile that is a member of nothing
  const createdProjectIds: string[] = [];
  const createdUserIds: string[] = [];

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
    asOwner = createClient(url, anonKey, { auth: { persistSession: false } });
    const auth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    ownerId = auth.data.user.id;

    memberId = await createUser("assignee-fk-member");
    outsiderId = await createUser("assignee-fk-outsider");
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await asService.from("projects").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await asService.auth.admin.deleteUser(id);
    }
  });

  async function createUser(prefix: string): Promise<string> {
    const { data, error } = await asService.auth.admin.createUser({
      email: `${prefix}-${Date.now()}-${createdUserIds.length}@storylane.local`,
      password: "integration-test-only-password",
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`Failed to create ${prefix}: ${error?.message}`);
    createdUserIds.push(data.user.id);
    return data.user.id;
  }

  async function createProject(name: string): Promise<string> {
    const { data, error } = await asOwner.from("projects").insert({ name }).select("id").single();
    if (error || !data) throw new Error(`Failed to create test project: ${error?.message}`);
    createdProjectIds.push(data.id);
    return data.id;
  }

  async function addMember(projectId: string, userId: string): Promise<void> {
    const { error } = await asOwner.rpc("invite_member", { p_project_id: projectId, p_user_id: userId });
    if (error) throw new Error(`invite_member failed: ${error.message}`);
  }

  /** Inserts directly: the story fixtures here only need a row, not a landing zone. */
  async function createStory(projectId: string, title: string, assigneeId: string | null): Promise<string> {
    const { data, error } = await asOwner
      .from("stories")
      .insert({ project_id: projectId, title, assignee_id: assigneeId, created_by: ownerId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to create test story: ${error?.message}`);
    return data.id;
  }

  async function assigneeOf(storyId: string): Promise<string | null> {
    const { data, error } = await asService.from("stories").select("assignee_id").eq("id", storyId).single();
    if (error || !data) throw new Error(`Failed to read back story ${storyId}: ${error?.message}`);
    return data.assignee_id;
  }

  it("rejects a non-member assignee on update_story", async () => {
    const projectId = await createProject(`assignee-fk-update-${Date.now()}`);
    const storyId = await createStory(projectId, "Update me", null);

    const { error } = await asOwner.rpc("update_story", {
      p_story_id: storyId,
      p_title: "Update me",
      p_description: null,
      p_story_type: "feature",
      p_points: null,
      p_parent_id: null,
      p_assignee_id: outsiderId,
      p_label_ids: [],
    });

    expect(error?.code).toBe("23503");
    expect(error?.message).toContain(FK);
    expect(await assigneeOf(storyId)).toBeNull();
  });

  it("rejects a non-member assignee on create_draft_story", async () => {
    const projectId = await createProject(`assignee-fk-draft-${Date.now()}`);

    const { error } = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "icebox",
      p_title: "Draft with a stranger on it",
      p_assignee_id: outsiderId,
    });

    expect(error?.code).toBe("23503");
    expect(error?.message).toContain(FK);
    // The RPC is one transaction, so the rejection must leave no row behind.
    const { count } = await asService
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    expect(count).toBe(0);
  });

  it("accepts an assignee who is a member", async () => {
    const projectId = await createProject(`assignee-fk-member-ok-${Date.now()}`);
    await addMember(projectId, memberId);
    const storyId = await createStory(projectId, "Assign a real member", null);

    const { error } = await asOwner.rpc("update_story", {
      p_story_id: storyId,
      p_title: "Assign a real member",
      p_description: null,
      p_story_type: "feature",
      p_points: null,
      p_parent_id: null,
      p_assignee_id: memberId,
      p_label_ids: [],
    });

    expect(error).toBeNull();
    expect(await assigneeOf(storyId)).toBe(memberId);
  });

  it("unassigns the removed member's stories, and only in that project", async () => {
    const kept = await createProject(`assignee-fk-kept-${Date.now()}`);
    const left = await createProject(`assignee-fk-left-${Date.now()}`);
    await addMember(kept, memberId);
    await addMember(left, memberId);
    const keptStory = await createStory(kept, "Stays assigned", memberId);
    const leftStory = await createStory(left, "Gets unassigned", memberId);

    const { error } = await asOwner.rpc("remove_member", { p_project_id: left, p_user_id: memberId });
    expect(error).toBeNull();

    expect(await assigneeOf(leftStory)).toBeNull();
    expect(await assigneeOf(keptStory)).toBe(memberId);
  });

  it("still drops — not rejects — a non-member assignee on move_story_to_project", async () => {
    const source = await createProject(`assignee-fk-move-src-${Date.now()}`);
    const target = await createProject(`assignee-fk-move-dst-${Date.now()}`);
    await addMember(source, memberId); // member of the source only
    const storyId = await createStory(source, "Moves without its assignee", memberId);

    const { data, error } = await asOwner.rpc("move_story_to_project", {
      p_story_id: storyId,
      p_target_project_id: target,
    });

    expect(error).toBeNull();
    const moved = data as { story_id: string };
    expect(await assigneeOf(moved.story_id)).toBeNull();
  });

  it("carries the assignee over when they are a member of the target too", async () => {
    const source = await createProject(`assignee-fk-copy-src-${Date.now()}`);
    const target = await createProject(`assignee-fk-copy-dst-${Date.now()}`);
    await addMember(source, memberId);
    await addMember(target, memberId);
    const storyId = await createStory(source, "Copies with its assignee", memberId);

    const { data, error } = await asOwner.rpc("copy_story_to_project", {
      p_story_id: storyId,
      p_target_project_id: target,
    });

    expect(error).toBeNull();
    const copied = data as { story_id: string };
    expect(await assigneeOf(copied.story_id)).toBe(memberId);
  });

  async function assigneeLogs(storyId: string) {
    const { data } = await asService
      .from("activity_logs")
      .select("actor_id, payload")
      .eq("story_id", storyId)
      .eq("action", "story.assignee_changed");
    return (data ?? []) as { actor_id: string; payload: Record<string, unknown> }[];
  }

  it("logs an assignee change as ids, with no display name in the payload", async () => {
    const projectId = await createProject(`assignee-log-set-${Date.now()}`);
    await addMember(projectId, memberId);
    const storyId = await createStory(projectId, "Log me", null);

    const { error } = await asOwner.rpc("update_story", {
      p_story_id: storyId,
      p_title: "Log me",
      p_description: null,
      p_story_type: "feature",
      p_points: null,
      p_parent_id: null,
      p_assignee_id: memberId,
      p_label_ids: [],
    });
    expect(error).toBeNull();

    const logs = await assigneeLogs(storyId);
    expect(logs).toHaveLength(1);
    expect(logs[0].actor_id).toBe(ownerId);
    expect(logs[0].payload).toMatchObject({ from_id: null, to_id: memberId });
    // profiles SELECT is `id = auth.uid() or shares_project_with(id)`, and the
    // trigger is SECURITY DEFINER — a name stored here would outlive the
    // membership that authorised reading it.
    expect(logs[0].payload).not.toHaveProperty("to_name");
    expect(logs[0].payload).not.toHaveProperty("from_name");
  });

  // The cascade is the case with no code path of its own: the composite FK
  // performs the UPDATE, so nothing in remove_member knows a row was written.
  it("logs the unassignment the member removal cascades, attributed to the remover", async () => {
    const projectId = await createProject(`assignee-log-cascade-${Date.now()}`);
    await addMember(projectId, memberId);
    const storyId = await createStory(projectId, "Loses its assignee", memberId);
    expect(await assigneeLogs(storyId)).toHaveLength(0);

    const { error } = await asOwner.rpc("remove_member", { p_project_id: projectId, p_user_id: memberId });
    expect(error).toBeNull();

    const logs = await assigneeLogs(storyId);
    expect(logs).toHaveLength(1);
    expect(logs[0].actor_id).toBe(ownerId);
    expect(logs[0].payload).toMatchObject({ from_id: memberId, to_id: null });
  });

  // The bet 20260804073330 rests on: set_config(..., is_local) is visible to the
  // RI trigger the FK runs, so the cascade's UPDATEs carry the token. If it were
  // not, the rows would be unmarked and the feed would show all N again.
  it("marks every story the removal cascade unassigns with one shared token", async () => {
    const projectId = await createProject(`feed-collapse-${Date.now()}`);
    await addMember(projectId, memberId);
    const storyIds = await Promise.all(
      [0, 1, 2].map((n) => createStory(projectId, `Held by the leaver ${n}`, memberId)),
    );

    const { error } = await asOwner.rpc("remove_member", { p_project_id: projectId, p_user_id: memberId });
    expect(error).toBeNull();

    const { data: rows } = await asService
      .from("activity_logs")
      .select("action, story_id, payload")
      .eq("project_id", projectId);
    const cascade = (rows ?? []).filter((r) => r.action === "story.assignee_changed");
    const summary = (rows ?? []).filter((r) => r.action === "member.removed");

    // AC#2: one entry for the removal...
    expect(summary).toHaveLength(1);
    expect(summary[0].story_id).toBeNull();
    expect(summary[0].payload).toMatchObject({
      removed_user_id: memberId,
      story_count: storyIds.length,
      self_leave: false,
    });
    // ...whose own row must NOT carry the key, or the feed filter eats it too.
    expect(summary[0].payload).not.toHaveProperty("feed_collapsed");

    // AC#3: the per-story rows survive, all under one token.
    expect(cascade).toHaveLength(storyIds.length);
    const tokens = new Set(cascade.map((r) => (r.payload as Record<string, string>).feed_collapsed));
    expect(tokens.size).toBe(1);
    expect([...tokens][0]).toBe((summary[0].payload as Record<string, string>).removal_id);

    // AC#2, the reader's half: the feed's own filters leave exactly the summary.
    const { data: feed } = await asService
      .from("activity_logs")
      .select("action")
      .eq("project_id", projectId)
      .filter("payload->>bookkeeping", "is", null)
      .filter("payload->>feed_collapsed", "is", null);
    expect((feed ?? []).filter((r) => r.action === "story.assignee_changed")).toHaveLength(0);
    expect((feed ?? []).filter((r) => r.action === "member.removed")).toHaveLength(1);

    // AC#3, the reader's half: story detail keys on story_id and does not filter
    // this key, so each story still explains its own unassignment.
    for (const storyId of storyIds) {
      expect(await assigneeLogs(storyId)).toHaveLength(1);
    }
  });

  // An ordinary reassignment must not be collapsed: the token is set only for
  // the duration of the delete, so nothing else can pick it up.
  it("leaves a plain assignee change unmarked", async () => {
    const projectId = await createProject(`feed-collapse-plain-${Date.now()}`);
    await addMember(projectId, memberId);
    const storyId = await createStory(projectId, "Reassigned normally", null);

    const { error } = await asOwner.from("stories").update({ assignee_id: memberId }).eq("id", storyId);
    expect(error).toBeNull();

    const logs = await assigneeLogs(storyId);
    expect(logs).toHaveLength(1);
    expect(logs[0].payload.feed_collapsed).toBeNull();
  });
});
