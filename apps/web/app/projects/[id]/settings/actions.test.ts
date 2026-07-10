import { beforeEach, describe, expect, it, vi } from "vitest";

type EqResult = { error: { message: string } | null };

let listData: Array<{ id: string; position: number }> = [];
let updateResults: EqResult[] = [];
const updateCalls: Array<{ payload: unknown; eqCalls: [string, unknown][] }> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: listData }),
        }),
      }),
      update: (payload: unknown) => {
        const call: { payload: unknown; eqCalls: [string, unknown][] } = { payload, eqCalls: [] };
        updateCalls.push(call);
        const result = updateResults[updateCalls.length - 1] ?? { error: null };
        const chain: {
          eq: (col: string, val: unknown) => typeof chain;
          then: (resolve: (v: EqResult) => void) => void;
        } = {
          eq: (col: string, val: unknown) => {
            call.eqCalls.push([col, val]);
            return chain;
          },
          then: (resolve: (v: EqResult) => void) => resolve(result),
        };
        return chain;
      },
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("moveCustomStatus", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    updateResults = [];
    listData = [
      { id: "status-a", position: 0 },
      { id: "status-b", position: 1 },
    ];
  });

  it("filters both swap updates by project_id", async () => {
    updateResults = [{ error: null }, { error: null }];
    const { moveCustomStatus } = await import("./actions");

    const formData = new FormData();
    formData.set("status_id", "status-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "down");

    await moveCustomStatus(formData);

    expect(updateCalls).toHaveLength(2);
    for (const call of updateCalls) {
      expect(call.eqCalls).toContainEqual(["project_id", "project-1"]);
    }
  });

  it("throws when one of the two swap updates fails", async () => {
    updateResults = [{ error: null }, { error: { message: "row not found" } }];
    const { moveCustomStatus } = await import("./actions");

    const formData = new FormData();
    formData.set("status_id", "status-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "down");

    await expect(moveCustomStatus(formData)).rejects.toThrow("row not found");
  });
});

describe("moveLane", () => {
  beforeEach(() => {
    updateCalls.length = 0;
    updateResults = [];
    listData = [
      { id: "lane-a", position: 0 },
      { id: "lane-b", position: 1 },
    ];
  });

  it("filters both swap updates by project_id", async () => {
    updateResults = [{ error: null }, { error: null }];
    const { moveLane } = await import("./actions");

    const formData = new FormData();
    formData.set("lane_id", "lane-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "down");

    await moveLane(formData);

    expect(updateCalls).toHaveLength(2);
    for (const call of updateCalls) {
      expect(call.eqCalls).toContainEqual(["project_id", "project-1"]);
    }
  });

  it("throws when one of the two swap updates fails", async () => {
    updateResults = [{ error: { message: "row not found" } }, { error: null }];
    const { moveLane } = await import("./actions");

    const formData = new FormData();
    formData.set("lane_id", "lane-a");
    formData.set("project_id", "project-1");
    formData.set("direction", "down");

    await expect(moveLane(formData)).rejects.toThrow("row not found");
  });
});
