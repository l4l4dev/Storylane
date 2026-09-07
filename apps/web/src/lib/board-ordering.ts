export interface ColumnView {
  stateId: string | null;
  storyIds: string[];
}

export function columnOf(columns: ColumnView[], storyId: string): ColumnView | undefined {
  return columns.find((column) => column.storyIds.includes(storyId));
}

export function orderedIdsFor(columns: ColumnView[], stateId: string | null): string[] {
  return columns.find((column) => column.stateId === stateId)?.storyIds ?? [];
}

/**
 * The whole drop computed in one place, so the optimistic board and the `orderedIds` the
 * server is sent can never disagree. Returns a fresh array; an unknown story or target column
 * yields the input unchanged (the caller then has nothing to send).
 */
export function moveStoryTo(
  columns: ColumnView[],
  storyId: string,
  targetStateId: string | null,
  targetIndex: number,
): ColumnView[] {
  const source = columnOf(columns, storyId);
  const target = columns.find((column) => column.stateId === targetStateId);
  if (!source || !target) return columns.map((column) => ({ ...column, storyIds: [...column.storyIds] }));
  const next = columns.map((column) => ({
    ...column,
    storyIds: column.storyIds.filter((id) => id !== storyId),
  }));
  const destination = next.find((column) => column.stateId === targetStateId)!;
  const index = Math.max(0, Math.min(targetIndex, destination.storyIds.length));
  destination.storyIds.splice(index, 0, storyId);
  return next;
}
