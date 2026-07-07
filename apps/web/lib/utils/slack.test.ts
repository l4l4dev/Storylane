import { describe, expect, it } from "vitest";
import { iterationDoneMessage, iterationStartedMessage, storyStateChangeMessage } from "./slack";

describe("storyStateChangeMessage", () => {
  it("includes the story number, title, and new state", () => {
    expect(storyStateChangeMessage({ number: 12, title: "Add login" }, "started")).toBe(
      '#12 "Add login" is now *started*',
    );
  });
});

describe("iterationDoneMessage", () => {
  it("includes the iteration number and finalized velocity", () => {
    expect(iterationDoneMessage(3, 8)).toBe("Iteration #3 is done — velocity 8 pts");
  });
});

describe("iterationStartedMessage", () => {
  it("includes the iteration number and date range", () => {
    expect(iterationStartedMessage(4, "2026-07-07", "2026-07-20")).toBe(
      "Iteration #4 started (2026-07-07 – 2026-07-20)",
    );
  });
});
