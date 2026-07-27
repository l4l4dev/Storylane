import { addDays, daysBetween, storyTypeUsesPoints } from "@storylane/core";

export type BurndownStory = {
  id: string;
  points: number | null;
  storyType: string;
  currentCategory: string | null;
};

export type BurndownLog = {
  story_id: string | null;
  created_at: string;
  payload: unknown;
};

export type BurndownPoint = { date: string; remaining: number; ideal: number };

export function buildBurndown(input: {
  startDate: string;
  endDate: string;
  idealEndDate?: string;
  targetPoints: number;
  categoryByStateName: ReadonlyMap<string, string>;
  stories: ReadonlyArray<BurndownStory>;
  logs: ReadonlyArray<BurndownLog>;
}): { coverage: "full" | "partial" | "none"; points: BurndownPoint[] } {
  if (input.logs.length === 0 || input.endDate < input.startDate) {
    return { coverage: "none", points: [] };
  }

  const pointsByStory = new Map(
    input.stories
      .filter((story) => storyTypeUsesPoints(story.storyType))
      .map((story) => [story.id, story.points ?? 0]),
  );
  const categoryByStory = new Map(input.stories.map((story) => [story.id, story.currentCategory]));
  const resolved = input.logs
    .filter((log) => log.story_id !== null && pointsByStory.has(log.story_id) && log.created_at.slice(0, 10) >= input.startDate)
    .map((log) => {
      const payload = (log.payload ?? {}) as Record<string, unknown>;
      // Category resolved at transition time (from_category/to_category) is
      // authoritative — a state's category is immutable per row, so this
      // value can never go stale. Older logs (pre-20260727120000) only have
      // the state NAME; those fall back to the CURRENT name->category map,
      // which is wrong if that name was later reused by a differently
      // categorized state — an accepted gap for pre-migration history only.
      const fromCategory =
        typeof payload.from_category === "string"
          ? payload.from_category
          : typeof payload.from === "string"
            ? input.categoryByStateName.get(payload.from)
            : undefined;
      const toCategory =
        typeof payload.to_category === "string"
          ? payload.to_category
          : typeof payload.to === "string"
            ? input.categoryByStateName.get(payload.to)
            : undefined;
      return {
        storyId: log.story_id as string,
        createdAt: log.created_at,
        fromCategory,
        toCategory,
      };
    });
  const usable = resolved.filter(
    (log): log is typeof log & { fromCategory: string; toCategory: string } =>
      log.fromCategory !== undefined && log.toCategory !== undefined,
  );
  // usable, not resolved: a log row with an unresolvable category (from is
  // "resolved" but neither category could be looked up) contributes zero
  // reconstructed signal. If every row for this iteration fails resolution,
  // the walk below is a no-op and would otherwise report "partial" for a
  // chart carrying no real data at all.
  if (usable.length === 0) {
    return { coverage: "none", points: [] };
  }

  for (const log of [...usable].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    categoryByStory.set(log.storyId, log.fromCategory);
  }

  let donePoints = input.stories.reduce(
    (total, story) => total + (categoryByStory.get(story.id) === "done" ? (pointsByStory.get(story.id) ?? 0) : 0),
    0,
  );
  const totalPoints = [...pointsByStory.values()].reduce((total, points) => total + points, 0);
  const events = usable
    .filter((log) => log.createdAt.slice(0, 10) <= input.endDate)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const idealDays = Math.max(1, daysBetween(input.startDate, input.idealEndDate ?? input.endDate));
  const points: BurndownPoint[] = [];
  let eventIndex = 0;

  for (let date = input.startDate, day = 0; date <= input.endDate; date = addDays(date, 1), day += 1) {
    while (events[eventIndex]?.createdAt.slice(0, 10) === date) {
      const event = events[eventIndex];
      const storyPoints = pointsByStory.get(event.storyId) ?? 0;
      const wasDone = categoryByStory.get(event.storyId) === "done";
      const isDone = event.toCategory === "done";
      if (wasDone !== isDone) donePoints += isDone ? storyPoints : -storyPoints;
      categoryByStory.set(event.storyId, event.toCategory);
      eventIndex += 1;
    }
    points.push({
      date,
      remaining: Math.max(0, totalPoints - donePoints),
      ideal: Math.max(0, input.targetPoints * (1 - day / idealDays)),
    });
  }

  return {
    coverage: resolved.length === usable.length && usable.length > 0 ? "full" : "partial",
    points,
  };
}
