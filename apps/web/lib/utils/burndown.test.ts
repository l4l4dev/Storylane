import { describe, expect, it } from "vitest";
import { type BurndownLog, type BurndownStory, buildBurndown } from "./burndown";

const categories = new Map([
  ["Ready", "unstarted"],
  ["Building", "in_progress"],
  ["Shipped", "done"],
]);

const ITERATION = "it-1";

const story = (over: Partial<BurndownStory> & { id: string }): BurndownStory => ({
  points: null,
  storyType: "feature",
  currentCategory: null,
  currentIterationId: ITERATION,
  createdAt: "2026-06-01T00:00:00Z",
  ...over,
});

const stateChange = (storyId: string, at: string, from: string, to: string): BurndownLog => ({
  story_id: storyId,
  action: "story.state_changed",
  created_at: at,
  payload: { from, to },
});

describe("buildBurndown", () => {
  it("replays done-category entries and exits into daily remaining points", () => {
    expect(
      buildBurndown({
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        targetPoints: 10,
        iterationId: ITERATION,
        categoryByStateName: categories,
        stories: [
          story({ id: "a", points: 5, storyType: "feature", currentCategory: "done" }),
          story({ id: "b", points: 3, storyType: "bug", currentCategory: "in_progress" }),
          story({ id: "c", points: null, storyType: "chore", currentCategory: "done" }),
        ],
        logs: [
          stateChange("a", "2026-07-01T10:00:00Z", "Ready", "Building"),
          stateChange("a", "2026-07-02T09:00:00Z", "Building", "Shipped"),
          stateChange("b", "2026-07-02T11:00:00Z", "Building", "Shipped"),
          stateChange("b", "2026-07-03T08:00:00Z", "Shipped", "Building"),
        ],
      }),
    ).toEqual({
      coverage: "full",
      points: [
        { date: "2026-07-01", remaining: 8, ideal: 10 },
        { date: "2026-07-02", remaining: 0, ideal: 5 },
        { date: "2026-07-03", remaining: 3, ideal: 0 },
      ],
    });
  });

  it("returns an empty chart when no state-change history exists", () => {
    expect(
      buildBurndown({
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        targetPoints: 10,
        iterationId: ITERATION,
        categoryByStateName: categories,
        stories: [story({ id: "a", points: 5, currentCategory: "done" })],
        logs: [],
      }),
    ).toEqual({ coverage: "none", points: [] });
  });

  it("returns an empty chart when the available logs belong to other stories", () => {
    expect(
      buildBurndown({
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        targetPoints: 10,
        iterationId: ITERATION,
        categoryByStateName: categories,
        stories: [story({ id: "a", points: 5, currentCategory: "done" })],
        logs: [stateChange("other", "2026-07-02T10:00:00Z", "Building", "Shipped")],
      }),
    ).toEqual({ coverage: "none", points: [] });
  });

  it("keeps usable events and marks coverage partial when a historical state no longer resolves", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-02",
      targetPoints: 4,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [story({ id: "a", points: 4, currentCategory: "done" })],
      logs: [
        stateChange("a", "2026-07-01T10:00:00Z", "Removed state", "Building"),
        stateChange("a", "2026-07-02T10:00:00Z", "Building", "Shipped"),
      ],
    });

    expect(result.coverage).toBe("partial");
    expect(result.points).toEqual([
      { date: "2026-07-01", remaining: 4, ideal: 4 },
      { date: "2026-07-02", remaining: 0, ideal: 0 },
    ]);
  });

  it("steps at the re-estimation date instead of applying the new points to earlier days", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      targetPoints: 8,
      iterationId: ITERATION,
      categoryByStateName: categories,
      // Currently 8 points; it was 3 until day 2.
      stories: [story({ id: "a", points: 8, currentCategory: "in_progress" })],
      logs: [
        stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Building"),
        { story_id: "a", action: "story.points_changed", created_at: "2026-07-02T09:00:00Z", payload: { from: 3, to: 8 } },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([3, 8, 8]);
  });

  it("leaves a finalized iteration's chart unchanged when a story is re-estimated afterwards", () => {
    const logs: BurndownLog[] = [
      stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Building"),
      stateChange("a", "2026-07-02T09:00:00Z", "Building", "Shipped"),
    ];
    const chart = (points: number, extra: BurndownLog[] = []) =>
      buildBurndown({
        startDate: "2026-07-01",
        endDate: "2026-07-03",
        targetPoints: 5,
        iterationId: ITERATION,
        categoryByStateName: categories,
        stories: [story({ id: "a", points, currentCategory: "done" })],
        logs: [...logs, ...extra],
      });

    const before = chart(5);
    // Re-estimated 5 -> 13 a week after the iteration ended.
    const after = chart(13, [
      { story_id: "a", action: "story.points_changed", created_at: "2026-07-10T09:00:00Z", payload: { from: 5, to: 13 } },
    ]);

    expect(after).toEqual(before);
    expect(before.points.map((point) => point.remaining)).toEqual([5, 0, 0]);
  });

  it("scopes a mid-iteration schedule-in to the date it actually entered", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-04",
      targetPoints: 5,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [
        story({ id: "a", points: 2, currentCategory: "in_progress" }),
        // Dragged in from the Backlog on day 3.
        story({ id: "b", points: 5, currentCategory: "in_progress" }),
      ],
      logs: [
        stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Building"),
        stateChange("b", "2026-07-03T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_changed",
          created_at: "2026-07-03T09:00:00Z",
          payload: { from_iteration_id: null, to_iteration_id: ITERATION },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([2, 2, 7, 7]);
  });

  it("stops counting a story from the date it left the iteration", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-04",
      targetPoints: 7,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [
        story({ id: "a", points: 2, currentCategory: "in_progress" }),
        // Pushed back to the Backlog on day 3, so it no longer points here.
        story({ id: "b", points: 5, currentCategory: "unstarted", currentIterationId: null }),
      ],
      logs: [
        stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Building"),
        stateChange("b", "2026-07-01T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_changed",
          created_at: "2026-07-03T09:00:00Z",
          payload: { from_iteration_id: ITERATION, to_iteration_id: null },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([7, 7, 2, 2]);
  });

  // A manual finish clamps end_date to today and reparents in the same
  // transaction, so the rollover log lands ON endDate. Replaying it would zero
  // out everything carried over and show the sprint as fully delivered.
  it("does not burn down carried-over points when the rollover lands on the last day", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      targetPoints: 7,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [
        story({ id: "a", points: 2, currentCategory: "done" }),
        // Unfinished, so the rollover carried it into the next iteration.
        story({ id: "b", points: 5, currentCategory: "in_progress", currentIterationId: "it-2" }),
      ],
      logs: [
        stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Shipped"),
        stateChange("b", "2026-07-01T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_changed",
          created_at: "2026-07-03T17:00:00Z",
          payload: { from_iteration_id: ITERATION, to_iteration_id: "it-2", rollover: "auto" },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([5, 5, 5]);
  });

  // The same rollover log the source iteration must NOT replay is how the
  // destination learns the story arrived, so it has to replay here.
  it("counts work inherited by the iteration the rollover moved it into", () => {
    const result = buildBurndown({
      startDate: "2026-07-04",
      endDate: "2026-07-06",
      targetPoints: 5,
      iterationId: "it-2",
      categoryByStateName: categories,
      stories: [story({ id: "b", points: 5, currentCategory: "in_progress", currentIterationId: "it-2" })],
      logs: [
        stateChange("b", "2026-07-04T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_changed",
          created_at: "2026-07-04T09:00:00Z",
          payload: { from_iteration_id: ITERATION, to_iteration_id: "it-2", rollover: "auto" },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([5, 5, 5]);
  });

  // A neglected project catches up through several iterations in one
  // finalize_iteration call. Every row that call writes carries the same
  // transaction now() and a random uuid, so the hops have NO reliable order —
  // the chart must not depend on which way they arrive.
  it("lands a story in the right iteration when one call rolls it over twice", () => {
    const hops: BurndownLog[] = [
      {
        story_id: "b",
        action: "story.iteration_changed",
        created_at: "2026-07-04T09:00:00Z",
        payload: { from_iteration_id: ITERATION, to_iteration_id: "it-2", rollover: "auto" },
      },
      {
        story_id: "b",
        action: "story.iteration_changed",
        created_at: "2026-07-04T09:00:00Z",
        payload: { from_iteration_id: "it-2", to_iteration_id: "it-3", rollover: "auto" },
      },
    ];
    const chart = (logs: BurndownLog[]) =>
      buildBurndown({
        startDate: "2026-07-04",
        endDate: "2026-07-05",
        targetPoints: 5,
        iterationId: "it-3",
        categoryByStateName: categories,
        stories: [story({ id: "b", points: 5, currentCategory: "in_progress", currentIterationId: "it-3" })],
        logs: [stateChange("b", "2026-07-04T09:00:00Z", "Ready", "Building"), ...logs],
      });

    expect(chart(hops).points.map((point) => point.remaining)).toEqual([5, 5]);
    expect(chart([...hops].reverse()).points.map((point) => point.remaining)).toEqual([5, 5]);
  });

  // ensureCurrentIteration only fires on a page load, so nobody opening the app
  // over a weekend leaves the reparent stamped days into the new iteration. The
  // work was there from day one; the log date is bookkeeping.
  it("counts inherited work from day one when the finalize ran late", () => {
    const result = buildBurndown({
      startDate: "2026-07-04",
      endDate: "2026-07-06",
      targetPoints: 5,
      iterationId: "it-2",
      categoryByStateName: categories,
      stories: [story({ id: "b", points: 5, currentCategory: "in_progress", currentIterationId: "it-2" })],
      logs: [
        stateChange("b", "2026-07-04T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_changed",
          // Two days after the iteration it lands in started.
          created_at: "2026-07-06T09:00:00Z",
          payload: { from_iteration_id: ITERATION, to_iteration_id: "it-2", rollover: "auto" },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([5, 5, 5]);
  });

  // story.iteration_rolled_over predates the rollover marker, but only
  // finalize_iteration ever wrote it — so it gets the same treatment without
  // carrying the flag.
  it("treats the pre-rename rollover action as a rollover", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      targetPoints: 5,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [story({ id: "b", points: 5, currentCategory: "in_progress", currentIterationId: "it-2" })],
      logs: [
        stateChange("b", "2026-07-01T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_rolled_over",
          created_at: "2026-07-03T17:00:00Z",
          payload: { from_iteration_id: ITERATION, to_iteration_id: "it-2" },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([5, 5, 5]);
  });

  it("still burns down a manual drag out on the last day", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      targetPoints: 7,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [
        story({ id: "a", points: 2, currentCategory: "done" }),
        story({ id: "b", points: 5, currentCategory: "in_progress", currentIterationId: null }),
      ],
      logs: [
        stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Shipped"),
        stateChange("b", "2026-07-01T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_changed",
          created_at: "2026-07-03T17:00:00Z",
          payload: { from_iteration_id: ITERATION, to_iteration_id: null, rollover: null },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([5, 5, 0]);
  });

  // A catch-up creates its gap iterations with start_dates already in the past,
  // so the reparent logs are stamped AFTER those iterations ended: in the
  // rewind window, out of the forward one. The clamped arrival is what keeps
  // the gap sprint from reading as empty.
  it("shows carried work in a gap iteration a catch-up passed through", () => {
    const result = buildBurndown({
      startDate: "2026-06-02",
      endDate: "2026-06-04",
      targetPoints: 5,
      iterationId: "it-7",
      categoryByStateName: categories,
      stories: [
        story({
          id: "b",
          points: 5,
          currentCategory: "in_progress",
          currentIterationId: "it-8",
          createdAt: "2026-05-01T00:00:00Z",
        }),
      ],
      logs: [
        stateChange("b", "2026-06-02T09:00:00Z", "Ready", "Building"),
        {
          story_id: "b",
          action: "story.iteration_changed",
          created_at: "2026-07-31T09:00:00Z",
          payload: { from_iteration_id: "it-6", to_iteration_id: "it-7", rollover: "auto" },
        },
        {
          story_id: "b",
          action: "story.iteration_changed",
          created_at: "2026-07-31T09:00:00Z",
          payload: { from_iteration_id: "it-7", to_iteration_id: "it-8", rollover: "auto" },
        },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([5, 5, 5]);
  });

  it("does not count a story before the day it was created", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-04",
      targetPoints: 6,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [
        story({ id: "a", points: 2, currentCategory: "in_progress" }),
        // Created straight into the current iteration on day 3, so it has no
        // iteration_changed log at all to date-scope it.
        story({ id: "b", points: 4, currentCategory: "in_progress", createdAt: "2026-07-03T11:00:00Z" }),
      ],
      logs: [
        stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Building"),
        stateChange("b", "2026-07-03T12:00:00Z", "Ready", "Building"),
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([2, 2, 6, 6]);
  });

  it("keeps a done story at zero when it is re-estimated after finishing", () => {
    const result = buildBurndown({
      startDate: "2026-07-01",
      endDate: "2026-07-03",
      targetPoints: 3,
      iterationId: ITERATION,
      categoryByStateName: categories,
      stories: [story({ id: "a", points: 21, currentCategory: "done" })],
      logs: [
        stateChange("a", "2026-07-01T09:00:00Z", "Ready", "Shipped"),
        { story_id: "a", action: "story.points_changed", created_at: "2026-07-02T09:00:00Z", payload: { from: 3, to: 21 } },
      ],
    });

    expect(result.points.map((point) => point.remaining)).toEqual([0, 0, 0]);
  });
});
