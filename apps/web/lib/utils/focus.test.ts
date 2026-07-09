import { describe, expect, it } from "vitest";
import { evaluateFocusDrop, focusColumnForStory, groupDoneStories } from "./focus";

const CURRENT = "iter-1";
const OTHER = "iter-2";

describe("focusColumnForStory", () => {
  it("returns null for a story outside the current iteration", () => {
    expect(focusColumnForStory({ state: "unstarted", focus: null, iteration_id: OTHER }, CURRENT)).toBeNull();
    expect(focusColumnForStory({ state: "unstarted", focus: null, iteration_id: null }, CURRENT)).toBeNull();
  });

  it("returns null when there is no current iteration at all", () => {
    expect(focusColumnForStory({ state: "unstarted", focus: null, iteration_id: CURRENT }, null)).toBeNull();
  });

  it("buckets an unstarted story with no focus into todo", () => {
    expect(focusColumnForStory({ state: "unstarted", focus: null, iteration_id: CURRENT }, CURRENT)).toBe("todo");
  });

  it("buckets an unstarted story by its focus value", () => {
    expect(focusColumnForStory({ state: "unstarted", focus: "this_week", iteration_id: CURRENT }, CURRENT)).toBe(
      "this_week",
    );
    expect(focusColumnForStory({ state: "unstarted", focus: "today", iteration_id: CURRENT }, CURRENT)).toBe(
      "today",
    );
  });

  it("groups started/finished/delivered/rejected into in_progress regardless of focus", () => {
    for (const state of ["started", "finished", "delivered", "rejected"]) {
      expect(focusColumnForStory({ state, focus: "today", iteration_id: CURRENT }, CURRENT)).toBe("in_progress");
    }
  });

  it("buckets accepted into done", () => {
    expect(focusColumnForStory({ state: "accepted", focus: null, iteration_id: CURRENT }, CURRENT)).toBe("done");
  });

  it("returns null for unscheduled (Icebox) stories", () => {
    expect(focusColumnForStory({ state: "unscheduled", focus: null, iteration_id: CURRENT }, CURRENT)).toBeNull();
  });
});

describe("evaluateFocusDrop", () => {
  it("allows moving an unstarted story between todo/this_week/today", () => {
    expect(evaluateFocusDrop({ state: "unstarted" }, "today")).toEqual({
      ok: true,
      focus: "today",
    });
    expect(evaluateFocusDrop({ state: "unstarted" }, "this_week")).toEqual({
      ok: true,
      focus: "this_week",
    });
  });

  it("clears focus when dropped on todo", () => {
    expect(evaluateFocusDrop({ state: "unstarted" }, "todo")).toEqual({
      ok: true,
      focus: null,
    });
  });

  it("rejects a story that has already started", () => {
    expect(evaluateFocusDrop({ state: "started" }, "today")).toEqual({
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
      { dateKey: "2026-07-07", label: "2026-07-07", stories: [stories[0]] },
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
