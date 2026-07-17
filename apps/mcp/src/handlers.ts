import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateVelocity, type StoryTransitionAction } from "@storylane/core";

// The MCP server talks to Supabase as an untyped client (it does not import
// apps/web's generated Database type — that would couple the packages). Rows
// are shaped by hand below, so a few small local row shapes are enough.
type Db = SupabaseClient;

const NOT_MEMBER =
  "The agent is not a member of this project, or it does not exist. Invite the agent user to the project (role member) first — see apps/mcp/README.md.";

/** UTC date key (YYYY-MM-DD), matching Web's ensureCurrentIteration / iterations.end_date. */
function utcTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Lazy rollover before any tool that reads or writes the current iteration
 * (spec/mcp.md write-path rules "Lazy rollover first"). Mirrors Web's
 * ensureCurrentIteration: a cheap pre-check, then finalize_iteration only when
 * the latest iteration is finalized or past its end date. No Slack notify —
 * that stays with the Next.js actions until TASK-24 (spec/mcp.md).
 */
export async function ensureCurrentIteration(supabase: Db, projectId: string): Promise<void> {
  const { data, error } = await supabase
    .from("iterations")
    .select("state, end_date")
    .eq("project_id", projectId)
    .order("number", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read iterations: ${error.message}`);

  const latest = data?.[0] ?? null;
  if (latest && latest.state !== "done" && latest.end_date >= utcTodayKey()) return;

  const { error: rpcError } = await supabase.rpc("finalize_iteration", {
    p_project_id: projectId,
    p_manual: false,
  });
  if (rpcError) throw new Error(`Iteration rollover failed: ${rpcError.message}`);
}

async function currentIterationId(supabase: Db, projectId: string): Promise<string> {
  const { data } = await supabase
    .from("iterations")
    .select("id")
    .eq("project_id", projectId)
    .neq("state", "done")
    .order("number", { ascending: false })
    .limit(1);
  const id = data?.[0]?.id as string | undefined;
  if (!id) throw new Error("This project has no active iteration to schedule into.");
  return id;
}

/**
 * Common write preprocessing (spec/mcp.md "Mode and archive guards"): the
 * project must be readable by the bot (membership, via RLS — an unreadable row
 * means "not a member"), in tracker mode, and not archived. Reading `projects`
 * is itself the membership check, so this doubles as one.
 */
async function assertWritableTracker(supabase: Db, projectId: string): Promise<void> {
  const { data, error } = await supabase
    .from("projects")
    .select("workflow_mode, archived_at")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not read project: ${error.message}`);
  if (!data) throw new Error(NOT_MEMBER);
  if (data.archived_at) {
    throw new Error("This project is archived — unarchive it before making changes.");
  }
  if (data.workflow_mode !== "tracker") {
    throw new Error(
      `This project is in '${data.workflow_mode}' mode; the MCP server manages tracker-mode projects only (spec/mcp.md).`,
    );
  }
}

/** Reads a story's project (also a membership check via RLS). */
async function storyProjectId(supabase: Db, storyId: string): Promise<string> {
  const { data, error } = await supabase
    .from("stories")
    .select("project_id")
    .eq("id", storyId)
    .maybeSingle();
  if (error) throw new Error(`Could not read story: ${error.message}`);
  if (!data) throw new Error(NOT_MEMBER);
  return data.project_id as string;
}

/**
 * Explicit error for a write RLS-filtered to zero rows (spec/mcp.md
 * "Row-count verification everywhere"): a silent 0-row UPDATE means the bot is
 * a member but not this story's author or assignee, so member-role RLS blocked
 * it. A WITH CHECK violation (e.g. reassigning an assignee-only story to
 * someone else) surfaces as a Postgres error instead, handled by the caller.
 */
function notAuthorOrAssignee(): Error {
  return new Error(
    "Not allowed: the agent is not the author or assignee of this story (member-role RLS only permits writing stories the agent created or is assigned to).",
  );
}

