import { describe, expect, it } from "vitest";
import { filterStories, formatPoints, isUnestimatedFeature, parsePoints } from "./stories";

describe("filterStories", () => {
  const stories = [
    { id: "1", story_type: "feature", assignee_id: "u1", labelIds: ["l1"], epic_id: "e1" },
    { id: "2", story_type: "bug", assignee_id: "u2", labelIds: ["l2", "l1"], epic_id: null },
    { id: "3", story_type: "chore", assignee_id: null, labelIds: [], epic_id: "e2" },
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

  it("filters by epic", () => {
    expect(filterStories(stories, { epicId: "e1" }).map((s) => s.id)).toEqual(["1"]);
  });

  it("combines criteria with AND", () => {
    expect(filterStories(stories, { type: "bug", labelId: "l1" }).map((s) => s.id)).toEqual(["2"]);
  });

  it("treats empty-string criteria as no filter", () => {
    expect(filterStories(stories, { type: "", assigneeId: "", labelId: "", epicId: "" })).toHaveLength(3);
  });
});

describe("formatPoints", () => {
  it("renders 1-3 points as dots", () => {
    expect(formatPoints(1)).toBe("•");
    expect(formatPoints(2)).toBe("••");
    expect(formatPoints(3)).toBe("•••");
  });

  it("renders 0 and 4+ as numerals", () => {
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(4)).toBe("4");
    expect(formatPoints(13)).toBe("13");
  });
});

describe("parsePoints", () => {
  const fibonacci = [0, 1, 2, 3, 5, 8, 13];

  it("returns null for non-point story types", () => {
    expect(parsePoints("5", "chore", fibonacci)).toBeNull();
    expect(parsePoints("3", "release", fibonacci)).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(parsePoints("", "feature", fibonacci)).toBeNull();
    expect(parsePoints("   ", "feature", fibonacci)).toBeNull();
    expect(parsePoints(null, "feature", fibonacci)).toBeNull();
  });

  it("parses a value on the scale", () => {
    expect(parsePoints("8", "feature", fibonacci)).toBe(8);
    expect(parsePoints("0", "bug", fibonacci)).toBe(0);
  });

  it("rejects values not on the scale", () => {
    expect(parsePoints("4", "feature", fibonacci)).toBeNull();
    expect(parsePoints("2.9", "bug", fibonacci)).toBeNull();
    expect(parsePoints("5", "feature", [0, 1, 2, 3])).toBeNull();
  });

  it("rejects negatives and non-numbers", () => {
    expect(parsePoints("-1", "feature", fibonacci)).toBeNull();
    expect(parsePoints("abc", "feature", fibonacci)).toBeNull();
  });
});

describe("isUnestimatedFeature", () => {
  it("is true for a feature without points", () => {
    expect(isUnestimatedFeature("feature", null)).toBe(true);
  });

  it("is false for an estimated feature (including 0 points)", () => {
    expect(isUnestimatedFeature("feature", 3)).toBe(false);
    expect(isUnestimatedFeature("feature", 0)).toBe(false);
  });

  it("is false for non-feature types even without points", () => {
    expect(isUnestimatedFeature("bug", null)).toBe(false);
    expect(isUnestimatedFeature("chore", null)).toBe(false);
    expect(isUnestimatedFeature("release", null)).toBe(false);
  });
});
