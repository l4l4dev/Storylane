import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureCurrentIterationMock = vi.fn();

vi.mock("@/app/projects/[id]/board/actions", () => ({
  ensureCurrentIteration: ensureCurrentIterationMock,
}));

beforeEach(() => {
  ensureCurrentIterationMock.mockReset();
});

// TASK-8 fable-advisor finding: /dashboard was rolling over every tracker
// project on every load, including archived ones — creating a new empty
// iteration in an archived project each time anyone viewed the page.
describe("projectsNeedingRollover", () => {
  it("excludes archived tracker projects", async () => {
    const { projectsNeedingRollover } = await import("./rollover");
    const projects = [
      { id: "active", archived_at: null },
      { id: "archived", archived_at: "2026-07-10T00:00:00.000Z" },
    ];

    expect(projectsNeedingRollover(projects).map((p) => p.id)).toEqual(["active"]);
  });
});

describe("rolloverIterationSafely", () => {
  it("resolves even when ensureCurrentIteration throws", async () => {
    ensureCurrentIterationMock.mockRejectedValueOnce(new Error("finalize_iteration failed"));
    const { rolloverIterationSafely } = await import("./rollover");

    await expect(rolloverIterationSafely("project-broken")).resolves.toBeUndefined();
  });

  it("does not let one failing project reject a Promise.all across several projects", async () => {
    ensureCurrentIterationMock.mockImplementation(async (projectId: string) => {
      if (projectId === "project-broken") {
        throw new Error("finalize_iteration failed");
      }
    });
    const { rolloverIterationSafely } = await import("./rollover");

    const projectIds = ["project-a", "project-broken", "project-b"];
    await expect(
      Promise.all(projectIds.map((id) => rolloverIterationSafely(id))),
    ).resolves.toEqual([undefined, undefined, undefined]);

    expect(ensureCurrentIterationMock).toHaveBeenCalledTimes(3);
  });
});
