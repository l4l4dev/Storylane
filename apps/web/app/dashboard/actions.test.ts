import { beforeEach, describe, expect, it, vi } from "vitest";

const createProjectMock = vi.fn();
const inviteMemberMock = vi.fn();
const getUserMock = vi.fn();

const rpcMock = vi.fn((fn: string, args: unknown) => {
  if (fn === "invite_member") return inviteMemberMock(args);
  throw new Error(`unexpected rpc: ${fn}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
    from: () => ({
      insert: (values: unknown) => {
        createProjectMock(values);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: "project-1" }, error: null }),
          }),
        };
      },
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

describe("createProject", () => {
  beforeEach(() => {
    rpcMock.mockClear();
    createProjectMock.mockReset();
    inviteMemberMock.mockReset();
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: "creator-1" } } });
    inviteMemberMock.mockResolvedValue({ error: null });
  });

  it("invites each unique, non-self id and redirects without invite_failed on success", async () => {
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    formData.append("invited_user_ids", "user-a");
    formData.append("invited_user_ids", "user-a"); // duplicate
    formData.append("invited_user_ids", "creator-1"); // self — must be excluded

    await expect(createProject(formData)).rejects.toThrow("REDIRECT:/projects/project-1/board");
    expect(inviteMemberMock).toHaveBeenCalledTimes(1);
    expect(inviteMemberMock).toHaveBeenCalledWith({
      p_project_id: "project-1",
      p_user_id: "user-a",
      p_role: "member",
    });
  });

  it("redirects with invite_failed count when some invites fail, but still creates the project", async () => {
    inviteMemberMock
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
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    for (let i = 0; i < 25; i++) {
      formData.append("invited_user_ids", `user-${i}`);
    }

    await expect(createProject(formData)).rejects.toThrow(/REDIRECT:/);
    expect(inviteMemberMock).toHaveBeenCalledTimes(20);
  });

  // TASK-25 follow-up: velocity_window had no validation before hitting the
  // DB's `>= 1` CHECK constraint (20260714000001_velocity_window_check.sql)
  // — clampVelocityWindow now clamps before the RPC is called, so a bad client
  // value never reaches Supabase as-is.
  it("clamps an out-of-range velocity_window before creating", async () => {
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    formData.set("velocity_window", "0");

    await expect(createProject(formData)).rejects.toThrow("REDIRECT:/projects/project-1/board");
    expect(createProjectMock).toHaveBeenCalledWith(expect.objectContaining({ velocity_window: 1 }));
  });

});
