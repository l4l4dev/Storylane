import { describe, expect, it } from "vitest";
import { groupStoriesByIteration, partitionIcebox, sumPoints } from "./board";

describe("groupStoriesByIteration", () => {
  it("separates backlog stories from iteration-assigned ones", () => {
    const stories = [
      { id: "1", iteration_id: "it-1" },
      { id: "2", iteration_id: null },
      { id: "3", iteration_id: "it-1" },
      { id: "4", iteration_id: "it-2" },
    ];
    const { byIteration, backlog } = groupStoriesByIteration(stories);

    expect(backlog.map((s) => s.id)).toEqual(["2"]);
    expect(byIteration.get("it-1")?.map((s) => s.id)).toEqual(["1", "3"]);
    expect(byIteration.get("it-2")?.map((s) => s.id)).toEqual(["4"]);
  });

  it("returns empty results for an empty input", () => {
    const { byIteration, backlog } = groupStoriesByIteration([]);
    expect(backlog).toEqual([]);
    expect(byIteration.size).toBe(0);
  });

  it("treats every story as backlog when none are assigned", () => {
    const stories = [{ id: "1", iteration_id: null }, { id: "2", iteration_id: null }];
    const { byIteration, backlog } = groupStoriesByIteration(stories);
    expect(backlog.map((s) => s.id)).toEqual(["1", "2"]);
    expect(byIteration.size).toBe(0);
  });
});

describe("partitionIcebox", () => {
  it("splits unscheduled stories from everything else", () => {
    const stories = [
      { id: "1", state: "unscheduled" },
      { id: "2", state: "unstarted" },
      { id: "3", state: "unscheduled" },
      { id: "4", state: "accepted" },
    ];
    const { icebox, rest } = partitionIcebox(stories);
    expect(icebox.map((s) => s.id)).toEqual(["1", "3"]);
    expect(rest.map((s) => s.id)).toEqual(["2", "4"]);
  });

  it("returns empty results for an empty input", () => {
    const { icebox, rest } = partitionIcebox([]);
    expect(icebox).toEqual([]);
    expect(rest).toEqual([]);
  });
});

describe("sumPoints", () => {
  it("sums points for point-bearing story types only", () => {
    const stories = [
      { points: 3, story_type: "feature" },
      { points: 2, story_type: "bug" },
      { points: null, story_type: "chore" },
      { points: null, story_type: "release" },
    ];
    expect(sumPoints(stories)).toBe(5);
  });

  it("returns 0 for an empty list", () => {
    expect(sumPoints([])).toBe(0);
  });
});
