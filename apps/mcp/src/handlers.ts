import type { SupabaseClient } from "@supabase/supabase-js";
import { velocityRate, shouldAssignCurrentIteration, type StateCategory } from "@storylane/core";

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
 * The project's lowest-position unstarted-category state — where a fresh
 * backlog story lands. Resolved at runtime, never assumed to be a fixed
 * template state: states are editable after project creation.
 */
async function unstartedStateId(supabase: Db, projectId: string): Promise<string> {
  const { data, error } = await supabase
    .from("project_states")
    .select("id")
    .eq("project_id", projectId)
    .eq("category", "unstarted")
    .order("position")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not resolve an unstarted state: ${error.message}`);
  if (!data) throw new Error("This project has no unstarted-category state to land stories in.");
  return data.id;
}

/**
 * Common write preprocessing the project must be readable by the bot (membership, via RLS — an unreadable row means "not a member") and not archived. Reading `projects`
 * is itself the membership check, so this doubles as one.
 */
async function assertWritableProject(supabase: Db, projectId: string): Promise<void> {
  const { data, error } = await supabase
    .from("projects")
    .select("archived_at")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not read project: ${error.message}`);
  if (!data) throw new Error(NOT_MEMBER);
  if (data.archived_at) {
    throw new Error("This project is archived — unarchive it before making changes.");
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
 * "Row-count verification everywhere"): since TASK-70, member-role RLS allows
 * writing any story in the project, so a 0-row UPDATE past the existence
 * check is a residual race — the story was deleted, or the bot's role was
 * revoked, between the read and this write — not an ownership denial.
 */
function storyNoLongerWritable(): Error {
  return new Error("Not allowed: this story no longer exists or the agent can no longer write to it.");
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
    if (error) throw Object.assign(new Error(`Could not create label "${name}": ${error.message}`), { code: error.code });
    ids.push((created as { id: string }).id);
  }
  return ids;
}

/**
 * Replaces a story's labels with exactly `names`. The name->id resolve stays
 * here (creating any missing labels); the DELETE+INSERT replace is one atomic
 * RPC so a failure can't leave the story half-relabeled (TASK-71).
 */
async function setLabels(supabase: Db, storyId: string, projectId: string, names: string[]): Promise<void> {
  const ids = await resolveLabelIds(supabase, projectId, names);
  const { error } = await supabase.rpc("set_story_labels", { p_story_id: storyId, p_label_ids: ids });
  if (error) throw new Error(`Could not set labels: ${error.message}`);
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

  const { data: states, error: sErr } = await supabase
    .from("project_states")
    .select("id, name, category, action_label")
    .eq("project_id", project_id)
    .order("position");
  if (sErr) throw new Error(`Could not read states: ${sErr.message}`);

  const { data: iters } = await supabase
    .from("iterations")
    .select("id, number, goal, start_date, end_date, state")
    .eq("project_id", project_id)
    .neq("state", "done")
    .order("number", { ascending: false })
    .limit(1);
  const current = iters?.[0] ?? null;

  // The window filters (skipped / capacity>0, spec/velocity.md) are applied
  // in the query rather than after it, so `limit` still returns a full
  // window instead of a window with the excluded rows punched out of it.
  const { data: doneIters } = await supabase
    .from("iterations")
    .select("velocity, capacity")
    .eq("project_id", project_id)
    .eq("state", "done")
    .eq("skipped", false)
    .gt("capacity", 0)
    .order("number", { ascending: false })
    .limit(project.velocity_window);
  const velocity_rate = velocityRate(doneIters ?? [], project.velocity_window);

  const pointsByStateId: Record<string, number> = {};
  const countsByStateId: Record<string, number> = {};
  if (current) {
    const { data: stories } = await supabase
      .from("stories")
      .select("state_id, points")
      .eq("iteration_id", current.id);
    for (const s of stories ?? []) {
      // Icebox (state_id null) never carries an iteration_id
      // (spec/data-model.md "Backlog zone predicate"), so every row here has
      // a real state_id — but guard defensively rather than assume.
      if (!s.state_id) continue;
      pointsByStateId[s.state_id] = (pointsByStateId[s.state_id] ?? 0) + (s.points ?? 0);
      countsByStateId[s.state_id] = (countsByStateId[s.state_id] ?? 0) + 1;
    }
  }

  // Every project state, not just ones with current-iteration stories — this
  // is how the caller learns valid `state_id` targets for set_story_state
  // (spec/mcp.md: "the caller reads valid states from board_summary").
  const byState = (states ?? []).map((s) => ({
    state_id: s.id,
    name: s.name,
    category: s.category,
    action_label: s.action_label,
    points: pointsByStateId[s.id] ?? 0,
    count: countsByStateId[s.id] ?? 0,
  }));
  // The two reads above aren't transactional — a state created between them
  // (a Settings-UI-only action, not an MCP tool, so this can only happen
  // from a human editing states at the same moment) wouldn't appear in
  // `states`. Fold any such orphaned points/count in rather than silently
  // dropping them.
  for (const stateId of Object.keys(pointsByStateId)) {
    if (!byState.some((s) => s.state_id === stateId)) {
      byState.push({
        state_id: stateId,
        name: "(unknown state)",
        category: null,
        action_label: null,
        points: pointsByStateId[stateId],
        count: countsByStateId[stateId] ?? 0,
      });
    }
  }

  const [{ count: backlogCount }, { count: iceboxCount }] = await Promise.all([
    supabase
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .is("iteration_id", null)
      .not("state_id", "is", null),
    supabase
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .is("state_id", null),
  ]);

  return {
    current_iteration: current,
    velocity_rate,
    by_state: byState,
    backlog_count: backlogCount ?? 0,
    icebox_count: iceboxCount ?? 0,
  };
}

