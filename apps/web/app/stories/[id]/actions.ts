"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import type { ActionResult, ProjectState } from "@/lib/types";
import { pointScaleValues } from "@/lib/utils/stories";
import { buildContainerListItems, buildEpicBandChildren, type EpicBandChild } from "@/lib/utils/epics-list";
import { currentIterationOf } from "@/lib/utils/kanban";
import type { ContainerRollup } from "@storylane/core";

export type StoryDetail = {
  id: string;
  projectId: string;
  // The hidden per-user My Tasks project (projects.is_personal) has no
  // reachable Board nav — the story detail page's back-link routes to
  // /my-work instead when this is true (TASK-129).
  isPersonalProject: boolean;
  // Per-project sequential story number — shown as #123, referenced as
  // [SL-123] in PR titles (see spec/integrations.md).
  number: number;
  title: string;
  description: string | null;
  storyType: string;
  stateId: string | null;
  // The project's states, ordered by position — TransitionButtons'
  // computeStateGate input (packages/core).
  states: ProjectState[];
  points: number | null;
  parentId: string | null;
  // Trigger-derived (doc-18 §4) — a container has no board state and is
  // never itself nestable (single-level, §3): the Parent picker, Points
  // field, and Move/Copy/Split menu items are all hidden when true.
  isContainer: boolean;
  // Count of this story's own children — only meaningful when isContainer;
  // used for the Delete confirmation's "N child stories will be ungrouped"
  // notice (deleting a container SET NULLs their parent_id, doc-18 §8).
  childCount: number;
  // Only meaningful when isContainer (doc-20 §6 "Child stories" section):
  // every child, any zone (same EpicChildRow the List view's Epics band and
  // /epics use, AC#4), plus its own roll-up progress. epicColor mirrors the
  // Epics band's fallback (DEFAULT_EPIC_COLOR applied at render, not here).
  epicColor: string | null;
  children: EpicBandChild[];
  childRollup: ContainerRollup;
  // "Add a child" candidates (doc-20 §6): every top-level, non-container
  // story in the project — the mirror of parentCandidates, which offers a
  // container's children as containerization targets; a container can never
  // itself become a child (single-level nesting, doc-18 §3), so it is
  // excluded here rather than surfaced as an option that always errors.
  addChildCandidates: { id: string; number: number; title: string }[];
  assigneeId: string | null;
  labelIds: string[];
  pointScale: number[];
  labels: { id: string; name: string }[];
  members: { id: string; name: string; isAgent?: boolean }[];
  comments: { id: string; body: string; createdAt: string; authorName: string }[];
  tasks: { id: string; title: string; is_done: boolean }[];
  // Chronological status/column history from activity_logs (newest first).
  // `payload` is the raw activity_logs payload, shaped for describeActivity.
  history: { id: string; action: string; payload: unknown; actorName: string; actorIsAgent?: boolean; createdAt: string }[];
  // Candidate containers for the Parent picker (doc-18 §9): every other
  // top-level story in the project (parent_id IS NULL — a child can't be
  // re-parented onto, single-level nesting, §3). Picking a candidate whose
  // isContainer is false containerizes it (needs confirmation, §4/§9).
  parentCandidates: { id: string; number: number; title: string; isContainer: boolean }[];
  // Owner/member gate for "Turn into epic" (set_epic_pinned's own RPC-level
  // check, mirrored here so the menu item can be hidden rather than offered
  // and left to fail, doc-20 §2/TASK-196).
  viewerIsMember: boolean;
};

/**
 * Fetches everything the story detail UI needs (fields, comments, tasks).
 * Shared by the standalone `/stories/[id]` page and the board's inline
 * expansion (see spec/screens.md "Board layout") so the two stay in sync —
 * the inline panel calls this directly as a client-invoked server action.
 */
