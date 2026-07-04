import { describe, expect, it } from "vitest";
import { describeActivity } from "./activity";

describe("describeActivity", () => {
  it("describes story creation", () => {
    const text = describeActivity({
      action: "story.created",
      payload: { title: "Add welcome tour" },
      actorName: "Dev User",
      storyTitle: "Add welcome tour",
    });
    expect(text).toBe('Dev User created "Add welcome tour"');
  });

  it("describes a state change with from/to", () => {
    const text = describeActivity({
      action: "story.state_changed",
      payload: { from: "unstarted", to: "started" },
      actorName: "Dev User",
      storyTitle: "Add welcome tour",
    });
    expect(text).toBe('Dev User moved "Add welcome tour" from unstarted to started');
  });

  it("describes a comment being added", () => {
    const text = describeActivity({
      action: "comment.added",
      payload: {},
      actorName: "Dev User",
      storyTitle: "Add welcome tour",
    });
    expect(text).toBe('Dev User commented on "Add welcome tour"');
  });

  it("falls back to a generic description for unknown actions", () => {
    const text = describeActivity({
      action: "project.renamed",
      payload: {},
      actorName: "Dev User",
      storyTitle: null,
    });
    expect(text).toBe("Dev User performed project.renamed");
  });
});
