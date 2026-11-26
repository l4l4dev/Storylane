import { describe, expect, it } from "vitest";
import { estimationGateBlocks, isEstimable, isValidTransition, listForState, statesFor } from "./story";

describe("statesFor", () => {
  it("drops started for a release and finished for a chore", () => {
    expect(statesFor("release")).toEqual(["unscheduled", "unstarted", "planned", "finished", "accepted"]);
    expect(statesFor("chore")).toEqual(["unscheduled", "unstarted", "planned", "started", "accepted"]);
    expect(statesFor("feature")).toHaveLength(8);
  });
});

describe("isValidTransition", () => {
  it("walks a feature through the full cycle", () => {
    expect(isValidTransition("feature", "unscheduled", "unstarted")).toBe(true);
    expect(isValidTransition("feature", "unstarted", "started")).toBe(true);
    expect(isValidTransition("feature", "started", "finished")).toBe(true);
    expect(isValidTransition("feature", "finished", "delivered")).toBe(true);
    expect(isValidTransition("feature", "delivered", "accepted")).toBe(true);
    expect(isValidTransition("feature", "delivered", "rejected")).toBe(true);
    expect(isValidTransition("feature", "rejected", "started")).toBe(true);
  });

  it("accepts a chore straight from started", () => {
    expect(isValidTransition("chore", "started", "accepted")).toBe(true);
    expect(isValidTransition("chore", "started", "finished")).toBe(false);
  });

  it("finishes a release without starting it, and never delivers it", () => {
    expect(isValidTransition("release", "unstarted", "finished")).toBe(true);
    expect(isValidTransition("release", "unstarted", "started")).toBe(false);
    expect(isValidTransition("release", "finished", "delivered")).toBe(false);
    expect(isValidTransition("release", "finished", "accepted")).toBe(true);
  });

  it("re-opens an accepted story to unstarted and refuses a jump", () => {
    expect(isValidTransition("feature", "accepted", "unstarted")).toBe(true);
    expect(isValidTransition("release", "accepted", "unstarted")).toBe(true);
    expect(isValidTransition("feature", "accepted", "started")).toBe(false);
    expect(isValidTransition("feature", "unstarted", "delivered")).toBe(false);
  });
});

describe("isEstimable / estimationGateBlocks", () => {
  it("estimates features always and bugs and chores only when the project says so", () => {
    expect(isEstimable("feature", false)).toBe(true);
    expect(isEstimable("bug", false)).toBe(false);
    expect(isEstimable("bug", true)).toBe(true);
    expect(isEstimable("release", true)).toBe(false);
  });

  it("blocks an unestimated estimable story from started and beyond", () => {
    const base = { estimate: null, bugsAndChoresAreEstimatable: false } as const;
    expect(estimationGateBlocks({ ...base, storyType: "feature", targetState: "started" })).toBe(true);
    expect(estimationGateBlocks({ ...base, storyType: "feature", targetState: "unstarted" })).toBe(false);
    expect(estimationGateBlocks({ ...base, storyType: "chore", targetState: "started" })).toBe(false);
    expect(estimationGateBlocks({ ...base, storyType: "chore", targetState: "started", bugsAndChoresAreEstimatable: true })).toBe(true);
    expect(estimationGateBlocks({ estimate: 3, bugsAndChoresAreEstimatable: false, storyType: "feature", targetState: "started" })).toBe(false);
  });
});

describe("listForState", () => {
  it("maps unscheduled to the icebox and everything else to the backlog list", () => {
    expect(listForState("unscheduled")).toBe("icebox");
    for (const state of ["unstarted", "planned", "started", "finished", "delivered", "accepted", "rejected"] as const) {
      expect(listForState(state)).toBe("backlog");
    }
  });
});