/** Resolves label names to ids within a project, creating any that don't exist. */
async function resolveLabelIds(supabase: Db, projectId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const rawName of names) {
    const name = rawName.trim();
    if (!name) continue;
    const { data: existing } = await supabase
      .from("labels")
      .select("id")
      .eq("project_id", projectId)
      .eq("name", name)
      .order("id")
      .limit(1);
    const existingId = existing?.[0]?.id as string | undefined;
    if (existingId) {
      ids.push(existingId);
      continue;
    }
    const { data: created, error } = await supabase
      .from("labels")
      .insert({ project_id: projectId, name })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create label "${name}": ${error.message}`);
    ids.push((created as { id: string }).id);
  }
  return ids;
}

/** Replaces a story's labels with exactly `names`. */
async function setLabels(supabase: Db, storyId: string, projectId: string, names: string[]): Promise<void> {
  const ids = await resolveLabelIds(supabase, projectId, names);
  const { error: delErr } = await supabase.from("story_labels").delete().eq("story_id", storyId);
  if (delErr) throw new Error(`Could not clear labels: ${delErr.message}`);
  if (ids.length === 0) return;
  const { error: insErr } = await supabase
    .from("story_labels")
    .insert(ids.map((label_id) => ({ story_id: storyId, label_id })));
  if (insErr) throw new Error(`Could not set labels: ${insErr.message}`);
}

// ── Read tools ──────────────────────────────────────────────────────────────

export async function boardSummary(supabase: Db, args: { project_id: string }) {
  const { project_id } = args;
  await ensureCurrentIteration(supabase, project_id);

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("velocity_window")
    .eq("id", project_id)
    .maybeSingle();
  if (pErr) throw new Error(`Could not read project: ${pErr.message}`);
  if (!project) throw new Error(NOT_MEMBER);

  const { data: iters } = await supabase
    .from("iterations")
    .select("id, number, goal, start_date, end_date, state")
    .eq("project_id", project_id)
    .neq("state", "done")
    .order("number", { ascending: false })
    .limit(1);
  const current = iters?.[0] ?? null;

  const { data: doneIters } = await supabase
    .from("iterations")
    .select("velocity")
    .eq("project_id", project_id)
    .eq("state", "done")
    .order("number", { ascending: false })
    .limit(project.velocity_window);
  const velocity = calculateVelocity(doneIters ?? [], project.velocity_window);

  const pointsByState: Record<string, number> = {};
  const countsByState: Record<string, number> = {};
  if (current) {
    const { data: stories } = await supabase
      .from("stories")
      .select("state, points")
      .eq("iteration_id", current.id);
    for (const s of stories ?? []) {
      pointsByState[s.state] = (pointsByState[s.state] ?? 0) + (s.points ?? 0);
      countsByState[s.state] = (countsByState[s.state] ?? 0) + 1;
    }
  }

  const [{ count: backlogCount }, { count: iceboxCount }] = await Promise.all([
    supabase
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("state", "unstarted")
      .is("iteration_id", null),
    supabase
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("state", "unscheduled"),
  ]);

  return {
    current_iteration: current,
    velocity,
    points_by_state: pointsByState,
    counts_by_state: countsByState,
    backlog_count: backlogCount ?? 0,
    icebox_count: iceboxCount ?? 0,
  };
}

type StoryRow = {
  id: string;
  number: number;
  title: string;
  story_type: string;
  state: string;
  points: number | null;
  epic: { name: string } | null;
  story_labels: { labels: { name: string } | null }[] | null;
};

function compactStory(row: StoryRow) {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    type: row.story_type,
    state: row.state,
    points: row.points,
    epic: row.epic?.name ?? null,
    labels: (row.story_labels ?? []).map((sl) => sl.labels?.name).filter(Boolean),
  };
}

export type StoryFilter = {
  state?: string;
  iteration_id?: string;
  epic_id?: string;
  label?: string;
  text?: string;
  zone?: "backlog" | "icebox" | "current";
};

export async function listStories(supabase: Db, args: { project_id: string; filter?: StoryFilter }) {
  const { project_id, filter } = args;

  let query = supabase
    .from("stories")
    .select("id, number, title, story_type, state, points, epic:epics(name), story_labels(labels(name))")
    .eq("project_id", project_id);

  if (filter?.state) query = query.eq("state", filter.state);
  if (filter?.epic_id) query = query.eq("epic_id", filter.epic_id);
  if (filter?.iteration_id) query = query.eq("iteration_id", filter.iteration_id);
  if (filter?.text) query = query.ilike("title", `%${filter.text}%`);

  if (filter?.zone === "backlog") {
    query = query.eq("state", "unstarted").is("iteration_id", null);
  } else if (filter?.zone === "icebox") {
    query = query.eq("state", "unscheduled");
  } else if (filter?.zone === "current") {
    await ensureCurrentIteration(supabase, project_id);
    query = query.eq("iteration_id", await currentIterationId(supabase, project_id));
  }

  if (filter?.label) {
    const { data: labels } = await supabase
      .from("labels")
      .select("id")
      .eq("project_id", project_id)
      .eq("name", filter.label);
    const labelIds = (labels ?? []).map((l) => l.id);
    if (labelIds.length === 0) return [];
    const { data: links } = await supabase.from("story_labels").select("story_id").in("label_id", labelIds);
    const storyIds = [...new Set((links ?? []).map((l) => l.story_id))];
    if (storyIds.length === 0) return [];
    query = query.in("id", storyIds);
  }

  const { data, error } = await query.order("number", { ascending: true });
  if (error) throw new Error(`Could not list stories: ${error.message}`);
  return ((data as unknown as StoryRow[] | null) ?? []).map(compactStory);
}

export async function getStory(supabase: Db, args: { story_id: string }) {
  const { story_id } = args;
  const { data: raw, error } = await supabase
    .from("stories")
    .select(
      "id, number, title, description, story_type, state, points, iteration_id, assignee_id, created_by, " +
        "epic:epics(id, name), story_labels(labels(id, name, color)), " +
        "tasks(id, title, is_done, position), comments(id, body, author_id, created_at)",
    )
    .eq("id", story_id)
    .maybeSingle();
  if (error) throw new Error(`Could not read story: ${error.message}`);
  if (!raw) throw new Error(NOT_MEMBER);
  const data = raw as unknown as {
    id: string;
    number: number;
    title: string;
    description: string | null;
    story_type: string;
    state: string;
    points: number | null;
    iteration_id: string | null;
    assignee_id: string | null;
    epic: unknown;
    story_labels: { labels: unknown }[] | null;
    tasks: { id: string; title: string; is_done: boolean; position: number }[] | null;
    comments: { id: string; body: string; author_id: string; created_at: string }[] | null;
  };

  const { data: activity } = await supabase
    .from("activity_logs")
    .select("action, payload, actor_id, created_at")
    .eq("story_id", story_id)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    id: data.id,
    number: data.number,
    title: data.title,
    description: data.description,
    type: data.story_type,
    state: data.state,
    points: data.points,
    iteration_id: data.iteration_id,
    assignee_id: data.assignee_id,
    epic: data.epic ?? null,
    labels: (data.story_labels ?? []).map((sl: { labels: unknown }) => sl.labels).filter(Boolean),
    tasks: (data.tasks ?? []).sort((a: { position: number }, b: { position: number }) => a.position - b.position),
    comments: (data.comments ?? []).sort(
      (a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at),
    ),
    recent_activity: activity ?? [],
  };
}

// ── Write tools ─────────────────────────────────────────────────────────────

export type CreateStoryArgs = {
  project_id: string;
  title: string;
  description?: string;
  story_type?: string;
  points?: number;
  epic_id?: string;
  labels?: string[];
  destination?: "backlog_bottom" | "icebox" | "current_iteration";
};

export async function createStory(supabase: Db, args: CreateStoryArgs) {
  await assertWritableTracker(supabase, args.project_id);

  const destination = args.destination ?? "backlog_bottom";
  let state = "unstarted";
  let iterationId: string | null = null;
  if (destination === "icebox") {
    state = "unscheduled";
  } else if (destination === "current_iteration") {
    await ensureCurrentIteration(supabase, args.project_id);
    iterationId = await currentIterationId(supabase, args.project_id);
  }

  // position and number are assigned by the DB (sequence default + trigger);
  // a fresh sequence value sorts after every existing row, so the story lands
  // at the bottom of its destination zone touching no other row (spec/mcp.md).
  const insert: Record<string, unknown> = {
    project_id: args.project_id,
    title: args.title,
    state,
    iteration_id: iterationId,
  };
  if (args.description !== undefined) insert.description = args.description;
  if (args.story_type !== undefined) insert.story_type = args.story_type;
  if (args.points !== undefined) insert.points = args.points;
  if (args.epic_id !== undefined) insert.epic_id = args.epic_id;

  const { data: story, error } = await supabase
    .from("stories")
    .insert(insert)
    .select("id, number, title, state, iteration_id")
    .single();
  if (error) {
    if (error.code === "42501") {
      throw new Error("Not allowed to create stories here — the agent must be a project member (viewers cannot write).");
    }
    throw new Error(`Could not create story: ${error.message}`);
  }

  if (args.labels?.length) await setLabels(supabase, story.id, args.project_id, args.labels);
  return story;
}

export type UpdateStoryArgs = {
  story_id: string;
  title?: string;
  description?: string | null;
  points?: number | null;
  epic_id?: string | null;
  assignee_id?: string | null;
  labels?: string[];
};

export async function updateStory(supabase: Db, args: UpdateStoryArgs) {
  const projectId = await storyProjectId(supabase, args.story_id);
  await assertWritableTracker(supabase, projectId);

  const patch: Record<string, unknown> = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.description !== undefined) patch.description = args.description;
  if (args.points !== undefined) patch.points = args.points;
  if (args.epic_id !== undefined) patch.epic_id = args.epic_id;
  if (args.assignee_id !== undefined) patch.assignee_id = args.assignee_id;

  if (Object.keys(patch).length > 0) {
    const { data, error } = await supabase
      .from("stories")
      .update(patch)
      .eq("id", args.story_id)
      .select("id");
    if (error) {
      if (error.code === "42501") {
        throw new Error(
          "Not allowed: this update is blocked by RLS. A member bot can only edit stories it authored or is assigned to, and cannot reassign a story it merely holds as assignee to someone else.",
        );
      }
      throw new Error(`Could not update story: ${error.message}`);
    }
    if (!data || data.length === 0) throw notAuthorOrAssignee();
  }

  // ponytail: labels-only edits are governed by story_labels RLS (any project
  // member), not the author/assignee gate above — the existing table policy,
  // matched to the Web behaviour. Note it rather than adding a bespoke check.
  if (args.labels !== undefined) await setLabels(supabase, args.story_id, projectId, args.labels);

  return { story_id: args.story_id, updated: true };
}

export async function transitionStory(supabase: Db, args: { story_id: string; action: StoryTransitionAction }) {
  const projectId = await storyProjectId(supabase, args.story_id);
  await assertWritableTracker(supabase, projectId);

  // Start/Restart may pull a backlog story into the current iteration (the RPC
  // resolves it under a lock); roll a due iteration over first so it lands in
  // the fresh one, not a stale past-due row (spec/mcp.md "Lazy rollover").
  if (args.action === "start" || args.action === "restart") {
    await ensureCurrentIteration(supabase, projectId);
  }

  const { data, error } = await supabase.rpc("transition_story", {
    p_story_id: args.story_id,
    p_action: args.action,
  });
  // The RPC raises self-explanatory messages (bad transition, unestimated
  // feature, not-owner/author/assignee) — surface them verbatim.
  if (error) throw new Error(error.message);
  return data;
}

const MOVE_ZONES = {
  backlog: { state: "unstarted", iteration: "none" as const, requiresUnstarted: true },
  icebox: { state: "unscheduled", iteration: "none" as const, requiresUnstarted: true },
  current_iteration: { state: "unstarted", iteration: "current" as const, requiresUnstarted: true },
};

export async function moveStory(supabase: Db, args: { story_id: string; destination: keyof typeof MOVE_ZONES }) {
  const { data: story, error: readErr } = await supabase
    .from("stories")
    .select("project_id, state, iteration_id, custom_status_id, swimlane_id, focus")
    .eq("id", args.story_id)
    .maybeSingle();
  if (readErr) throw new Error(`Could not read story: ${readErr.message}`);
  if (!story) throw new Error(NOT_MEMBER);

  await assertWritableTracker(supabase, story.project_id);
  await ensureCurrentIteration(supabase, story.project_id);

  const zone = MOVE_ZONES[args.destination];
  // Only pre-start work moves between these scheduling zones (mirrors
  // kanban.ts evaluateDrop's scheduling branches); a started/finished/… story
  // changes zone via transition_story, not move_story.
  if (zone.requiresUnstarted && !(story.state === "unstarted" || story.state === "unscheduled")) {
    throw new Error(
      `Only unstarted or icebox stories can move between scheduling zones; this story is '${story.state}'. Use transition_story instead.`,
    );
  }

  // move_story_board (SECURITY DEFINER) re-checks membership, resolves the
  // current iteration under the finalize+positions locks, and appends to the
  // destination zone's bottom (empty anchor). Reused rather than a bare UPDATE
  // so positioning stays consistent with the board's own moves (spec/mcp.md
  // "no position parameter").
  const { error } = await supabase.rpc("move_story_board", {
    p_project_id: story.project_id,
    p_item: { kind: "story", id: args.story_id },
    p_view: "tracker",
    p_expected: {
      state: story.state,
      iteration_id: story.iteration_id,
      custom_status_id: story.custom_status_id,
      swimlane_id: story.swimlane_id,
      focus: story.focus,
    },
    p_deltas: { state: zone.state, iteration: zone.iteration },
    p_anchor: {},
  });
  if (error) {
    if (error.code === "42501") throw new Error(NOT_MEMBER);
    throw new Error(error.message);
  }
  return { story_id: args.story_id, destination: args.destination };
}

export async function addComment(supabase: Db, args: { story_id: string; body: string }) {
  const projectId = await storyProjectId(supabase, args.story_id);
  await assertWritableTracker(supabase, projectId);

  const { data, error } = await supabase
    .from("comments")
    .insert({ story_id: args.story_id, body: args.body })
    .select("id, body, created_at")
    .single();
  if (error) {
    if (error.code === "42501") throw new Error("Not allowed to comment — the agent must be a project member.");
    throw new Error(`Could not add comment: ${error.message}`);
  }
  return data;
}

export async function setStoryTasks(supabase: Db, args: { story_id: string; tasks: { title: string; done?: boolean }[] }) {
  const projectId = await storyProjectId(supabase, args.story_id);
  await assertWritableTracker(supabase, projectId);

  const { error: delErr } = await supabase.from("tasks").delete().eq("story_id", args.story_id);
  if (delErr) throw new Error(`Could not clear tasks: ${delErr.message}`);

  if (args.tasks.length === 0) return { story_id: args.story_id, tasks: [] };

  const rows = args.tasks.map((t, i) => ({
    story_id: args.story_id,
    title: t.title,
    is_done: t.done ?? false,
    position: i,
  }));
  const { data, error } = await supabase.from("tasks").insert(rows).select("id, title, is_done, position");
  if (error) throw new Error(`Could not set tasks: ${error.message}`);
  return { story_id: args.story_id, tasks: data };
}

export async function toggleStoryTask(supabase: Db, args: { task_id: string; done: boolean }) {
  const { data: task, error: readErr } = await supabase
    .from("tasks")
    .select("story_id, stories(project_id)")
    .eq("id", args.task_id)
    .maybeSingle();
  if (readErr) throw new Error(`Could not read task: ${readErr.message}`);
  if (!task) throw new Error("Task not found, or the agent is not a member of its project.");
  const projectId = (task.stories as unknown as { project_id: string } | null)?.project_id;
  if (projectId) await assertWritableTracker(supabase, projectId);

  const { data, error } = await supabase
    .from("tasks")
    .update({ is_done: args.done })
    .eq("id", args.task_id)
    .select("id, title, is_done");
  if (error) throw new Error(`Could not toggle task: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Task not found, or not writable by the agent.");
  return data[0];
}
