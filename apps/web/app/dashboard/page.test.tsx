import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureCurrentIterationMock = vi.fn();

vi.mock("@/app/projects/[id]/board/actions", () => ({
  ensureCurrentIteration: ensureCurrentIterationMock,
}));

beforeEach(() => {
  ensureCurrentIterationMock.mockReset();
});

// This page is a Server Component (async function returning JSX from a
// database-backed fetch), so rendering it end-to-end would need a much
// heavier test harness (mocked Supabase query builder for every `.from()`
// call, a React server-rendering shim, etc.). Instead we test the extracted
// `rolloverIterationSafely` helper directly — the exact unit the review
// finding is about — which is enough to prove one project's rollover
// failure can no longer reject the batched `Promise.all` in the page.
// TASK-8 fable-advisor finding: /dashboard was rolling over every tracker
// project on every load, including archived ones — creating a new empty
// iteration in an archived project each time anyone viewed the page. Same
// test-scope tradeoff as rolloverIterationSafely above: test the extracted
// predicate directly rather than the whole Server Component.
describe("projectsNeedingRollover", () => {
  it("excludes archived tracker projects", async () => {
    const { projectsNeedingRollover } = await import("./page");
    const projects = [
      { id: "active", workflow_mode: "tracker", archived_at: null },
      { id: "archived", workflow_mode: "tracker", archived_at: "2026-07-10T00:00:00.000Z" },
    ];

    expect(projectsNeedingRollover(projects).map((p) => p.id)).toEqual(["active"]);
  });
});

describe("rolloverIterationSafely", () => {
  it("resolves even when ensureCurrentIteration throws", async () => {
    ensureCurrentIterationMock.mockRejectedValueOnce(new Error("finalize_iteration failed"));
    const { rolloverIterationSafely } = await import("./page");

    await expect(rolloverIterationSafely("project-broken")).resolves.toBeUndefined();
  });

  it("does not let one failing project reject a Promise.all across several projects", async () => {
    ensureCurrentIterationMock.mockImplementation(async (projectId: string) => {
      if (projectId === "project-broken") {
        throw new Error("finalize_iteration failed");
      }
    });
    const { rolloverIterationSafely } = await import("./page");

    const projectIds = ["project-a", "project-broken", "project-b"];
    await expect(
      Promise.all(projectIds.map((id) => rolloverIterationSafely(id))),
    ).resolves.toEqual([undefined, undefined, undefined]);

    expect(ensureCurrentIterationMock).toHaveBeenCalledTimes(3);
  });
});
