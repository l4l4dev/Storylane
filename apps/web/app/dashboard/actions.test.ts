import { beforeEach, describe, expect, it, vi } from "vitest";

const createProjectMock = vi.fn();
const inviteMemberMock = vi.fn();
const getUserMock = vi.fn();
let insertResult = { data: { id: "project-1" }, error: null as { message: string } | null };

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
            single: () => Promise.resolve(insertResult),
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
    insertResult = { data: { id: "project-1" }, error: null };
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

  it("starts all invites without waiting for an earlier invite to finish", async () => {
    let resolveFirstInvite: ((value: { error: null }) => void) | undefined;
    inviteMemberMock
      .mockImplementationOnce(
        () =>
          new Promise<{ error: null }>((resolve) => {
            resolveFirstInvite = resolve;
          }),
      )
      .mockResolvedValueOnce({ error: null });
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");
    formData.append("invited_user_ids", "user-a");
    formData.append("invited_user_ids", "user-b");

    const result = createProject(formData);
    await vi.waitFor(() => expect(inviteMemberMock).toHaveBeenCalledTimes(2));
    resolveFirstInvite?.({ error: null });
    await expect(result).rejects.toThrow("REDIRECT:/projects/project-1/board");
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

  // TASK-118: a DB error must be returned, not thrown, so the calling
  // client component can show it inline instead of hitting an uncaught
  // exception / the nearest error.tsx boundary.
  it("returns an ok:false result instead of throwing on a DB insert error", async () => {
    insertResult = { data: null as unknown as { id: string }, error: { message: "duplicate key value" } };
    const { createProject } = await import("./actions");

    const formData = new FormData();
    formData.set("name", "My Project");

    await expect(createProject(formData)).resolves.toEqual({ ok: false, message: "duplicate key value" });
    expect(inviteMemberMock).not.toHaveBeenCalled();
  });

});