export async function getStoryDetail(storyId: string): Promise<StoryDetail | null> {
  const supabase = await createClient();

  const { data: story } = await supabase
    .from("stories")
    .select("*, story_labels(label_id)")
    .eq("id", storyId)
    .single();

  if (!story) {
    return null;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: project },
    { data: labels },
    { data: members },
    { data: comments },
    { data: tasks },
    { data: history },
    { data: statesData },
    { data: parentCandidateRows },
    { data: childRows },
    { data: iterationsData },
    { data: addChildCandidateRows },
  ] = await Promise.all([
      supabase
        .from("projects")
        .select("point_scale, custom_points, is_personal")
        .eq("id", story.project_id)
        .single(),
      supabase.from("labels").select("id, name").eq("project_id", story.project_id).order("name"),
      supabase
        .from("project_members")
        .select("user_id, role, profiles(display_name, is_agent)")
        .eq("project_id", story.project_id),
      supabase
        .from("comments")
        .select("id, body, created_at, author:profiles(display_name)")
        .eq("story_id", storyId)
        .order("created_at", { ascending: true }),
      supabase.from("tasks").select("id, title, is_done").eq("story_id", storyId).order("position"),
      // Status/column history only — comment.added already renders in the
      // comment thread, and letting it in would both duplicate it here and
      // let comments crowd real status changes out of the 50-row window.
      supabase
        .from("activity_logs")
        .select("id, action, payload, created_at, actor:profiles(display_name, is_agent)")
        .eq("story_id", storyId)
        .in("action", ["story.created", "story.state_changed", "story.column_changed"])
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("project_states")
        .select("id, project_id, name, action_label, category, position, created_at")
        .eq("project_id", story.project_id)
        .order("position"),
      // Parent picker candidates (doc-18 §9): every other top-level story in
      // the project — a story with its own parent is rejected by the
      // single-level trigger, so it's excluded here rather than surfaced as
      // an option that always errors.
      supabase
        .from("stories")
        .select("id, number, title, is_container")
        .eq("project_id", story.project_id)
        .is("parent_id", null)
        .neq("id", storyId)
        .order("number"),
      // The "Child stories" section (doc-20 §6) and childCount (doc-18 §8's
      // Delete ungroup notice) both only mean anything for a container — and
      // is_container is derived as `has_children OR epic_pinned`, so a
      // non-container provably has zero children. Skipping this query (and
      // the two below it, which only exist to classify/populate it) for the
      // common non-container case avoids 3 wasted round trips per story-detail
      // load (/code-review).
      story.is_container
        ? supabase
            .from("stories")
            .select("id, number, title, points, state_id, iteration_id, position")
            .eq("project_id", story.project_id)
            .eq("parent_id", storyId)
        : Promise.resolve({
            data: [] as {
              id: string;
              number: number;
              title: string;
              points: number | null;
              state_id: string | null;
              iteration_id: string | null;
              position: number;
            }[],
          }),
      // Just enough to derive the current iteration id for EpicChildRow's
      // location dot (doc-20 §3's "done wins over zone" rule) — same
      // derivation as board/page.tsx's own currentIteration.
      story.is_container
        ? supabase.from("iterations").select("id, number, state").eq("project_id", story.project_id)
        : Promise.resolve({ data: [] as { id: string; number: number; state: string }[] }),
      // Add-a-child candidates (doc-20 §6): a container can only ever adopt a
      // plain, still-parentless story (single-level nesting, doc-18 §3).
      story.is_container
        ? supabase
            .from("stories")
            .select("id, number, title")
            .eq("project_id", story.project_id)
            .is("parent_id", null)
            .eq("is_container", false)
            .neq("id", storyId)
            .order("number")
        : Promise.resolve({ data: [] as { id: string; number: number; title: string }[] }),
    ]);

  const viewerIsMember = (members ?? []).some(
    (m) => m.user_id === user?.id && (m.role === "owner" || m.role === "member"),
  );

  const currentIterationId = currentIterationOf(iterationsData ?? [])?.id ?? null;
  const states = (statesData ?? []) as ProjectState[];
  const categoryById = new Map(states.map((s) => [s.id, s.category]));
  const childRollup = buildContainerListItems(
    [{ id: story.id, number: story.number, title: story.title, epicColor: story.epic_color }],
    (childRows ?? []).map((c) => ({
      parentId: storyId,
      category: c.state_id ? (categoryById.get(c.state_id) ?? null) : null,
      points: c.points,
    })),
  )[0].rollup;
  const children =
    buildEpicBandChildren(
      (childRows ?? []).map((c) => ({
        id: c.id,
        parentId: storyId,
        number: c.number,
        title: c.title,
        points: c.points,
        stateId: c.state_id,
        iterationId: c.iteration_id,
        category: c.state_id ? (categoryById.get(c.state_id) ?? null) : null,
        position: c.position,
      })),
      currentIterationId,
    )[storyId] ?? [];

  return {
    id: story.id,
    projectId: story.project_id,
    isPersonalProject: project?.is_personal ?? false,
    number: story.number,
    title: story.title,
    description: story.description,
    storyType: story.story_type,
    stateId: story.state_id,
    states,
    points: story.points,
    parentId: story.parent_id,
    isContainer: story.is_container,
    childCount: (childRows ?? []).length,
    epicColor: story.epic_color,
    children,
    childRollup,
    addChildCandidates: (addChildCandidateRows ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
    })),
    assigneeId: story.assignee_id,
    labelIds: story.story_labels.map((sl) => sl.label_id),
    pointScale: pointScaleValues(project?.point_scale ?? "fibonacci", project?.custom_points),
    labels: labels ?? [],
    parentCandidates: (parentCandidateRows ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      isContainer: row.is_container,
    })),
    viewerIsMember,
    members: (members ?? []).map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return {
        id: m.user_id,
        name: profile?.display_name ?? m.user_id.slice(0, 8),
        isAgent: profile?.is_agent ?? false,
      };
    }),
    comments: (comments ?? []).map((comment) => {
      const author = Array.isArray(comment.author) ? comment.author[0] : comment.author;
      return {
        id: comment.id,
        body: comment.body,
        createdAt: comment.created_at,
        authorName: author?.display_name ?? "Unknown",
      };
    }),
    tasks: tasks ?? [],
    history: (history ?? []).map((entry) => {
      const actor = Array.isArray(entry.actor) ? entry.actor[0] : entry.actor;
      return {
        id: entry.id,
        action: entry.action,
        payload: entry.payload,
        actorName: actor?.display_name ?? "Someone",
        actorIsAgent: actor?.is_agent ?? false,
        createdAt: entry.created_at,
      };
    }),
  };
}

