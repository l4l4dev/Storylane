import { describe, expect, it } from "vitest";
import { epicProgress } from "./epics";

describe("epicProgress", () => {
  it("counts accepted stories against the total", () => {
    const stories = [
      { state: "accepted" },
      { state: "accepted" },
      { state: "started" },
      { state: "unstarted" },
    ];
    expect(epicProgress(stories)).toEqual({ accepted: 2, total: 4, percent: 50 });
  });

  it("returns 0 percent for an epic with no stories", () => {
    expect(epicProgress([])).toEqual({ accepted: 0, total: 0, percent: 0 });
  });

  it("returns 100 percent when every story is accepted", () => {
    const stories = [{ state: "accepted" }, { state: "accepted" }];
    expect(epicProgress(stories)).toEqual({ accepted: 2, total: 2, percent: 100 });
  });

  it("rounds a non-integer percentage", () => {
    const stories = [{ state: "accepted" }, { state: "started" }, { state: "started" }];
    expect(epicProgress(stories)).toEqual({ accepted: 1, total: 3, percent: 33 });
  });
});
