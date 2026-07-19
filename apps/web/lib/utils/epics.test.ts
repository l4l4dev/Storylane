import { describe, expect, it } from "vitest";
import { epicProgress } from "./epics";

describe("epicProgress", () => {
  it("counts done-category stories against the total", () => {
    const stories = [
      { category: "done" as const },
      { category: "done" as const },
      { category: "in_progress" as const },
      { category: "unstarted" as const },
    ];
    expect(epicProgress(stories)).toEqual({ accepted: 2, total: 4, percent: 50 });
  });

  it("returns 0 percent for an epic with no stories", () => {
    expect(epicProgress([])).toEqual({ accepted: 0, total: 0, percent: 0 });
  });

  it("returns 100 percent when every story is done", () => {
    const stories = [{ category: "done" as const }, { category: "done" as const }];
    expect(epicProgress(stories)).toEqual({ accepted: 2, total: 2, percent: 100 });
  });

  it("rounds a non-integer percentage", () => {
    const stories = [{ category: "done" as const }, { category: "in_progress" as const }, { category: "in_progress" as const }];
    expect(epicProgress(stories)).toEqual({ accepted: 1, total: 3, percent: 33 });
  });

  it("treats Icebox stories (category null) as not done", () => {
    const stories = [{ category: "done" as const }, { category: null }];
    expect(epicProgress(stories)).toEqual({ accepted: 1, total: 2, percent: 50 });
  });
});
