import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { estimationGateBlocks, isAllowedPointValue, nextCompletedAt, pointScaleValues } from "@storylane/core";
import {
  activityLogs,
  projects,
  projectStates,
  stories,
  type StateCategory,
  type StoryType,
} from "../db/schema";
import { loadInProject, reorder, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity } from "./activity";
import { listStates, type StateRow } from "./states";

export interface StoryRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  storyType: StoryType;
  stateId: string | null;
  position: number;
  points: number | null;
  requesterId: string | null;
  assigneeId: string | null;
  completedAt: number | null;
}

export interface BoardColumn {
  stateId: string | null;
  stories: StoryRow[];
}

export interface BoardView {
  states: StateRow[];
  columns: BoardColumn[];
}

const COLUMNS = {
  id: stories.id,
  number: stories.number,
  title: stories.title,
  description: stories.description,
  storyType: stories.storyType,
  stateId: stories.stateId,
  position: stories.position,
  points: stories.points,
  requesterId: stories.requesterId,
  assigneeId: stories.assigneeId,
  completedAt: stories.completedAt,
};

/**
 * Scope for `reorder` and for MAX(position): one column of the board. The Icebox is a column
 * like any other, but `state_id IS NULL` never matches `= NULL`, so it needs `isNull`.
 */
const columnScope = (stateId: string | null): SQL =>
  stateId === null ? isNull(stories.stateId) : eq(stories.stateId, stateId);

/** A ProjectTx can only be issued to a signed-in member, so this is a defense-in-depth check. */
function actorUserId(tx: ProjectTx): string {
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return tx.actor.userId;
}

function allowedPoints(tx: ProjectTx): number[] {
  const project = tx.tx
    .select({ pointScale: projects.pointScale, customPoints: projects.customPoints })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!project) throw new HttpError(404, "not_found");
  return pointScaleValues(project.pointScale, parseCustomPoints(project.customPoints));
}

/** A malformed custom_points row must not 500 the board; an empty scale rejects every value. */
function parseCustomPoints(raw: string | null): number[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

/** null stateId = Icebox, which has no category. Any other id must live in this project. */
function categoryOf(tx: ProjectTx, stateId: string | null): StateCategory | null {
  if (stateId === null) return null;
  return loadInProject(tx, projectStates, stateId).category as StateCategory;
}

/** Hand-written scope rather than loadInProject: this needs the COLUMNS projection, not the
 *  whole row — the `projectId` term is what makes it project-scoped and must stay. */
function readOne(tx: ProjectTx, storyId: string): StoryRow {
  const row = tx.tx
    .select(COLUMNS)
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return row as StoryRow;
}

/**
 * The assignee is enforced by the composite FK (project_id, assignee_id) → project_members,
 * so the only way to learn a non-member was named is to attempt the write. Only wrap writes
 * that actually set a non-null assignee: every other FK on the row was already validated.
 */
function mapAssigneeFk<T>(assigneeId: string | null | undefined, run: () => T): T {
  if (assigneeId === null || assigneeId === undefined) return run();
  try {
    return run();
  } catch (e) {
    if (e instanceof Error && /FOREIGN KEY constraint failed/i.test(e.message)) {
      throw new HttpError(400, "assignee_not_member");
    }
    throw e;
  }
}

export function listStories(tx: ProjectTx): StoryRow[] {
  return tx.tx
    .select(COLUMNS)
    .from(stories)
    .where(eq(stories.projectId, tx.projectId))
    .orderBy(stories.position, stories.number)
    .all() as StoryRow[];
}

export function readBoard(tx: ProjectTx): BoardView {
  const states = listStates(tx);
  const all = listStories(tx);
  // The Icebox column comes first: it is where new stories land (spec/features.md).
  const columns: BoardColumn[] = [
    { stateId: null, stories: [] },
    ...states.map((s) => ({ stateId: s.id, stories: [] as StoryRow[] })),
  ];
  const byState = new Map(columns.map((col) => [col.stateId, col]));
  for (const story of all) byState.get(story.stateId)?.stories.push(story);
  for (const col of columns) col.stories.sort((a, b) => a.position - b.position || a.number - b.number);
  return { states, columns };
}

/** Resolves the target category and refuses the placement the estimation gate forbids. */
function assertPlaceable(
  tx: ProjectTx,
  story: { storyType: StoryType; points: number | null },
  stateId: string | null,
): StateCategory | null {
  const targetCategory = categoryOf(tx, stateId);
  if (estimationGateBlocks({ storyType: story.storyType, points: story.points, targetCategory })) {
    throw new HttpError(409, "estimate_required");
  }
  return targetCategory;
}

export function createStory(
  tx: ProjectTx,
  input: {
    title: string;
    description?: string | null;
    storyType?: StoryType;
    stateId?: string | null;
    points?: number | null;
    assigneeId?: string | null;
  },
): StoryRow {
  const title = input.title.trim();
  if (title.length === 0) throw new HttpError(400, "title_required");
  const storyType = input.storyType ?? "feature";
  const points = input.points ?? null;
  if (!isAllowedPointValue(points, allowedPoints(tx))) throw new HttpError(400, "points_off_scale");
  const stateId = input.stateId ?? null;
  const targetCategory = assertPlaceable(tx, { storyType, points }, stateId);
  const requesterId = actorUserId(tx);
  const now = Date.now();
  // MAX+1 inside this transaction; safe under SQLite's single writer (design §5).
  const nextNumber = tx.tx
    .select({ n: sql<number>`coalesce(max(${stories.number}), 0) + 1` })
    .from(stories)
    .where(eq(stories.projectId, tx.projectId))
    .get();
  const nextPosition = tx.tx
    .select({ p: sql<number>`coalesce(max(${stories.position}), -1) + 1` })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), columnScope(stateId)))
    .get();
  const id = newId();
  const assigneeId = input.assigneeId ?? null;
  mapAssigneeFk(assigneeId, () =>
    tx.tx
      .insert(stories)
      .values({
        id,
        projectId: tx.projectId,
        number: nextNumber?.n ?? 1,
        title,
        description: input.description ?? null,
        storyType,
        stateId,
        position: nextPosition?.p ?? 0,
        points,
        requesterId,
        assigneeId,
        completedAt: nextCompletedAt(targetCategory, null, now),
        createdBy: requesterId,
        createdAt: now,
        updatedAt: now,
      })
      .run(),
  );
  recordActivity(tx, {
    action: "story.created",
    storyId: id,
    payload: { title, stateId, storyType, points, assigneeId },
  });
  return readOne(tx, id);
}

