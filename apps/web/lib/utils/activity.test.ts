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

  it("describes a story being promoted to an epic", () => {
    const text = describeActivity({
      action: "story.promoted_to_epic",
      payload: { epic_id: "e1", title: "Big story to split", task_count: 2, new_story_ids: ["s1", "s2"] },
      actorName: "Dev User",
      storyTitle: null,
    });
    expect(text).toBe('Dev User promoted "Big story to split" to an epic with 2 new stories');
  });

  it("uses singular wording for a single-task promotion", () => {
    const text = describeActivity({
      action: "story.promoted_to_epic",
      payload: { epic_id: "e1", title: "Small story", task_count: 1, new_story_ids: ["s1"] },
      actorName: "Dev User",
      storyTitle: null,
    });
    expect(text).toBe('Dev User promoted "Small story" to an epic with 1 new story');
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
