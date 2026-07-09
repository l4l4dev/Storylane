import { describe, expect, it } from "vitest";
import { iterationDoneMessage, iterationStartedMessage, storyStateChangeMessage } from "./slack";

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

  it("escapes &, <, and > in the new state (also used for free-mode custom status names)", () => {
    expect(storyStateChangeMessage({ number: 5, title: "Add login" }, "<Blocked> & Waiting")).toBe(
      '#5 "Add login" is now *&lt;Blocked&gt; &amp; Waiting*',
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