export function updateStory(
  tx: ProjectTx,
  storyId: string,
  patch: {
    title?: string;
    description?: string | null;
    storyType?: StoryType;
    points?: number | null;
    assigneeId?: string | null;
  },
): StoryRow {
  const current = readOne(tx, storyId);
  const storyType = patch.storyType ?? current.storyType;
  const points = patch.points === undefined ? current.points : patch.points;
  if (!isAllowedPointValue(points, allowedPoints(tx))) throw new HttpError(400, "points_off_scale");
  // Removing an estimate must not leave the story parked past the gate.
  assertPlaceable(tx, { storyType, points }, current.stateId);
  const set: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title.length === 0) throw new HttpError(400, "title_required");
    set.title = title;
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.storyType !== undefined) set.storyType = patch.storyType;
  if (patch.points !== undefined) set.points = patch.points;
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  const payload: Record<string, unknown> = { ...set };
  if (patch.points !== undefined) payload.points = { from: current.points, to: patch.points };
  if (patch.assigneeId !== undefined) payload.assigneeId = { from: current.assigneeId, to: patch.assigneeId };
  mapAssigneeFk(patch.assigneeId, () =>
    tx.tx
      .update(stories)
      .set({ ...set, updatedAt: Date.now() } as never)
      .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
      .run(),
  );
  recordActivity(tx, { action: "story.updated", storyId, payload });
  return readOne(tx, storyId);
}

/** The ids of one column, in position order — the input `reorder` expects. */
function columnIds(tx: ProjectTx, stateId: string | null): string[] {
  return tx.tx
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), columnScope(stateId)))
    .orderBy(stories.position, stories.number)
    .all()
    .map((r) => r.id);
}

/**
 * One call does both jobs the board's drag produces: the target state (which decides
 * completed_at) and the new order of the target column. `orderedIds` must be exactly the
 * target column's stories *after* the move, so the client sends what it drew.
 */
export function moveStory(
  tx: ProjectTx,
  storyId: string,
  target: { stateId: string | null; orderedIds: string[] },
): StoryRow {
  const current = readOne(tx, storyId);
  const previousCategory = categoryOf(tx, current.stateId);
  const targetCategory = assertPlaceable(tx, current, target.stateId);
  // completed_at keys on the CATEGORY, so moving between two done states keeps the original
  // stamp (spec/data-model.md `stories.completed_at`); stateChanged is a different question,
  // answering "which activity row" and "which column needs re-densifying".
  const categoryChanged = previousCategory !== targetCategory;
  const stateChanged = current.stateId !== target.stateId;
  const now = Date.now();
  tx.tx
    .update(stories)
    .set({
      stateId: target.stateId,
      completedAt: nextCompletedAt(targetCategory, categoryChanged ? null : current.completedAt, now),
      updatedAt: now,
    })
    .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
    .run();
  reorder(tx, stories, columnScope(target.stateId), target.orderedIds);
  // The column the story left keeps a hole otherwise; positions stay dense 0..n-1.
  if (stateChanged) reorder(tx, stories, columnScope(current.stateId), columnIds(tx, current.stateId));
  recordActivity(tx, {
    action: stateChanged ? "story.state_changed" : "story.moved",
    storyId,
    payload: { from: current.stateId, to: target.stateId, orderedIds: target.orderedIds },
  });
  return readOne(tx, storyId);
}

export function deleteStory(tx: ProjectTx, storyId: string): void {
  const story = readOne(tx, storyId);
  // Keep the trail, lose the pointer: activity_logs.story_id has no FK, but the 0003 trigger
  // rejects an id that no longer names a story in this project.
  tx.tx
    .update(activityLogs)
    .set({ storyId: null })
    .where(and(eq(activityLogs.projectId, tx.projectId), eq(activityLogs.storyId, storyId)))
    .run();
  tx.tx.delete(stories).where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId))).run();
  reorder(tx, stories, columnScope(story.stateId), columnIds(tx, story.stateId));
  // storyId stays null for the same reason: the row it would point at is already gone.
  recordActivity(tx, {
    action: "story.deleted",
    payload: {
      storyId,
      number: story.number,
      title: story.title,
      stateId: story.stateId,
      storyType: story.storyType,
      points: story.points,
    },
  });
}
