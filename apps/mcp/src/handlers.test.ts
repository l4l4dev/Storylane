import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { toggleStoryTask } from "./handlers.js";

// Mocked-client regression test for TASK-114 (doc-13 finding #6): the
// archived-project guard must fail closed, not silently skip, when the
// stories(project_id) embed doesn't resolve — a case the real-RLS
// integration suite (handlers.integration.test.ts) can't provoke since
// tasks/stories SELECT policies share the same membership check.
function fakeSupabase(opts: {
  taskRow: { story_id: string; stories: { project_id: string } | null } | null;
  projectRow?: { archived_at: string | null } | null;
}) {
  return {
    from: (table: string) => {
      if (table === "tasks") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.taskRow, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: async () => ({ data: [{ id: "task-1", title: "x", is_done: true }], error: null }),
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.projectRow ?? null, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("toggleStoryTask", () => {
  it("fails closed when the stories(project_id) embed resolves null", async () => {
    const supabase = fakeSupabase({ taskRow: { story_id: "story-1", stories: null } });

    await expect(toggleStoryTask(supabase, { task_id: "task-1", done: true })).rejects.toThrow(/not a member/i);
  });

  it("still rejects an archived project when the embed resolves normally", async () => {
    const supabase = fakeSupabase({
      taskRow: { story_id: "story-1", stories: { project_id: "project-1" } },
      projectRow: { archived_at: "2026-01-01T00:00:00Z" },
    });

    await expect(toggleStoryTask(supabase, { task_id: "task-1", done: true })).rejects.toThrow(/archived/i);
  });

  it("toggles the task when the project is writable", async () => {
    const supabase = fakeSupabase({
      taskRow: { story_id: "story-1", stories: { project_id: "project-1" } },
      projectRow: { archived_at: null },
    });

    await expect(toggleStoryTask(supabase, { task_id: "task-1", done: true })).resolves.toEqual({
      id: "task-1",
      title: "x",
      is_done: true,
    });
  });
});
