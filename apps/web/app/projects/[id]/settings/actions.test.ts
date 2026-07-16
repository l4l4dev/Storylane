import { beforeEach, describe, expect, it, vi } from "vitest";

// TASK-57: moveCustomStatus / moveLane are thin callers of the swap_adjacent
// RPC (the atomic dense-rewrite is proven against the real DB in
// swap-adjacent.integration.test.ts). These assert the action forwards the
// right table/id/direction and rejects an invalid direction instead of
// coercing it to 'down' (doc-1 Low).
const rpcMock = vi.fn();
const rpcResults: Record<string, { data: unknown; error: unknown }> = {};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (fn: string, args: unknown) => {
      rpcMock(fn, args);
      return Promise.resolve(rpcResults[fn] ?? { data: null, error: null });
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function swapCall() {
  const call = rpcMock.mock.calls.find(([fn]) => fn === "swap_adjacent");
  if (!call) {
    throw new Error("swap_adjacent was not called");
  }
  return call[1] as { p_project_id: string; p_table: string; p_id: string; p_direction: string };
}

describe("moveCustomStatus", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
  });

  it("forwards the swap to the custom_statuses table with the id and direction", async () => {
    const { moveCustomStatus } = await import("./actions");

    const formData = new FormData();
    formData.set("status_id", "status-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "down");

    await moveCustomStatus(formData);

    expect(swapCall()).toEqual({
      p_project_id: "project-1",
      p_table: "custom_statuses",
      p_id: "status-a",
      p_direction: "down",
    });
  });

  it("throws the RPC error message", async () => {
    rpcResults.swap_adjacent = { data: null, error: { message: "row not found" } };
    const { moveCustomStatus } = await import("./actions");

    const formData = new FormData();
    formData.set("status_id", "status-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "up");

    await expect(moveCustomStatus(formData)).rejects.toThrow("row not found");
  });

  it("rejects an invalid direction without calling the RPC", async () => {
    const { moveCustomStatus } = await import("./actions");

    const formData = new FormData();
    formData.set("status_id", "status-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "sideways");

    await expect(moveCustomStatus(formData)).rejects.toThrow("Invalid direction");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("moveLane", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
  });

  it("forwards the swap to the swimlanes table with the id and direction", async () => {
    const { moveLane } = await import("./actions");

    const formData = new FormData();
    formData.set("lane_id", "lane-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "up");

    await moveLane(formData);

    expect(swapCall()).toEqual({
      p_project_id: "project-1",
      p_table: "swimlanes",
      p_id: "lane-a",
      p_direction: "up",
    });
  });

  it("throws the RPC error message", async () => {
    rpcResults.swap_adjacent = { data: null, error: { message: "not authorized" } };
    const { moveLane } = await import("./actions");

    const formData = new FormData();
    formData.set("lane_id", "lane-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "down");

    await expect(moveLane(formData)).rejects.toThrow("not authorized");
  });

  it("rejects an invalid direction without calling the RPC", async () => {
    const { moveLane } = await import("./actions");

    const formData = new FormData();
    formData.set("lane_id", "lane-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "");

    await expect(moveLane(formData)).rejects.toThrow("Invalid direction");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
