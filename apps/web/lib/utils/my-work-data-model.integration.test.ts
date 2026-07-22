import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-130 (doc-14): the My Work data-model foundation — the
// story_completions completion-log trigger, its write lockdown, the
// project_my_work_mapping owner-writes RLS, and the stories SELECT OR-clause
// that keeps a completed story readable after the completer leaves the project.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/my-work-data-model.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type CompletionRow = { id: string; story_id: string; user_id: string; completed_at: string };

describe.skipIf(!RUN)("My Work data model (TASK-130 integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  let projectId: string;
  let startedStateId: string; // in_progress
  let doneStateId: string; // done category (classic "Accepted")

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
      .insert({ name: "my-work data model integration test" })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`Failed to create test project: ${projectError?.message}`);
    projectId = project.id;

    const { data: stateRows } = await admin
      .from("project_states")
      .select("id, name, category")
      .eq("project_id", projectId);
    startedStateId = stateRows!.find((s) => s.name === "Started")!.id;
    doneStateId = stateRows!.find((s) => s.category === "done")!.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
  });

  async function createStory(stateId: string | null, assigneeId: string | null): Promise<string> {
    const { data, error } = await admin
      .from("stories")
      .insert({ project_id: projectId, title: "t", state_id: stateId, assignee_id: assigneeId, created_by: ownerId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed story: ${error?.message}`);
    return data.id;
  }

  async function completionsFor(storyId: string): Promise<CompletionRow[]> {
    const { data } = await admin
      .from("story_completions")
      .select("id, story_id, user_id, completed_at")
      .eq("story_id", storyId);
    return (data as CompletionRow[]) ?? [];
  }

  it("logs a completion credited to the assignee when a story enters a done state", async () => {
    const story = await createStory(startedStateId, ownerId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);

    const rows = await completionsFor(story);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(ownerId);
    // stories.completed_at is set too (the trigger's existing effect).
    const { data: s } = await admin.from("stories").select("completed_at").eq("id", story).single();
    expect((s as { completed_at: string | null }).completed_at).not.toBeNull();
  });

  // The FK-timing fix: a story CREATED directly into a done state must not fail
  // (a BEFORE INSERT trigger can't FK-reference the not-yet-inserted story) and
  // must not log a completion (born done isn't a transition from non-done).
  it("does not fail or log when a story is created directly into a done state", async () => {
    const story = await createStory(doneStateId, ownerId); // would throw on FK if logged on INSERT
    expect(await completionsFor(story)).toHaveLength(0);
  });

  it("keeps the completion row and clears completed_at when the story is reopened", async () => {
    const story = await createStory(startedStateId, ownerId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);
    await admin.from("stories").update({ state_id: startedStateId }).eq("id", story); // reopen

    expect(await completionsFor(story)).toHaveLength(1); // append-only: not deleted
    const { data: s } = await admin.from("stories").select("completed_at").eq("id", story).single();
    expect((s as { completed_at: string | null }).completed_at).toBeNull();
  });

  it("adds a second completion row on re-completion", async () => {
    const story = await createStory(startedStateId, ownerId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);
    await admin.from("stories").update({ state_id: startedStateId }).eq("id", story);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story); // redo

    expect(await completionsFor(story)).toHaveLength(2);
  });

  it("does not log when an unassigned story reaches done (assignee guard)", async () => {
    const story = await createStory(startedStateId, null);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);
    expect(await completionsFor(story)).toHaveLength(0);
  });

  // rls-security-reviewer HIGH: the completion insert must credit only a
  // current project MEMBER. Otherwise any member could set assignee_id to an
  // outsider's profile, move the story to done, and the forged completion row
  // would grant that outsider permanent read access via stories' SELECT
  // OR-clause. Here the assignee is a real profile but NOT a project member.
  it("does not log a completion for an assignee who is not a project member", async () => {
    const email = `mw-outsider-${Date.now()}@storylane.local`;
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: "integration-test-only-password",
      email_confirm: true,
    });
    const outsiderId = created!.user!.id; // a profile, but never added to the project
    const story = await createStory(startedStateId, outsiderId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);

    expect(await completionsFor(story)).toHaveLength(0); // not credited
    // And the outsider gets no read access to the story.
    const outsider = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await outsider.auth.signInWithPassword({ email, password: "integration-test-only-password" });
    const { data: storyRow } = await outsider.from("stories").select("id").eq("id", story).maybeSingle();
    expect(storyRow).toBeNull();
  });

  it("blocks direct client writes to story_completions (lockdown)", async () => {
    const story = await createStory(startedStateId, ownerId);
    const { error } = await owner.from("story_completions").insert({ story_id: story, user_id: ownerId });
    expect(error).not.toBeNull(); // no client INSERT policy + grant revoked
  });

  it("lets a member read but only an owner write project_my_work_mapping", async () => {
    // Owner (dev user) writes the mapping.
    const { error: insErr } = await owner
      .from("project_my_work_mapping")
      .insert({ project_id: projectId, doing_state_id: startedStateId, done_state_id: doneStateId, configured_by: ownerId });
    expect(insErr).toBeNull();

    // A plain member can read it but not write it.
    const email = `mw-map-member-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    await admin.from("project_members").insert({ project_id: projectId, user_id: created!.user!.id, role: "member" });
    const memberClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await memberClient.auth.signInWithPassword({ email, password });

    const { data: readRow } = await memberClient
      .from("project_my_work_mapping")
      .select("project_id")
      .eq("project_id", projectId)
      .maybeSingle();
    expect(readRow).not.toBeNull(); // member reads

    const { data: writeRows } = await memberClient
      .from("project_my_work_mapping")
      .update({ doing_state_id: null })
      .eq("project_id", projectId)
      .select("project_id");
    expect(writeRows ?? []).toHaveLength(0); // member write RLS-filtered to 0 rows
  });

  // doc-14's sharpest edge: a story stays readable to whoever completed it even
  // after they leave the project, so their Done log can live-join to it.
  it("keeps a completed story readable to a completer who has left the project", async () => {
    const email = `mw-leaver-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const leaverId = created!.user!.id;
    await admin.from("project_members").insert({ project_id: projectId, user_id: leaverId, role: "member" });
    const leaver = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await leaver.auth.signInWithPassword({ email, password });

    // Assigned to the leaver, then completed (logs a completion crediting them).
    const story = await createStory(startedStateId, leaverId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);

    // Remove them from the project.
    await owner.rpc("remove_member", { p_project_id: projectId, p_user_id: leaverId });

    // They can still read the story (via the stories SELECT OR-clause) and their
    // own completion row.
    const { data: storyRow } = await leaver.from("stories").select("id").eq("id", story).maybeSingle();
    expect(storyRow).not.toBeNull();
    const { data: ownCompletion } = await leaver
      .from("story_completions")
      .select("id")
      .eq("story_id", story)
      .maybeSingle();
    expect(ownCompletion).not.toBeNull();
  });
});
