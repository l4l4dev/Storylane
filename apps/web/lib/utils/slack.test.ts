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

  it("escapes &, <, and > in the new state", () => {
    expect(storyStateChangeMessage({ number: 5, title: "Add login" }, "<Blocked> & Waiting")).toBe(
      '#5 "Add login" is now *&lt;Blocked&gt; &amp; Waiting*',
    );
  });
});

describe("iterationDoneMessage", () => {
  it("reports the point total, the capacity it was earned over, and the rate", () => {
    expect(iterationDoneMessage(3, 8, 10)).toBe(
      "Iteration #3 is done — 8 pts over 10 person-days (0.8 pts/person-day)",
    );
  });

  it("omits the rate for a capacity-0 iteration (a catch-up gap row)", () => {
    expect(iterationDoneMessage(4, 0, 0)).toBe("Iteration #4 is done — 0 pts");
  });
});

describe("iterationStartedMessage", () => {
  it("includes the iteration number and date range", () => {
    expect(iterationStartedMessage(4, "2026-07-07", "2026-07-20")).toBe(
      "Iteration #4 started (2026-07-07 – 2026-07-20)",
    );
  });
});

describe("iterationDoneMessage with no capacity in the payload", () => {
  // parseFinalizeEvents validates only `kind`, so an event emitted by a
  // finalize_iteration older than the capacity snapshot reaches here with
  // the field absent.
  it("falls back to the bare point total", () => {
    expect(iterationDoneMessage(5, 13, undefined)).toBe("Iteration #5 is done — 13 pts");
  });
});
