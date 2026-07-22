// The one board helper that depends on @dnd-kit, split out of board.ts so
// that module stays importable from Server Components (board/page.tsx,
// iterations/page.tsx) without pulling a browser-only dependency into the
// server bundle.

import { arrayMove } from "@dnd-kit/sortable";

/**
 * Moves the item `activeId` to sit where `overId` currently sits — the same
 * single-element relocation dnd-kit's own `arrayMove` performs, exposed as
 * a helper so callers always run it against a container's *full*,
 * unfiltered item list. `activeId`/`overId` only ever come from
 * currently-rendered (visible) rows, but indexing into the full list still
 * finds them correctly, and relocating just the dragged item leaves every
 * other item — hidden by an active filter or not — in the same relative
 * order, so no two rows can ever collide on the dense position written
 * afterwards.
 */
export function reorderContainer<T extends { id: string }>(
  items: ReadonlyArray<T>,
  activeId: string,
  overId: string,
): T[] {
  const oldIndex = items.findIndex((item) => item.id === activeId);
  const newIndex = items.findIndex((item) => item.id === overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return [...items];
  }
  return arrayMove([...items], oldIndex, newIndex);
}

/**
 * Same relocation as `reorderContainer`, for a plain array of ids — My
 * Work's column display order (TASK-148) isn't `{id}[]`-shaped, it's the bare
 * slot-id sequence itself.
 */
export function reorderIds(ids: ReadonlyArray<string>, activeId: string, overId: string): string[] {
  const oldIndex = ids.indexOf(activeId);
  const newIndex = ids.indexOf(overId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return [...ids];
  }
  return arrayMove([...ids], oldIndex, newIndex);
}