export type UpdateStoryInput = {
  storyId: string;
  title: string;
  description: string | null;
  storyType: string;
  points: number | null;
  parentId: string | null;
  assigneeId: string | null;
  labelIds: string[];
};

export type UpdateStoryFields = {
  title: string;
  description: string | null;
  storyType: string;
  points: number | null;
  parentId: string | null;
  assigneeId: string | null;
  labelIds: string[];
};

export type UpdateStoryResult =
  | { ok: true; story: UpdateStoryFields }
  // "not_found" covers both a genuinely deleted story and one RLS no longer
  // lets this caller update — the detail panel treats either as "this story
  // is no longer editable" (spec/screens.md "story was deleted" state).
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "error"; message: string };

/**
 * Autosave entry point for the story detail form (spec/screens.md
 * "Conflict & failure rules") — called directly from
 * `StoryDetailPanel`'s client-side save orchestrator, not a `<form action>`,
 * since each field save needs its own typed result rather than an
 * unstructured FormData throw. All validation (empty title, points against
 * the project's point scale) and the story_labels replace happen
 * transactionally inside the `update_story` RPC — see its migration for why.
 *
 * Never calls `revalidatePath`: the caller applies the returned row into its
 * own local state directly, and the board's inline cards/list pick up the
 * change through their existing `useProjectBoardRealtime` subscription —
 * forcing a fresh `detail` prop here would re-introduce a second channel
 * (alongside Realtime) that could clobber a field the user is still editing.
 */
export async function updateStory(input: UpdateStoryInput): Promise<UpdateStoryResult> {
  const supabase = await createClient();

  // The generated RPC Args type marks every parameter non-null — Postgres
  // function signatures have no NOT NULL annotation for the generator to
  // pick up the way table columns do, even though update_story's SQL body
  // accepts and handles null for each of these. The casts below are exactly
  // that known codegen gap, not a real non-null guarantee.
  const { data, error } = await supabase.rpc("update_story", {
    p_story_id: input.storyId,
    p_title: input.title,
    p_description: input.description as string,
    p_story_type: input.storyType,
    p_points: input.points as number,
    p_parent_id: input.parentId as string,
    p_assignee_id: input.assigneeId as string,
    p_label_ids: input.labelIds,
  });

  if (error) {
    return { ok: false, reason: "error", message: error.message };
  }

  const row = data?.[0];
  if (!row) {
    return { ok: false, reason: "not_found" };
  }

  return {
    ok: true,
    story: {
      title: row.title,
      description: row.description,
      storyType: row.story_type,
      points: row.points,
      parentId: row.parent_id,
      assigneeId: row.assignee_id,
      labelIds: row.label_ids ?? [],
    },
  };
}

export type MoveCopyTargetProject = { id: string; name: string };

/**
 * Projects the caller can Move/Copy a story into: owner/member of, excluding
 * the current one (spec/features.md "Move / Copy to another project" —
 * viewer isn't enough, matching the RPCs' own re-check). `project_members`
 * RLS scopes reads to any member of a project, not just the caller's own
 * row, so the caller's user id must be filtered explicitly here.
 */
