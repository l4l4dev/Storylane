import { describe, expect, it } from "vitest";
import { buildBurndown } from "./burndown";

const categories = new Map([
  ["Ready", "unstarted"],
  ["Building", "in_progress"],
  ["Shipped", "done"],
]);

describe("buildBurndown", () => {
  it("replays done-category entries and exits into daily remaining points", () => {
    expect(
      buildBurndown({
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        targetPoints: 10,
        categoryByStateName: categories,
        stories: [
          { id: "a", points: 5, storyType: "feature", currentCategory: "done" },
          { id: "b", points: 3, storyType: "bug", currentCategory: "in_progress" },
          { id: "c", points: null, storyType: "chore", currentCategory: "done" },
        ],
        logs: [
          { story_id: "a", created_at: "2026-07-01T10:00:00Z", payload: { from: "Ready", to: "Building" } },
          { story_id: "a", created_at: "2026-07-02T09:00:00Z", payload: { from: "Building", to: "Shipped" } },
          { story_id: "b", created_at: "2026-07-02T11:00:00Z", payload: { from: "Building", to: "Shipped" } },
          { story_id: "b", created_at: "2026-07-03T08:00:00Z", payload: { from: "Shipped", to: "Building" } },
        ],
      }),
    ).toEqual({
      coverage: "full",
      points: [
        { date: "2026-07-01", remaining: 8, ideal: 10 },
        { date: "2026-07-02", remaining: 0, ideal: 5 },
        { date: "2026-07-03", remaining: 3, ideal: 0 },
      ],
    });
  });

  it("returns an empty chart when no state-change history exists", () => {
    expect(
      buildBurndown({
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        targetPoints: 10,
        categoryByStateName: categories,
        stories: [{ id: "a", points: 5, storyType: "feature", currentCategory: "done" }],
        logs: [],
      }),
    ).toEqual({ coverage: "none", points: [] });
  });

  it("returns an empty chart when the available logs belong to other stories", () => {
    expect(
      buildBurndown({
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        targetPoints: 10,
        categoryByStateName: categories,
        stories: [{ id: "a", points: 5, storyType: "feature", currentCategory: "done" }],
        logs: [
          { story_id: "other", created_at: "2026-07-02T10:00:00Z", payload: { from: "Building", to: "Shipped" } },
        ],
      }),
    ).toEqual({ coverage: "none", points: [] });
  });

  it("keeps usable events and marks coverage partial when a historical state no longer resolves", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      targetPoints: 4,
      categoryByStateName: categories,
      stories: [{ id: "a", points: 4, storyType: "feature", currentCategory: "done" }],
      logs: [
        { story_id: "a", created_at: "2026-07-01T10:00:00Z", payload: { from: "Removed state", to: "Building" } },
        { story_id: "a", created_at: "2026-07-02T10:00:00Z", payload: { from: "Building", to: "Shipped" } },
      ],
    });

    expect(result.coverage).toBe("partial");
    expect(result.points).toEqual([
      { date: "2026-07-01", remaining: 4, ideal: 4 },
      { date: "2026-07-02", remaining: 0, ideal: 0 },
    ]);
  });
});
