import { describe, expect, it } from "vitest";
import { evaluateFocusDrop, focusColumnForStory, groupDoneStories } from "./focus";

const CURRENT = "iter-1";
const OTHER = "iter-2";

describe("focusColumnForStory", () => {
  it("returns null for a story outside the current iteration", () => {
    expect(focusColumnForStory({ category: "unstarted", focus: null, iteration_id: OTHER }, CURRENT)).toBeNull();
    expect(focusColumnForStory({ category: "unstarted", focus: null, iteration_id: null }, CURRENT)).toBeNull();
  });

  it("returns null when there is no current iteration at all", () => {
    expect(focusColumnForStory({ category: "unstarted", focus: null, iteration_id: CURRENT }, null)).toBeNull();
  });

  it("buckets an unstarted-category story with no focus into todo", () => {
    expect(focusColumnForStory({ category: "unstarted", focus: null, iteration_id: CURRENT }, CURRENT)).toBe("todo");
  });

  it("buckets an unstarted-category story by its focus value", () => {
    expect(focusColumnForStory({ category: "unstarted", focus: "today", iteration_id: CURRENT }, CURRENT)).toBe(
      "today",
    );
  });

  // TASK-34: 'this_week' was removed from the focus CHECK constraint
  // (20260709000004 -> the follow-up migration), but any stale value from
  // before the migration falls back to todo rather than throwing.
  it("falls back to todo for a stale 'this_week' focus value", () => {
    expect(focusColumnForStory({ category: "unstarted", focus: "this_week", iteration_id: CURRENT }, CURRENT)).toBe(
      "todo",
    );
  });

  it("groups in_progress and rejected categories into in_progress regardless of focus", () => {
    for (const category of ["in_progress", "rejected"] as const) {
      expect(focusColumnForStory({ category, focus: "today", iteration_id: CURRENT }, CURRENT)).toBe("in_progress");
    }
  });

  it("buckets done-category into done", () => {
    expect(focusColumnForStory({ category: "done", focus: null, iteration_id: CURRENT }, CURRENT)).toBe("done");
  });

  it("returns null for Icebox stories (category null)", () => {
    expect(focusColumnForStory({ category: null, focus: null, iteration_id: CURRENT }, CURRENT)).toBeNull();
  });
});

describe("evaluateFocusDrop", () => {
  it("allows moving an unstarted-category story between todo/today", () => {
    expect(evaluateFocusDrop({ category: "unstarted" }, "today")).toEqual({
      ok: true,
      focus: "today",
    });
  });

  it("clears focus when dropped on todo", () => {
    expect(evaluateFocusDrop({ category: "unstarted" }, "todo")).toEqual({
      ok: true,
      focus: null,
    });
  });

  it("rejects a story that has already started", () => {
    expect(evaluateFocusDrop({ category: "in_progress" }, "today")).toEqual({
      ok: false,
      reason: "Only not-yet-started stories can be moved here",
    });
  });
});

describe("groupDoneStories", () => {
  it("labels today's and yesterday's groups, most-recent-first", () => {
    const stories = [
      { id: "a", completedDateKey: "2026-07-07" },
      { id: "b", completedDateKey: "2026-07-09" },
      { id: "c", completedDateKey: "2026-07-08" },
      { id: "d", completedDateKey: "2026-07-09" },
    ];
    expect(groupDoneStories(stories, "2026-07-09")).toEqual([
      { dateKey: "2026-07-09", label: "Today", stories: [stories[1], stories[3]] },
      { dateKey: "2026-07-08", label: "Yesterday", stories: [stories[2]] },
      { dateKey: "2026-07-07", label: "2026/7/7", stories: [stories[0]] },
    ]);
  });

  it("handles a month boundary when computing yesterday", () => {
    const stories = [{ id: "a", completedDateKey: "2026-06-30" }];
    expect(groupDoneStories(stories, "2026-07-01")).toEqual([
      { dateKey: "2026-06-30", label: "Yesterday", stories: [stories[0]] },
    ]);
  });

  it("returns an empty array for no stories", () => {
    expect(groupDoneStories([], "2026-07-09")).toEqual([]);
  });
});
