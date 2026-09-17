import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { DEFAULT_POINT_SCALE, iterationOverrides, projectMembers, projects, stories } from "../db/schema";
import { isCustomPointScale, nearestOnScale, parsePointScale } from "@storylane/core";
import { assertNoOpenTransaction, type Actor, type ProjectTx } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { bootstrapScope, recordActivity } from "./activity";

const DEFAULT_WEEK_START_DAY = 1;

/**
 * The most recent `weekStartDay` on or before `now`, expressed as the YYYY-MM-DD the
 * projects_start_date_matches_week_start trigger expects, computed in `zone`. Tracker itself
 * leaves the start date blank and derives it from the first accepted story's iteration
 * (core-model §2.3.2); we store a date because the calendar trigger needs one, and an earlier
 * accepted_at still wins once stories exist.
 */
function mostRecentWeekStart(now: number, weekStartDay: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const dateStr = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${
    parts.find((p) => p.type === "day")!.value
  }`;
  const weekdayName = parts.find((p) => p.type === "weekday")!.value;
  const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const isoWeekday = WEEKDAYS[weekdayName]!;
  const back = (isoWeekday - weekStartDay + 7) % 7;
  if (back === 0) return dateStr;
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const asUtcMidnight = Date.UTC(y, m - 1, d);
  const shifted = new Date(asUtcMidnight - back * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(
    shifted.getUTCDate(),
  ).padStart(2, "0")}`;
}

export interface ProjectSettings {
  id: string;
  name: string;
  description: string | null;
  role: MemberRole;
  archivedAt: number | null;
  point_scale: string;
  point_scale_is_custom: boolean;
  bugs_and_chores_are_estimatable: boolean;
  iteration_length: number;
  week_start_day: number;
  start_date: string;
  time_zone: string;
  velocity_averaged_over: number;
  initial_velocity: number;
  number_of_done_iterations_to_show: number;
  automatic_planning: boolean;
  enable_tasks: boolean;
  show_story_priority: boolean;
  version: number;
  current_iteration_number: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  archivedAt: number | null;
  role: MemberRole;
}

export interface ProjectSettingsPatch {
  name?: string;
  description?: string | null;
  point_scale?: string;
  bugs_and_chores_are_estimatable?: boolean;
  iteration_length?: number;
  week_start_day?: number;
  start_date?: string;
  time_zone?: string;
  velocity_averaged_over?: number;
  initial_velocity?: number;
  number_of_done_iterations_to_show?: number;
  automatic_planning?: boolean;
  enable_tasks?: boolean;
  show_story_priority?: boolean;
}

/**
 * Not project-scoped: there is no project to authorize against yet, so this opens its own
 * immediate transaction and writes its activity rows through bootstrapScope. Any signed-in
 * user may create a project (`"self"` rule in the route manifest).
 *
 * Same rule as revokeUserSessions/changePassword: bun:sqlite has no savepoints here, so call
 * this at the top level, never inside a withProject callback.
 */
export function createProject(
  db: Db,
  actor: Actor,
  input: { name: string; timeZone?: string; startDate?: string },
): ProjectSettings {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  if (input.name.trim().length === 0) throw new HttpError(400, "name_required");
  assertNoOpenTransaction("createProject");
  const now = Date.now();
  const id = newId();
  const timeZone = input.timeZone ?? "UTC";
  const startDate = input.startDate ?? mostRecentWeekStart(now, DEFAULT_WEEK_START_DAY, timeZone);
  const name = input.name.trim();
  return db.transaction(
    (tx) => {
      tx
        .insert(projects)
        .values({
          id,
          name,
          startDate,
          timeZone,
          createdBy: actor.userId,
          createdAt: now,
        })
        .run();
      tx.insert(projectMembers).values({ projectId: id, userId: actor.userId, role: "owner", joinedAt: now }).run();
      recordActivity(bootstrapScope(tx, id, actor), {
        kind: "project_update_activity",
        message: `added the project ${name}`,
        highlight: "created",
        changes: [{ kind: "project", id, change_type: "create", new_values: { name } }],
        primaryResources: [{ kind: "project", id }],
      });
      return {
        id,
        name,
        description: null,
        role: "owner" as MemberRole,
        archivedAt: null,
        point_scale: DEFAULT_POINT_SCALE,
        point_scale_is_custom: false,
        bugs_and_chores_are_estimatable: false,
        iteration_length: 1,
        week_start_day: DEFAULT_WEEK_START_DAY,
        start_date: startDate,
        time_zone: timeZone,
        velocity_averaged_over: 3,
        initial_velocity: 10,
        number_of_done_iterations_to_show: 4,
        automatic_planning: true,
        enable_tasks: true,
        show_story_priority: false,
        version: 0,
        current_iteration_number: 1,
      };
    },
    { behavior: "immediate" },
  );
}

