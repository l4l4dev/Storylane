import { rollupContainer, type ContainerRollup, type RollupChild, type StateCategory } from "@storylane/core";

// The dropped epics table's own default (kept as the fallback so a
// colorless container still gets a consistent identity) — shared by /epics
// and the List view's Icebox accordion so both fall back to the same color.
export const DEFAULT_EPIC_COLOR = "#6366f1";

export type ContainerRow = { id: string; number: number; title: string; epicColor: string | null };
export type ContainerChild = { parentId: string; category: StateCategory | null; points: number | null };

export type ContainerListItem = ContainerRow & { rollup: ContainerRollup };

/**
 * The `/epics` container list (doc-18 §9): groups every child by its parent
 * and rolls each container up independently (packages/core rollupContainer,
 * doc-18 §5). `containers` is expected pre-sorted by number (the caller's
 * query order) — this function only groups/rolls, it never reorders.
 */
export function buildContainerListItems(
  containers: ReadonlyArray<ContainerRow>,
  children: ReadonlyArray<ContainerChild>,
): ContainerListItem[] {
  const childrenByParent = new Map<string, RollupChild[]>();
  for (const child of children) {
    const entry: RollupChild = { category: child.category, points: child.points };
    const bucket = childrenByParent.get(child.parentId);
    if (bucket) bucket.push(entry);
    else childrenByParent.set(child.parentId, [entry]);
  }

  return containers.map((container) => ({
    ...container,
    rollup: rollupContainer(childrenByParent.get(container.id) ?? []),
  }));
}

export type AccordionChild = ContainerChild & { id: string; stateId: string | null; position: number };
export type ContainerAccordionRow = ContainerListItem & {
  /** This container's Icebox children (stateId null) only, sorted by
   * position — the ones nested under this row's accordion in the List view
   * (doc-18 §9). A child with a state stays in its own zone (Current/
   * Backlog), unaffected — it's still counted in `rollup` above, just not
   * nested here. */
  iceboxChildIds: string[];
};

/**
 * The List view's Icebox accordion rows (doc-18 §9): each container's full
 * roll-up (every child, any zone — reuses buildContainerListItems) plus just
 * its Icebox children's ids for nesting under the row.
 */
export function buildContainerAccordionRows(
  containers: ReadonlyArray<ContainerRow>,
  children: ReadonlyArray<AccordionChild>,
): ContainerAccordionRow[] {
  const rolledUp = buildContainerListItems(containers, children);

  const iceboxByParent = new Map<string, AccordionChild[]>();
  for (const child of children) {
    if (child.stateId === null) {
      const bucket = iceboxByParent.get(child.parentId);
      if (bucket) bucket.push(child);
      else iceboxByParent.set(child.parentId, [child]);
    }
  }

  return rolledUp.map((item) => ({
    ...item,
    iceboxChildIds: (iceboxByParent.get(item.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((c) => c.id),
  }));
}
