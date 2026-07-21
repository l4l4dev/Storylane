import { describe, expect, it } from "vitest";
import {
  iterationDoneMessage,
  iterationSkippedMessage,
  iterationStartedMessage,
  storyStateChangeMessage,
} from "./slack";

describe("storyStateChangeMessage", () => {
  it("includes the story number, title, and new state", () => {
    expect(storyStateChangeMessage({ number: 12, title: "Add login" }, "started")).toBe(
      '#12 "Add login" is now *started*',
    );
  });

  // TASK-23: Slack's message text uses &, <, > as control chars (mrkdwn
  // links/entities) — an unescaped title containing them renders mangled
  // (or is silently swallowed) in Slack. notifySlack posts this text raw.
  it("escapes &, <, and > in the story title", () => {
    expect(storyStateChangeMessage({ number: 5, title: "Render <UserList> & fix" }, "started")).toBe(
      '#5 "Render &lt;UserList&gt; &amp; fix" is now *started*',
    );
  });

  it("escapes &, <, and > in the new state", () => {
    expect(storyStateChangeMessage({ number: 5, title: "Add login" }, "<Blocked> & Waiting")).toBe(
      '#5 "Add login" is now *&lt;Blocked&gt; &amp; Waiting*',
    );
  });
});

// The messages take an already-composed label (from iterationLabel): "Sprint
// #3" at a multi-day cadence, the plain date at a 1-day one (doc-8 §5). The
// caller builds it; these just wrap it.
describe("iterationDoneMessage", () => {
  it("reports the point total, the capacity it was earned over, and the rate", () => {
    expect(iterationDoneMessage("Iteration #3", 8, 10)).toBe(
      "Iteration #3 is done — 8 pts over 10 person-days (0.8 pts/person-day)",
    );
  });

  it("omits the rate for a capacity-0 iteration (a catch-up gap row)", () => {
    expect(iterationDoneMessage("Iteration #4", 0, 0)).toBe("Iteration #4 is done — 0 pts");
  });
});

describe("iterationSkippedMessage", () => {
  it("reports the skip without describing it as a zero-point completion", () => {
    expect(iterationSkippedMessage("Iteration #4")).toBe("Iteration #4 skipped");
  });
});

describe("the label from a custom term or a 1-day date title", () => {
  it("carries a custom display term through every iteration message", () => {
    expect(iterationSkippedMessage("Sprint #4")).toBe("Sprint #4 skipped");
    expect(iterationDoneMessage("Sprint #3", 8, 10)).toBe(
      "Sprint #3 is done — 8 pts over 10 person-days (0.8 pts/person-day)",
    );
    expect(iterationStartedMessage("Sprint #4", "2026-07-07", "2026-07-07")).toBe(
      "Sprint #4 started (2026-07-07 – 2026-07-07)",
    );
  });

  it("titles a 1-day cadence by date instead of a number", () => {
    expect(iterationDoneMessage("2026/7/24", 3, 1)).toBe(
      "2026/7/24 is done — 3 pts over 1 person-days (3 pts/person-day)",
    );
    expect(iterationStartedMessage("2026/7/24", "2026-07-24", "2026-07-26")).toBe(
      "2026/7/24 started (2026-07-24 – 2026-07-26)",
    );
  });
});

describe("iterationStartedMessage", () => {
  it("includes the label and date range", () => {
    expect(iterationStartedMessage("Iteration #4", "2026-07-07", "2026-07-20")).toBe(
      "Iteration #4 started (2026-07-07 – 2026-07-20)",
    );
  });
});

describe("iterationDoneMessage with no capacity in the payload", () => {
  // parseFinalizeEvents validates only `kind`, so an event emitted by a
  // finalize_iteration older than the capacity snapshot reaches here with
  // the field absent.
  it("falls back to the bare point total", () => {
    expect(iterationDoneMessage("Iteration #5", 13, undefined)).toBe("Iteration #5 is done — 13 pts");
  });
});
