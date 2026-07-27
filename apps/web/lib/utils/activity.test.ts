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


  it("renders a null column as 'no column' in a column change", () => {
    const text = describeActivity({
      action: "story.column_changed",
      payload: { from: null, to: "Doing" },
      actorName: "Dev User",
      storyTitle: null,
    });
    expect(text).toBe('Dev User moved a story from no column to "Doing"');
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

  it("describes a story being split into children", () => {
    const text = describeActivity({
      action: "story.split",
      payload: { child_ids: ["s1", "s2"], child_count: 2 },
      actorName: "Dev User",
      storyTitle: "Big story to split",
    });
    expect(text).toBe('Dev User split "Big story to split" into 2 stories');
  });

  it("uses singular wording for a single-child split", () => {
    const text = describeActivity({
      action: "story.split",
      payload: { child_ids: ["s1"], child_count: 1 },
      actorName: "Dev User",
      storyTitle: "Small story",
    });
    expect(text).toBe('Dev User split "Small story" into 1 story');
  });

  it("describes a story becoming a container", () => {
    const text = describeActivity({
      action: "story.containerized",
      payload: { old_points: 5 },
      actorName: "Dev User",
      storyTitle: "Grew too big",
    });
    expect(text).toBe('Dev User turned "Grew too big" into an epic');
  });

  it("describes a story moved out to another project", () => {
    const text = describeActivity({
      action: "story.moved_out",
      payload: { target_project_id: "p2", title: "Fix login bug" },
      actorName: "Dev User",
      storyTitle: null,
    });
    expect(text).toBe('Dev User moved "Fix login bug" to another project');
  });

  it("describes a story moved in from another project", () => {
    const text = describeActivity({
      action: "story.moved_in",
      payload: { source_project_id: "p1", title: "Fix login bug" },
      actorName: "Dev User",
      storyTitle: "Fix login bug",
    });
    expect(text).toBe('Dev User moved "Fix login bug" here from another project');
  });

  it("describes a story copied in from another project", () => {
    const text = describeActivity({
      action: "story.copied_in",
      payload: { source_project_id: "p1", source_story_id: "s1", title: "Fix login bug" },
      actorName: "Dev User",
      storyTitle: "Fix login bug",
    });
    expect(text).toBe('Dev User copied "Fix login bug" here from another project');
  });

  it("describes an iteration reschedule by number", () => {
    const text = describeActivity({
      action: "story.iteration_changed",
      payload: { from_iteration_number: 3, to_iteration_number: 4 },
      actorName: "Dev User",
      storyTitle: "Add welcome tour",
    });
    expect(text).toBe('Dev User moved "Add welcome tour" from iteration #3 to #4');
  });

  it("names the Icebox when either end of an iteration change is null", () => {
    const toIcebox = describeActivity({
      action: "story.iteration_changed",
      payload: { from_iteration_number: 2, to_iteration_number: null },
      actorName: "Dev User",
      storyTitle: "Add welcome tour",
    });
    expect(toIcebox).toBe('Dev User moved "Add welcome tour" from iteration #2 to the Icebox');

    const fromIcebox = describeActivity({
      action: "story.iteration_changed",
      payload: { from_iteration_number: null, to_iteration_number: 5 },
      actorName: "Dev User",
      storyTitle: "Add welcome tour",
    });
    expect(fromIcebox).toBe('Dev User moved "Add welcome tour" from iteration the Icebox to #5');
  });

  // story.iteration_rolled_over: the pre-rename action name
  // (20260727120000, superseded by 20260727140000) — same payload shape,
  // must format identically so already-deployed rows stay readable.
  it("formats the pre-rename action name identically to the current one", () => {
    const text = describeActivity({
      action: "story.iteration_rolled_over",
      payload: { from_iteration_number: 3, to_iteration_number: 4 },
      actorName: "Dev User",
      storyTitle: "Add welcome tour",
    });
    expect(text).toBe('Dev User moved "Add welcome tour" from iteration #3 to #4');
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

describe("project.cadence_changed", () => {
  it("reads as a cadence change, not a raw action name", () => {
    expect(
      describeActivity({
        action: "project.cadence_changed",
        payload: { from: 14, to: 7 },
        actorName: "Rin",
        storyTitle: null,
      }),
    ).toBe("Rin changed the iteration length from 14 to 7 days");
  });
});

describe("iteration.length_overridden", () => {
  it("names the sprint and both end dates", () => {
    expect(
      describeActivity({
        action: "iteration.length_overridden",
        payload: { number: 7, from: "2026-07-17", to: "2026-07-24" },
        actorName: "Rin",
        storyTitle: null,
      }),
    ).toBe("Rin moved iteration #7's end date from 2026/7/17 to 2026/7/24");
  });
});

describe("iteration.reshaped", () => {
  it("names the sprint and its new end date", () => {
    expect(
      describeActivity({
        action: "iteration.reshaped",
        payload: { number: 3, from: "2026-07-27", to: "2026-07-21", length: 1 },
        actorName: "Rin",
        storyTitle: null,
      }),
    ).toBe("Rin reshaped iteration #3 to the new cadence (ends 2026/7/21)");
  });
});
