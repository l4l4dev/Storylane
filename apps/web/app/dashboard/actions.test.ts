import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const insertProjectSelectSingleMock = vi.fn();
const insertProjectMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: (table: string) => {
      if (table === "projects") {
        return {
          insert: (payload: unknown) => {
            insertProjectMock(payload);
            return {
              select: () => ({ single: insertProjectSelectSingleMock }),
            };
          },
        };
      }
      // custom_statuses insert (free mode only) — not exercised by these
      // tracker-mode invite tests.
      return { insert: async () => ({ error: null }) };
    },
    rpc: rpcMock,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

describe("createProject invite handling", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    insertProjectSelectSingleMock.mockReset();
    insertProjectMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: "creator-1" } } });
    insertProjectSelectSingleMock.mockResolvedValue({ data: { id: "project-1" }, error: null });
  });

  it("invites each unique, non-self id and redirects without invite_failed on success", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    formData.append("invited_user_ids", "user-a");
    formData.append("invited_user_ids", "user-a"); // duplicate
    formData.append("invited_user_ids", "creator-1"); // self — must be excluded

    await expect(createProject(formData)).rejects.toThrow("REDIRECT:/projects/project-1/board");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("invite_member", {
      p_project_id: "project-1",
      p_user_id: "user-a",
      p_role: "member",
    });
  });

  it("redirects with invite_failed count when some invites fail, but still creates the project", async () => {
    rpcMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "No such user" } });
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    formData.append("invited_user_ids", "user-a");
    formData.append("invited_user_ids", "user-b");

    await expect(createProject(formData)).rejects.toThrow("REDIRECT:/projects/project-1/board?invite_failed=1");
  });

  it("caps invites at 20 ids", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    for (let i = 0; i < 25; i++) {
      formData.append("invited_user_ids", `user-${i}`);
    }

    await expect(createProject(formData)).rejects.toThrow(/REDIRECT:/);
    expect(rpcMock).toHaveBeenCalledTimes(20);
  });

  // TASK-25 follow-up: velocity_window had no validation before hitting the
  // DB's `>= 1` CHECK constraint (20260714000001_velocity_window_check.sql)
  // — clampVelocityWindow now clamps before the insert is even built, so a
  // bad client value never reaches Supabase as-is.
  it("clamps an out-of-range velocity_window before inserting", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    formData.set("velocity_window", "0");

    await expect(createProject(formData)).rejects.toThrow("REDIRECT:/projects/project-1/board");
    expect(insertProjectMock).toHaveBeenCalledWith(expect.objectContaining({ velocity_window: 1 }));
  });
});