type StoryRow = {
  id: string;
  number: number;
  title: string;
  story_type: string;
  state_id: string | null;
  state: { name: string; category: StateCategory; action_label: string | null } | null;
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
    state_id: row.state_id,
    state: row.state?.name ?? "Icebox",
    category: row.state?.category ?? null,
    points: row.points,
    epic: row.epic?.name ?? null,
    labels: (row.story_labels ?? []).map((sl) => sl.labels?.name).filter(Boolean),
  };
}

export type StoryFilter = {
  state_id?: string | null;
  iteration_id?: string;
  epic_id?: string;
  label?: string;
  text?: string;
  zone?: "backlog" | "icebox" | "current";
};

const STATE_SELECT = "state_id, state:project_states(name, category, action_label)";

const STORY_SELECT = `id, number, title, story_type, ${STATE_SELECT}, points, epic:epics(name), story_labels(labels(name))`;

export async function listStories(supabase: Db, args: { project_id: string; filter?: StoryFilter }) {
  const { project_id, filter } = args;

  let query = supabase.from("stories").select(STORY_SELECT).eq("project_id", project_id);

  if (filter?.state_id !== undefined) {
    query = filter.state_id === null ? query.is("state_id", null) : query.eq("state_id", filter.state_id);
  }
  if (filter?.epic_id) query = query.eq("epic_id", filter.epic_id);
  if (filter?.iteration_id) query = query.eq("iteration_id", filter.iteration_id);
  if (filter?.text) query = query.ilike("title", `%${filter.text}%`);

  if (filter?.zone === "backlog") {
    query = query.is("iteration_id", null).not("state_id", "is", null);
  } else if (filter?.zone === "icebox") {
    query = query.is("state_id", null);
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
      `id, number, title, description, story_type, ${STATE_SELECT}, points, iteration_id, assignee_id, created_by, ` +
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
    state_id: string | null;
    state: { name: string; category: StateCategory; action_label: string | null } | null;
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
    state_id: data.state_id,
    state: data.state?.name ?? "Icebox",
    category: data.state?.category ?? null,
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
  await assertWritableProject(supabase, args.project_id);

  const destination = args.destination ?? "backlog_bottom";
  const stateId = destination === "icebox" ? null : await unstartedStateId(supabase, args.project_id);
  let iterationId: string | null = null;
  if (destination === "current_iteration") {
    await ensureCurrentIteration(supabase, args.project_id);
    iterationId = await currentIterationId(supabase, args.project_id);
  }

  // Resolve labels BEFORE creating the story: if this fails, no story exists
  // yet, so an agent retry can't duplicate it. position/number are DB-assigned
  // (sequence default + trigger) — a fresh sequence value lands the story at
  // its zone's bottom, touching no other row (spec/mcp.md).
  let labelIds: string[] = [];
  if (args.labels?.length) {
    try {
      labelIds = await resolveLabelIds(supabase, args.project_id, args.labels);
    } catch (err) {
      // A viewer creating a story with a not-yet-existing label name hits the
      // labels table's own RLS here, before the story insert below would have
      // — surface the same friendly denial rather than the raw labels error.
      if ((err as { code?: string }).code === "42501") {
        throw new Error("Not allowed to create stories here — the agent must be a project member (viewers cannot write).");
      }
      throw err;
    }
  }

  // create_story_tracker inserts the story and its labels in one transaction,
  // so a label failure rolls the story back too (TASK-71). Always routed
  // through the RPC (not just when labels exist) — one insert path to keep in
  // sync with the columns.
  const { data, error } = await supabase.rpc("create_story_tracker", {
    p_project_id: args.project_id,
    p_title: args.title,
    p_state_id: stateId,
    p_iteration_id: iterationId,
    p_description: args.description ?? null,
    p_story_type: args.story_type ?? null,
    p_points: args.points ?? null,
    p_epic_id: args.epic_id ?? null,
    p_label_ids: labelIds,
  });
  if (error) {
    if (error.code === "42501") {
      throw new Error("Not allowed to create stories here — the agent must be a project member (viewers cannot write).");
    }
    throw new Error(`Could not create story: ${error.message}`);
  }
  return Array.isArray(data) ? data[0] : data;
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
  await assertWritableProject(supabase, projectId);

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
      throw new Error(`Could not update story: ${error.message}`);
    }
    if (!data || data.length === 0) throw storyNoLongerWritable();
  }

  // ponytail: labels-only edits are governed by story_labels RLS (any project
  // member) — the same "any member" rule the stories UPDATE above now uses
  // too (TASK-70), matched to the Web behaviour. Note it rather than adding
  // a bespoke check.
  if (args.labels !== undefined) await setLabels(supabase, args.story_id, projectId, args.labels);

  return { story_id: args.story_id, updated: true };
}

