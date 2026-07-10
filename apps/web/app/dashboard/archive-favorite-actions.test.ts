// apps/web/app/dashboard/archive-favorite-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.fn();
const eqMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      update: (payload: unknown) => {
        updateMock(payload);
        return { eq: eqMock };
      },
    }),
    rpc: rpcMock,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("archiveProject / unarchiveProject / toggleFavorite", () => {
  beforeEach(() => {
    updateMock.mockReset();
    eqMock.mockReset();
    eqMock.mockResolvedValue({ error: null });
    rpcMock.mockReset();
  });

  it("archiveProject sets archived_at to a timestamp for the given project", async () => {
    const { archiveProject } = await import("./actions");
    const formData = new FormData();
    formData.set("project_id", "project-1");

    await archiveProject(formData);

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
    expect(eqMock).toHaveBeenCalledWith("id", "project-1");
  });

  it("unarchiveProject sets archived_at to null for the given project", async () => {
    const { unarchiveProject } = await import("./actions");
    const formData = new FormData();
    formData.set("project_id", "project-1");

    await unarchiveProject(formData);

    expect(updateMock).toHaveBeenCalledWith({ archived_at: null });
    expect(eqMock).toHaveBeenCalledWith("id", "project-1");
  });

  it("toggleFavorite calls the RPC and returns ok: true on success", async () => {
    rpcMock.mockResolvedValue({ error: null });
    const { toggleFavorite } = await import("./actions");

    const result = await toggleFavorite("project-1", true);

    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("toggle_project_favorite", {
      p_project_id: "project-1",
      p_favorite: true,
    });
  });

  it("toggleFavorite returns ok: false without throwing when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ error: { message: "Not a project member" } });
    const { toggleFavorite } = await import("./actions");

    const result = await toggleFavorite("project-1", true);

    expect(result).toEqual({ ok: false });
  });
});
