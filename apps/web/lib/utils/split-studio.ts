// Pure, framework-free state transitions for the Split Studio's right-pane
// child cards (doc-18 §7, spec/screens.md "Split Studio"). `id` is a
// client-side-only key (never sent to split_story — the RPC assigns real
// story ids on commit) so React keys and drop targets stay stable across
// edits without needing the eventual server id.

export type SplitChildDraft = {
  id: string;
  title: string;
  description: string;
  storyType: string;
  points: number | null;
  /** Ids of source tasks (TaskData.id) reassigned to this child. */
  taskIds: string[];
};

function newChild(description = ""): SplitChildDraft {
  return { id: crypto.randomUUID(), title: "", description, storyType: "feature", points: null, taskIds: [] };
}

/** Appends a blank child card ("+ new story"). */
export function addChild(children: SplitChildDraft[]): SplitChildDraft[] {
  return [...children, newChild()];
}

/** Appends a child seeded from a left-pane description text selection. */
export function addChildFromSelection(children: SplitChildDraft[], selectedText: string): SplitChildDraft[] {
  const trimmed = selectedText.trim();
  if (!trimmed) {
    return children;
  }
  return [...children, newChild(trimmed)];
}

export function removeChild(children: SplitChildDraft[], id: string): SplitChildDraft[] {
  return children.filter((c) => c.id !== id);
}

export function updateChild(
  children: SplitChildDraft[],
  id: string,
  patch: Partial<Omit<SplitChildDraft, "id" | "taskIds">>,
): SplitChildDraft[] {
  return children.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/**
 * Moves `taskId` onto `targetChildId` — removed from whichever child (if any)
 * currently holds it first, so a task is always assigned to at most one
 * child regardless of how many times it's dragged around.
 */
/** Drops `taskId` back onto the source (left pane) — unassigns it from any child. */
export function unassignTask(children: SplitChildDraft[], taskId: string): SplitChildDraft[] {
  return children.map((c) => (c.taskIds.includes(taskId) ? { ...c, taskIds: c.taskIds.filter((t) => t !== taskId) } : c));
}

export function assignTaskToChild(
  children: SplitChildDraft[],
  taskId: string,
  targetChildId: string,
): SplitChildDraft[] {
  return unassignTask(children, taskId).map((c) =>
    c.id === targetChildId && !c.taskIds.includes(taskId) ? { ...c, taskIds: [...c.taskIds, taskId] } : c,
  );
}

/** The drop-target id for the left pane's own task list (drag a task back to un-assign it). */
export const SOURCE_TASKS_DROP_ID = "split-studio-source-tasks";

/**
 * Routes a dnd-kit DragEndEvent's (active, over) pair to the right pure
 * transition — a child id assigns, SOURCE_TASKS_DROP_ID un-assigns, no drop
 * target (dropped outside any droppable) is a no-op.
 */
export function applyTaskDrop(
  children: SplitChildDraft[],
  taskId: string,
  overId: string | null,
): SplitChildDraft[] {
  if (overId === null) {
    return children;
  }
  if (overId === SOURCE_TASKS_DROP_ID) {
    return unassignTask(children, taskId);
  }
  return assignTaskToChild(children, taskId, overId);
}
