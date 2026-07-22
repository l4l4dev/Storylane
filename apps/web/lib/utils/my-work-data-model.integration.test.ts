import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-130 (doc-14) + TASK-138 (doc-15): the My Work data-model foundation —
// the story_completions completion-log trigger, its write lockdown, the stories
// SELECT OR-clause that keeps a completed story readable after the completer
// leaves the project, and the my_work_columns own-rows RLS + composite-FK guard
// that replaced the dropped project_my_work_mapping.
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

  // TASK-138 (doc-15): my_work_columns replaced project_my_work_mapping. It is
  // own-rows only, and its (user_id, id) unique constraint is the target of
  // my_work_story_state's composite FK — the invariant that a card can't point
  // at another user's column.
  it("scopes my_work_columns to own rows and blocks pointing a mark at a foreign column", async () => {
    // The dev user (owner client) reads their pre-seeded 'Doing' column.
    const { data: ownCols } = await owner.from("my_work_columns").select("id, name").eq("user_id", ownerId);
    expect((ownCols ?? []).some((c) => c.name === "Doing")).toBe(true);

    // A second user has their own separate columns.
    const email = `mw-col-other-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const otherId = created!.user!.id;
    await admin.from("project_members").insert({ project_id: projectId, user_id: otherId, role: "member" });
    const other = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await other.auth.signInWithPassword({ email, password });

    // The other user cannot see the dev user's columns (own-rows SELECT).
    const { data: crossRead } = await other.from("my_work_columns").select("id").eq("user_id", ownerId);
    expect(crossRead ?? []).toHaveLength(0);

    // The composite FK blocks pointing the other user's mark at the dev user's
    // column: (other.user_id, ownColumnId) has no matching my_work_columns row.
    const foreignColumnId = (ownCols ?? []).find((c) => c.name === "Doing")!.id;
    const story = await createStory(startedStateId, otherId);
    const { error: fkErr } = await other
      .from("my_work_story_state")
      .insert({ user_id: otherId, story_id: story, column_id: foreignColumnId });
    expect(fkErr).not.toBeNull(); // FK violation — can't borrow another user's column
  });

  // Regression guard: column_position must never be non-null
  // once column_id is null — a BEFORE UPDATE trigger enforces this even when
  // the caller (app code, or the column_fk's own ON DELETE SET NULL) only
  // touches column_id and forgets column_position.
  it("resets column_position whenever column_id is cleared or the column is deleted", async () => {
    const { data: column, error: columnError } = await admin
      .from("my_work_columns")
      .insert({ user_id: ownerId, name: `trigger-test-${Date.now()}`, position: 100 })
      .select("id")
      .single();
    if (columnError || !column) throw new Error(`Failed to seed column: ${columnError?.message}`);

    const story = await createStory(startedStateId, ownerId);
    await admin
      .from("my_work_story_state")
      .upsert({ user_id: ownerId, story_id: story, column_id: column.id, column_position: 0 });

    // A caller that clears column_id but forgets column_position (the exact
    // shape of the bug this migration fixes) — the trigger saves it.
    const { error: updateError } = await admin
      .from("my_work_story_state")
      .update({ column_id: null })
      .eq("user_id", ownerId)
      .eq("story_id", story);
    expect(updateError).toBeNull();
    const { data: afterClear } = await admin
      .from("my_work_story_state")
      .select("column_id, column_position")
      .eq("user_id", ownerId)
      .eq("story_id", story)
      .single();
    expect(afterClear).toEqual({ column_id: null, column_position: null });

    // Put it back, then delete the column itself (the FK's ON DELETE SET NULL
    // path) — must not raise a check-constraint violation.
    await admin
      .from("my_work_story_state")
      .update({ column_id: column.id, column_position: 0 })
      .eq("user_id", ownerId)
      .eq("story_id", story);
    const { error: deleteError } = await admin.from("my_work_columns").delete().eq("id", column.id);
    expect(deleteError).toBeNull();
    const { data: afterDelete } = await admin
      .from("my_work_story_state")
      .select("column_id, column_position")
      .eq("user_id", ownerId)
      .eq("story_id", story)
      .single();
    expect(afterDelete).toEqual({ column_id: null, column_position: null });
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
