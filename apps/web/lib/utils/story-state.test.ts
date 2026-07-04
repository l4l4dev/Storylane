import { describe, expect, it } from "vitest";
import {
  applyTransition,
  availableTransitions,
  canTransition,
  STORY_STATES,
  transitionLabel,
  type StoryState,
} from "./story-state";

describe("availableTransitions", () => {
  it("offers only Start from unstarted", () => {
    expect(availableTransitions("unstarted")).toEqual(["start"]);
  });

  it("offers only Finish from started", () => {
    expect(availableTransitions("started")).toEqual(["finish"]);
  });

  it("offers only Deliver from finished", () => {
    expect(availableTransitions("finished")).toEqual(["deliver"]);
  });

  it("offers both Accept and Reject from delivered", () => {
    expect(availableTransitions("delivered")).toEqual(["accept", "reject"]);
  });

  it("offers only Restart from rejected", () => {
    expect(availableTransitions("rejected")).toEqual(["restart"]);
  });

  it("offers nothing from accepted (terminal state)", () => {
    expect(availableTransitions("accepted")).toEqual([]);
  });

  it("offers nothing from unscheduled (Icebox promotion is drag-and-drop, not a button)", () => {
    expect(availableTransitions("unscheduled")).toEqual([]);
  });
});

describe("canTransition", () => {
  it("is true for the next valid action", () => {
    expect(canTransition("unstarted", "start")).toBe(true);
    expect(canTransition("delivered", "accept")).toBe(true);
    expect(canTransition("delivered", "reject")).toBe(true);
  });

  it("is false for an out-of-order action", () => {
    expect(canTransition("unstarted", "finish")).toBe(false);
    expect(canTransition("accepted", "restart")).toBe(false);
  });
});

describe("applyTransition", () => {
  it("walks the full unstarted -> accepted happy path", () => {
    let state: StoryState = "unstarted";
    state = applyTransition(state, "start");
    expect(state).toBe("started");
    state = applyTransition(state, "finish");
    expect(state).toBe("finished");
    state = applyTransition(state, "deliver");
    expect(state).toBe("delivered");
    state = applyTransition(state, "accept");
    expect(state).toBe("accepted");
  });

  it("rejects then restarts back to started", () => {
    let state: StoryState = "delivered";
    state = applyTransition(state, "reject");
    expect(state).toBe("rejected");
    state = applyTransition(state, "restart");
    expect(state).toBe("started");
  });

  it("throws on an invalid transition instead of silently jumping state", () => {
    expect(() => applyTransition("unstarted", "deliver")).toThrow(/Cannot "deliver"/);
    expect(() => applyTransition("accepted", "start")).toThrow(/Cannot "start"/);
  });
});

describe("transitionLabel", () => {
  it("returns the button label for each action", () => {
    expect(transitionLabel("start")).toBe("Start");
    expect(transitionLabel("finish")).toBe("Finish");
    expect(transitionLabel("deliver")).toBe("Deliver");
    expect(transitionLabel("accept")).toBe("Accept");
    expect(transitionLabel("reject")).toBe("Reject");
    expect(transitionLabel("restart")).toBe("Restart");
  });
});

describe("STORY_STATES", () => {
  it("matches the DB CHECK constraint order (see spec/data-model.md)", () => {
    expect(STORY_STATES).toEqual([
      "unscheduled",
      "unstarted",
      "started",
      "finished",
      "delivered",
      "accepted",
      "rejected",
    ]);
  });
});