/**
 * Archived projects come last (spec/ux-principles.md principle 9 — never interleaved); within
 * each group, alphabetical by name reads better than creation order, case-insensitively so
 * "bravo" and "Alpha" don't split by case; createdAt only breaks a tie between equal names.
 */
export function listProjects(db: Db, actor: Actor): ProjectSummary[] {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return db
    .select({
      id: projects.id,
      name: projects.name,
      archivedAt: projects.archivedAt,
      role: projectMembers.role,
    })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)))
    .orderBy(
      sql`(${projects.archivedAt} is not null)`,
      sql`${projects.name} collate nocase`,
      projects.createdAt,
    )
    .all() as ProjectSummary[];
}

export function readProject(tx: ProjectTx): ProjectSettings {
  const row = tx.tx
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      archivedAt: projects.archivedAt,
      pointScale: projects.pointScale,
      bugsAndChoresAreEstimatable: projects.bugsAndChoresAreEstimatable,
      iterationLength: projects.iterationLength,
      weekStartDay: projects.weekStartDay,
      startDate: projects.startDate,
      timeZone: projects.timeZone,
      velocityAveragedOver: projects.velocityAveragedOver,
      initialVelocity: projects.initialVelocity,
      numberOfDoneIterationsToShow: projects.numberOfDoneIterationsToShow,
      automaticPlanning: projects.automaticPlanning,
      enableTasks: projects.enableTasks,
      showStoryPriority: projects.showStoryPriority,
      version: projects.version,
    })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    role: tx.role,
    archivedAt: row.archivedAt,
    point_scale: row.pointScale,
    point_scale_is_custom: isCustomPointScale(row.pointScale),
    bugs_and_chores_are_estimatable: row.bugsAndChoresAreEstimatable,
    iteration_length: row.iterationLength,
    week_start_day: row.weekStartDay,
    start_date: row.startDate,
    time_zone: row.timeZone,
    velocity_averaged_over: row.velocityAveragedOver,
    initial_velocity: row.initialVelocity,
    number_of_done_iterations_to_show: row.numberOfDoneIterationsToShow,
    automatic_planning: row.automaticPlanning,
    enable_tasks: row.enableTasks,
    show_story_priority: row.showStoryPriority,
    version: row.version,
    // Task 20 replaces this literal with currentIterationNumber(tx) once the calendar service
    // exists (this is the plan's only forward reference).
    current_iteration_number: 1,
  };
}

function assertKnownTimeZone(zone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new HttpError(400, "time_zone_invalid");
  }
}

/** Maps a CHECK/trigger ABORT message to the field-specific 400 code the route promised. */
function asFieldError(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (/iteration_length/.test(message)) throw new HttpError(400, "iteration_length_invalid");
  if (/start_date_matches_week_start|start_date/.test(message)) throw new HttpError(400, "start_date_invalid");
  if (/week_start_day/.test(message)) throw new HttpError(400, "week_start_day_invalid");
  if (/velocity_averaged_over/.test(message)) throw new HttpError(400, "velocity_averaged_over_invalid");
  if (/done_iterations_shown|number_of_done_iterations_to_show/.test(message)) {
    throw new HttpError(400, "number_of_done_iterations_to_show_invalid");
  }
  if (/initial_velocity/.test(message)) throw new HttpError(400, "initial_velocity_invalid");
  throw e;
}