export async function setStoryState(supabase: Db, args: { story_id: string; state_id: string | null }) {
  const { data: story, error: readErr } = await supabase
    .from("stories")
    .select("project_id, iteration_id")
    .eq("id", args.story_id)
    .maybeSingle();
  if (readErr) throw new Error(`Could not read story: ${readErr.message}`);
  if (!story) throw new Error(NOT_MEMBER);
  await assertWritableProject(supabase, story.project_id);

  if (args.state_id !== null) {
    const { data: target, error: targetErr } = await supabase
      .from("project_states")
      .select("category")
      .eq("id", args.state_id)
      .eq("project_id", story.project_id)
      .maybeSingle();
    if (targetErr) throw new Error(`Could not read target state: ${targetErr.message}`);
    // Entering an in_progress-category state from no iteration may pull a
    // backlog story into the current one (the RPC resolves it under a lock)
    // — roll a due iteration over first so it lands in the fresh one, not a
    // stale past-due row (spec/mcp.md "Lazy rollover").
    if (target && shouldAssignCurrentIteration(target.category as StateCategory, story.iteration_id !== null)) {
      await ensureCurrentIteration(supabase, story.project_id);
    }
  }

  const { data, error } = await supabase.rpc("set_story_state", {
    p_story_id: args.story_id,
    p_state_id: args.state_id,
  });
  // The RPC raises self-explanatory messages (bad target, unestimated
  // feature, no active iteration) — surface them verbatim. Its own "not
  // allowed to change this story's state" denial only fires for a viewer or
  // a mid-request role-revocation race (TASK-70 relaxed the underlying RLS
  // policy so any member may write any story).
  if (error) throw new Error(error.message);
  return data;
}

export async function moveStory(supabase: Db, args: { story_id: string; destination: "current_iteration" | "backlog" | "icebox" }) {
  const { data: story, error: readErr } = await supabase
    .from("stories")
    .select("project_id, state_id, iteration_id")
    .eq("id", args.story_id)
    .maybeSingle();
  if (readErr) throw new Error(`Could not read story: ${readErr.message}`);
  if (!story) throw new Error(NOT_MEMBER);

  await assertWritableProject(supabase, story.project_id);
  await ensureCurrentIteration(supabase, story.project_id);

  // Only pre-start work moves between these scheduling zones (mirrors
  // kanban.ts evaluateDrop's scheduling branches); a story already past
  // unstarted changes zone via set_story_state, not move_story.
  let currentCategory: StateCategory | null = null;
  if (story.state_id !== null) {
    const { data: cur } = await supabase.from("project_states").select("category").eq("id", story.state_id).maybeSingle();
    currentCategory = (cur?.category as StateCategory | undefined) ?? null;
  }
  if (currentCategory !== null && currentCategory !== "unstarted") {
    throw new Error(
      "Only unstarted or icebox stories can move between scheduling zones; this story has already started. Use set_story_state instead.",
    );
  }

  const targetStateId = args.destination === "icebox" ? null : await unstartedStateId(supabase, story.project_id);
  const targetIteration = args.destination === "current_iteration" ? "current" : "none";

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
      state_id: story.state_id,
      iteration_id: story.iteration_id,
    },
    p_deltas: { state_id: targetStateId, iteration: targetIteration },
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
  await assertWritableProject(supabase, projectId);

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
  await assertWritableProject(supabase, projectId);

  // One RPC does the DELETE+INSERT atomically (a failed INSERT can't wipe the
  // checklist) and lets tasks_position_seq assign position (TASK-71).
  const { data, error } = await supabase.rpc("set_story_tasks", {
    p_story_id: args.story_id,
    p_tasks: args.tasks.map((t) => ({ title: t.title, is_done: t.done ?? false })),
  });
  if (error) throw new Error(`Could not set tasks: ${error.message}`);
  return { story_id: args.story_id, tasks: data ?? [] };
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
  if (projectId) await assertWritableProject(supabase, projectId);

  const { data, error } = await supabase
    .from("tasks")
    .update({ is_done: args.done })
    .eq("id", args.task_id)
    .select("id, title, is_done");
  if (error) throw new Error(`Could not toggle task: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Task not found, or not writable by the agent.");
  return data[0];
}
