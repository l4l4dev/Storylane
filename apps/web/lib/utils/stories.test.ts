import { describe, expect, it } from "vitest";
import {
  filterStories,
  nextPosition,
  parsePoints,
  reorderPositions,
  storyTypeUsesPoints,
} from "./stories";

describe("storyTypeUsesPoints", () => {
  it("returns true for feature and bug", () => {
    expect(storyTypeUsesPoints("feature")).toBe(true);
    expect(storyTypeUsesPoints("bug")).toBe(true);
  });

  it("returns false for chore and release", () => {
    expect(storyTypeUsesPoints("chore")).toBe(false);
    expect(storyTypeUsesPoints("release")).toBe(false);
  });
});

describe("nextPosition", () => {
  it("returns 0 for an empty backlog", () => {
    expect(nextPosition([])).toBe(0);
  });

  it("returns one past the max position", () => {
    expect(nextPosition([{ position: 0 }, { position: 4 }, { position: 2 }])).toBe(5);
  });
});

describe("reorderPositions", () => {
  it("maps ids to dense zero-based positions", () => {
    expect(reorderPositions(["c", "a", "b"])).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("returns an empty array for no ids", () => {
    expect(reorderPositions([])).toEqual([]);
  });
});

describe("filterStories", () => {
  const stories = [
    { id: "1", story_type: "feature", assignee_id: "u1", labelIds: ["l1"] },
    { id: "2", story_type: "bug", assignee_id: "u2", labelIds: ["l2", "l1"] },
    { id: "3", story_type: "chore", assignee_id: null, labelIds: [] },
  ];

  it("returns everything when no filter is set", () => {
    expect(filterStories(stories, {}).map((s) => s.id)).toEqual(["1", "2", "3"]);
  });

  it("filters by type", () => {
    expect(filterStories(stories, { type: "bug" }).map((s) => s.id)).toEqual(["2"]);
  });

  it("filters by assignee", () => {
    expect(filterStories(stories, { assigneeId: "u1" }).map((s) => s.id)).toEqual(["1"]);
  });

  it("filters by label across multi-label stories", () => {
    expect(filterStories(stories, { labelId: "l1" }).map((s) => s.id)).toEqual(["1", "2"]);
  });

  it("combines criteria with AND", () => {
    expect(filterStories(stories, { type: "bug", labelId: "l1" }).map((s) => s.id)).toEqual(["2"]);
  });

  it("treats empty-string criteria as no filter", () => {
    expect(filterStories(stories, { type: "", assigneeId: "", labelId: "" })).toHaveLength(3);
  });
});

describe("parsePoints", () => {
  it("returns null for non-point story types", () => {
    expect(parsePoints("5", "chore")).toBeNull();
    expect(parsePoints("3", "release")).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(parsePoints("", "feature")).toBeNull();
    expect(parsePoints("   ", "feature")).toBeNull();
    expect(parsePoints(null, "feature")).toBeNull();
  });

  it("parses a valid integer", () => {
    expect(parsePoints("8", "feature")).toBe(8);
  });

  it("floors fractional values", () => {
    expect(parsePoints("2.9", "bug")).toBe(2);
  });

  it("rejects negatives and non-numbers", () => {
    expect(parsePoints("-1", "feature")).toBeNull();
    expect(parsePoints("abc", "feature")).toBeNull();
  });
});
