import { describe, expect, it } from "vitest";
import { findContainer, groupStoriesByIteration, partitionIcebox, storyById, sumPoints } from "./board";

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

describe("findContainer", () => {
  const containers = {
    backlog: [{ id: "1" }, { id: "2" }],
    current: [{ id: "3" }],
    icebox: [] as { id: string }[],
  };

  it("finds the container whose list holds the item", () => {
    expect(findContainer(containers, "2")).toBe("backlog");
    expect(findContainer(containers, "3")).toBe("current");
  });

  it("returns the container id itself when hovering an empty container directly", () => {
    expect(findContainer(containers, "icebox")).toBe("icebox");
  });

  it("returns undefined for an id that matches nothing", () => {
    expect(findContainer(containers, "missing")).toBeUndefined();
  });
});

describe("storyById", () => {
  const containers = {
    backlog: [{ id: "1", title: "a" }],
    current: [{ id: "2", title: "b" }],
  };

  it("finds an item across every container", () => {
    expect(storyById(containers, "2")).toEqual({ id: "2", title: "b" });
  });

  it("returns undefined when no container has the id", () => {
    expect(storyById(containers, "missing")).toBeUndefined();
  });
});
