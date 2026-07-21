import { beforeEach, describe, expect, it, vi } from "vitest";

const insertResults: Record<string, { error: { message: string } | null }> = {};
const writeResults: Record<
  string,
  { data: ReadonlyArray<unknown> | null; error: { message: string } | null }
> = {};
const selectRows: Record<string, ReadonlyArray<Record<string, unknown>>> = {};
let authUser: { id: string } | null = { id: "user-1" };

function writeChain(table: string) {
  const result = () => writeResults[table] ?? { data: [{ id: "row-1" }], error: null };
  const node = {
    eq: () => node,
    select: () => Promise.resolve(result()),
  };
  return node;
}

function selectChain(table: string) {
  let rows = selectRows[table] ?? [];
  const node = {
    eq: (col: string, val: unknown) => {
      rows = rows.filter((row) => row[col] === val);
      return node;
    },
    in: (col: string, vals: unknown[]) => {
      rows = rows.filter((row) => vals.includes(row[col]));
      return node;
    },
    neq: (col: string, val: unknown) => {
      rows = rows.filter((row) => row[col] !== val);
      return Promise.resolve({ data: rows, error: null });
    },
  };
  return node;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser } }) },
    from: (table: string) => ({
      insert: () => Promise.resolve(insertResults[table] ?? { error: null }),
      update: () => writeChain(table),
      delete: () => writeChain(table),
      select: () => selectChain(table),
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("story mutation action results", () => {
  beforeEach(() => {
    for (const key of Object.keys(insertResults)) {
      delete insertResults[key];
    }
    for (const key of Object.keys(writeResults)) {
      delete writeResults[key];
    }
    for (const key of Object.keys(selectRows)) {
      delete selectRows[key];
    }
    authUser = { id: "user-1" };
  });

  it("returns an add-comment insert error as a failure result", async () => {
    insertResults.comments = { error: { message: "Story not found" } };
    const { addComment } = await import("./actions");
    const formData = new FormData();
    formData.set("story_id", "story-1");
    formData.set("project_id", "project-1");
    formData.set("body", "Looks good");

    await expect(addComment(formData)).resolves.toEqual({
      ok: false,
      message: "Story not found",
    });
  });

  it("returns an add-task insert error as a failure result", async () => {
    insertResults.tasks = { error: { message: "Failed to add task" } };
    const { addTask } = await import("./actions");
    const formData = new FormData();
    formData.set("story_id", "story-1");
    formData.set("title", "Write tests");

    await expect(addTask(formData)).resolves.toEqual({
      ok: false,
      message: "Failed to add task",
    });
  });

  it("returns a zero-row task update as a failure result", async () => {
    writeResults.tasks = { data: [], error: null };
    const { toggleTask } = await import("./actions");
    const formData = new FormData();
    formData.set("story_id", "story-1");
    formData.set("task_id", "task-1");
    formData.set("is_done", "false");

    await expect(toggleTask(formData)).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/no matching row/i),
    });
  });

  it("returns a task delete error as a failure result", async () => {
    writeResults.tasks = { data: null, error: { message: "Task not found" } };
    const { deleteTask } = await import("./actions");
    const formData = new FormData();
    formData.set("story_id", "story-1");
    formData.set("task_id", "task-1");

    await expect(deleteTask(formData)).resolves.toEqual({
      ok: false,
      message: "Task not found",
    });
  });

  it("excludes a project where the caller is only a viewer, even if another member owns it", async () => {
    selectRows.project_members = [
      // caller is viewer-only in project-2 — must not appear as a target
      { user_id: "user-1", role: "viewer", project_id: "project-2", projects: { id: "project-2", name: "Project Two" } },
      { user_id: "user-2", role: "owner", project_id: "project-2", projects: { id: "project-2", name: "Project Two" } },
      // caller owns project-3 — must appear
      { user_id: "user-1", role: "owner", project_id: "project-3", projects: { id: "project-3", name: "Project Three" } },
    ];
    const { getMoveTargetProjects } = await import("./actions");

    await expect(getMoveTargetProjects("project-1")).resolves.toEqual([
      { id: "project-3", name: "Project Three" },
    ]);
  });
});