export async function getMoveTargetProjects(currentProjectId: string): Promise<MoveCopyTargetProject[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return [];
  }

  const { data } = await supabase
    .from("project_members")
    .select("role, projects(id, name)")
    .eq("user_id", user.id)
    .in("role", ["owner", "member"])
    .neq("project_id", currentProjectId);

  return (data ?? [])
    .map((row) => (Array.isArray(row.projects) ? row.projects[0] : row.projects))
    .filter((project): project is MoveCopyTargetProject => project != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type MoveCopyResult =
  | { ok: true; projectId: string; storyId: string }
  | { ok: false; message: string };

async function transferStoryToProject(
  operation: "move" | "copy",
  storyId: string,
  targetProjectId: string,
): Promise<MoveCopyResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(`${operation}_story_to_project`, {
    p_story_id: storyId,
    p_target_project_id: targetProjectId,
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  const result = data as { story_id: string; project_id: string } | null;
  return result
    ? { ok: true, storyId: result.story_id, projectId: result.project_id }
    : { ok: false, message: `${operation === "move" ? "Move" : "Copy"} failed` };
}

/**
 * Moves a story to another project via the `move_story_to_project` RPC —
 * see its migration for the full atomicity/permission/carry-over design.
 */
export async function moveStoryToProject(storyId: string, targetProjectId: string): Promise<MoveCopyResult> {
  return transferStoryToProject("move", storyId, targetProjectId);
}

/** Copies a story to another project via the `copy_story_to_project` RPC. */
export async function copyStoryToProject(storyId: string, targetProjectId: string): Promise<MoveCopyResult> {
  return transferStoryToProject("copy", storyId, targetProjectId);
}

export type SplitChildInput = {
  title: string;
  description: string;
  storyType: string;
  points: number | null;
  taskIds: string[];
};

export type SplitStoryResult =
  | { ok: true; parentId: string; childIds: string[] }
  | { ok: false; message: string };

/**
 * Splits a story into child stories (Split Studio, doc-18 §6-§7) via the
 * `split_story` RPC — landing state/iteration, position, and points-scale
 * validation are all decided server-side; see the RPC's migration.
 */
export async function splitStory(storyId: string, children: SplitChildInput[]): Promise<SplitStoryResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("split_story", {
    p_story_id: storyId,
    p_children: children.map((c) => ({
      title: c.title,
      description: c.description,
      story_type: c.storyType,
      points: c.points,
      task_ids: c.taskIds,
    })),
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const result = data as { parent_id: string; child_ids: string[] } | null;
  if (!result) {
    return { ok: false, message: "Split failed" };
  }

  return { ok: true, parentId: result.parent_id, childIds: result.child_ids };
}

export type TurnIntoEpicResult = { ok: true } | { ok: false; message: string };

/**
 * "Turn into epic" (story detail overflow menu, doc-20 §2/TASK-196): pins an
 * existing childless story as a container via `set_epic_pinned`. The RPC
 * itself clears points/state/iteration and audits the lost points — this
 * only calls it and lets the caller re-fetch the story.
 */
export async function turnIntoEpic(storyId: string, projectId: string): Promise<TurnIntoEpicResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_epic_pinned", { p_story_id: storyId, p_pinned: true });
  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/stories/${storyId}`);
  revalidatePath(`/projects/${projectId}/board`);
  return { ok: true };
}

export async function addComment(formData: FormData): Promise<ActionResult> {
  const storyId = String(formData.get("story_id"));
  const projectId = String(formData.get("project_id"));
  const body = String(formData.get("body") ?? "").trim();

  if (!body) {
    return { ok: true };
  }

  const supabase = await createClient();
  // author_id defaults to auth.uid() (see comments migration); a trigger
  // records the comment.added activity log entry.
  const { error } = await supabase.from("comments").insert({ story_id: storyId, body });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/stories/${storyId}`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function addTask(formData: FormData): Promise<ActionResult> {
  const storyId = String(formData.get("story_id"));
  const title = String(formData.get("title") ?? "").trim();

  if (!title) {
    return { ok: true };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({ story_id: storyId, title });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath(`/stories/${storyId}`);
  return { ok: true };
}

export async function toggleTask(formData: FormData): Promise<ActionResult> {
  const taskId = String(formData.get("task_id"));
  const storyId = String(formData.get("story_id"));
  const isDone = formData.get("is_done") === "true";

  const supabase = await createClient();
  try {
    await assertRowAffected(
      await supabase.from("tasks").update({ is_done: !isDone }).eq("id", taskId).select("id"),
    );
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to update task",
    };
  }

  revalidatePath(`/stories/${storyId}`);
  return { ok: true };
}

export async function deleteTask(formData: FormData): Promise<ActionResult> {
  const taskId = String(formData.get("task_id"));
  const storyId = String(formData.get("story_id"));

  const supabase = await createClient();
  try {
    await assertRowAffected(await supabase.from("tasks").delete().eq("id", taskId).select("id"));
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to delete task",
    };
  }

  revalidatePath(`/stories/${storyId}`);
  return { ok: true };
}

export async function deleteStory(formData: FormData) {
  const id = String(formData.get("story_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  await assertRowAffected(await supabase.from("stories").delete().eq("id", id).select("id"));

  revalidatePath(`/projects/${projectId}/board`);
  redirect(`/projects/${projectId}/board`);
}
