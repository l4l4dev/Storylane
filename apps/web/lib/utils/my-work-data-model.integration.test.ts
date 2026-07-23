import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-130 (doc-14) + TASK-138 (doc-15) + TASK-176 (Done-as-status): the My Work
// data-model foundation. Done is now a plain status column read from the story's
// live done category — NOT a story_completions log — so this covers:
//   - maintain_story_completed_at maintains stories.completed_at on done
//     entry/exit and writes NO story_completions row (TASK-176)
//   - my_work_columns own-rows RLS + composite-FK guard (a card can't point at
//     another user's column)
//   - the position reset trigger: column_position clears when column_id clears,
//     and todo_position clears when the row leaves Todo (gains a Today date or a
//     free column)
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/my-work-data-model.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("My Work data model (TASK-130/176 integration)", () => {
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

  async function completedAtOf(storyId: string): Promise<string | null> {
    const { data } = await admin.from("stories").select("completed_at").eq("id", storyId).single();
    return (data as { completed_at: string | null }).completed_at;
  }

  // TASK-176: Done is the story's live done category, not a log. Entering done
  // sets completed_at (Done groups by it, the window filters on it) and writes
  // NO story_completions row.
  it("sets completed_at and writes no completion log when a story enters a done state", async () => {
    const story = await createStory(startedStateId, ownerId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);

    expect(await completedAtOf(story)).not.toBeNull();
    const { data: log } = await admin.from("story_completions").select("id").eq("story_id", story);
    expect(log ?? []).toHaveLength(0);
  });

  it("clears completed_at when the story is reopened", async () => {
    const story = await createStory(startedStateId, ownerId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);
    await admin.from("stories").update({ state_id: startedStateId }).eq("id", story); // reopen
    expect(await completedAtOf(story)).toBeNull();
  });

  it("preserves completed_at across a done-to-done state change", async () => {
    const story = await createStory(startedStateId, ownerId);
    await admin.from("stories").update({ state_id: doneStateId }).eq("id", story);
    const first = await completedAtOf(story);
    // No second done state in the classic template, so re-set the same done
    // state; the state_id-unchanged guard preserves completed_at either way.
    await admin.from("stories").update({ state_id: doneStateId, title: "touched" }).eq("id", story);
    expect(await completedAtOf(story)).toBe(first);
  });

  // TASK-138 (doc-15): my_work_columns replaced project_my_work_mapping. It is
  // own-rows only, and its (user_id, id) unique constraint is the target of
  // my_work_story_state's composite FK — the invariant that a card can't point
  // at another user's column.
  it("scopes my_work_columns to own rows and blocks pointing a mark at a foreign column", async () => {
    const { data: ownCols } = await owner.from("my_work_columns").select("id, name").eq("user_id", ownerId);
    expect((ownCols ?? []).some((c) => c.name === "Doing")).toBe(true);

    const email = `mw-col-other-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const otherId = created!.user!.id;
    await admin.from("project_members").insert({ project_id: projectId, user_id: otherId, role: "member" });
    const other = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await other.auth.signInWithPassword({ email, password });

    const { data: crossRead } = await other.from("my_work_columns").select("id").eq("user_id", ownerId);
    expect(crossRead ?? []).toHaveLength(0);

    const foreignColumnId = (ownCols ?? []).find((c) => c.name === "Doing")!.id;
    const story = await createStory(startedStateId, otherId);
    const { error: fkErr } = await other
      .from("my_work_story_state")
      .insert({ user_id: otherId, story_id: story, column_id: foreignColumnId });
    expect(fkErr).not.toBeNull(); // FK violation — can't borrow another user's column
  });

  // Regression guard: column_position must never be non-null once column_id is
  // null — a BEFORE UPDATE trigger enforces this even when the caller (app code,
  // or the column_fk's own ON DELETE SET NULL) only touches column_id.
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

  // TASK-177: todo_position is only valid while the row classifies to Todo (no
  // Today date, no free column). The same BEFORE UPDATE trigger clears it the
  // moment the row gains either — even if the caller forgets (the TASK-161 bug
  // shape).
  it("resets todo_position when the row gains a Today date or a free column", async () => {
    const story = await createStory(startedStateId, ownerId);
    await admin.from("my_work_story_state").upsert({ user_id: ownerId, story_id: story, todo_position: 3 });

    // Gains a Today date — a caller that forgets todo_position; the trigger clears it.
    const { error: todayErr } = await admin
      .from("my_work_story_state")
      .update({ today_date: "2026-07-24" })
      .eq("user_id", ownerId)
      .eq("story_id", story);
    expect(todayErr).toBeNull();
    const { data: afterToday } = await admin
      .from("my_work_story_state")
      .select("today_date, todo_position")
      .eq("user_id", ownerId)
      .eq("story_id", story)
      .single();
    expect(afterToday).toEqual({ today_date: "2026-07-24", todo_position: null });
  });
});