export function updateProject(tx: ProjectTx, patch: ProjectSettingsPatch): ProjectSettings {
  const current = readProject(tx);
  const set: Record<string, unknown> = {};
  const original: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};

  const setField = <K extends keyof ProjectSettingsPatch>(
    key: K,
    column: string,
    currentValue: unknown,
  ): void => {
    const value = patch[key];
    if (value === undefined || value === currentValue) return;
    set[column] = value;
    original[key as string] = currentValue;
    next[key as string] = value;
  };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length === 0) throw new HttpError(400, "name_required");
    if (name !== current.name) {
      set.name = name;
      original.name = current.name;
      next.name = name;
    }
  }
  setField("description", "description", current.description);

  if (patch.bugs_and_chores_are_estimatable === false && current.bugs_and_chores_are_estimatable) {
    throw new HttpError(409, "bugs_and_chores_estimation_is_one_way");
  }
  setField("bugs_and_chores_are_estimatable", "bugsAndChoresAreEstimatable", current.bugs_and_chores_are_estimatable);

  if (patch.point_scale !== undefined && patch.point_scale !== current.point_scale) {
    let parsed: number[];
    try {
      parsed = parsePointScale(patch.point_scale);
    } catch {
      throw new HttpError(400, "point_scale_invalid");
    }
    if (current.point_scale_is_custom && !isCustomPointScale(patch.point_scale)) {
      throw new HttpError(409, "point_scale_custom_is_one_way");
    }
    // Built-in → built-in rewrites every estimate, accepted stories included (core-model §2.2.2);
    // a move to a custom scale preserves them.
    if (!current.point_scale_is_custom && !isCustomPointScale(patch.point_scale)) {
      for (const row of tx.tx
        .select({ id: stories.id, estimate: stories.estimate })
        .from(stories)
        .where(and(eq(stories.projectId, tx.projectId), isNotNull(stories.estimate)))
        .all()) {
        tx.tx
          .update(stories)
          .set({ estimate: nearestOnScale(row.estimate!, parsed) })
          .where(and(eq(stories.id, row.id), eq(stories.projectId, tx.projectId)))
          .run();
      }
    }
    set.pointScale = patch.point_scale;
    original.point_scale = current.point_scale;
    next.point_scale = patch.point_scale;
  }

  if (patch.time_zone !== undefined) assertKnownTimeZone(patch.time_zone);
  setField("time_zone", "timeZone", current.time_zone);
  setField("iteration_length", "iterationLength", current.iteration_length);
  setField("week_start_day", "weekStartDay", current.week_start_day);
  setField("start_date", "startDate", current.start_date);
  setField("velocity_averaged_over", "velocityAveragedOver", current.velocity_averaged_over);
  setField("initial_velocity", "initialVelocity", current.initial_velocity);
  setField(
    "number_of_done_iterations_to_show",
    "numberOfDoneIterationsToShow",
    current.number_of_done_iterations_to_show,
  );
  setField("enable_tasks", "enableTasks", current.enable_tasks);
  setField("show_story_priority", "showStoryPriority", current.show_story_priority);

  // Automatic planning has no `planned` state, so the stories holding one are handed back to the
  // backlog before the flag flips; projects_automatic_planning_needs_no_planned refuses the
  // reverse order. Each rewrite carries its own story_update_activity.
  if (patch.automatic_planning === true && !current.automatic_planning) {
    for (const row of tx.tx
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.projectId, tx.projectId), eq(stories.currentState, "planned")))
      .all()) {
      tx.tx
        .update(stories)
        .set({ currentState: "unstarted", updatedAt: Date.now() })
        .where(and(eq(stories.id, row.id), eq(stories.projectId, tx.projectId)))
        .run();
      recordActivity(tx, {
        kind: "story_update_activity",
        message: "unscheduled a planned story when automatic planning was turned on",
        highlight: "edited",
        changes: [
          {
            kind: "story",
            id: row.id,
            change_type: "update",
            original_values: { current_state: "planned" },
            new_values: { current_state: "unstarted" },
          },
        ],
        primaryResources: [{ kind: "story", id: row.id }],
      });
    }
  }
  setField("automatic_planning", "automaticPlanning", current.automatic_planning);

  // Only the calendar's origin renumbers iterations. iteration_length is itself an overridable
  // per-iteration value, so changing the project default must not wipe the overrides.
  const calendarMoved =
    (patch.start_date !== undefined && patch.start_date !== current.start_date) ||
    (patch.week_start_day !== undefined && patch.week_start_day !== current.week_start_day);

  if (Object.keys(set).length === 0) return current;
  try {
    tx.tx.update(projects).set(set as never).where(eq(projects.id, tx.projectId)).run();
  } catch (e) {
    asFieldError(e);
  }
  if (calendarMoved) {
    // core-model §2.3.4: moving the calendar recalculates every iteration, so the overrides
    // attached to the old numbering no longer describe anything.
    tx.tx.delete(iterationOverrides).where(eq(iterationOverrides.projectId, tx.projectId)).run();
  }
  recordActivity(tx, {
    kind: "project_update_activity",
    message: "edited this project",
    highlight: "edited",
    changes: [{ kind: "project", id: tx.projectId, change_type: "update", original_values: original, new_values: next }],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
  return readProject(tx);
}

export function setArchived(tx: ProjectTx, archived: boolean): ProjectSettings {
  const archivedAt = archived ? Date.now() : null;
  tx.tx.update(projects).set({ archivedAt }).where(eq(projects.id, tx.projectId)).run();
  recordActivity(tx, {
    kind: "project_update_activity",
    message: archived ? "archived this project" : "unarchived this project",
    highlight: archived ? "archived" : "unarchived",
    changes: [{ kind: "project", id: tx.projectId, change_type: "update", new_values: { archived_at: archivedAt } }],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
  return readProject(tx);
}

export function deleteProject(tx: ProjectTx): void {
  // Members and activity rows all cascade from projects.id.
  tx.tx.delete(projects).where(eq(projects.id, tx.projectId)).run();
}
