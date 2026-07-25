import { rollupContainer, type ContainerRollup, type RollupChild, type StateCategory } from "@storylane/core";

// The dropped epics table's own default (kept as the fallback so a
// colorless container still gets a consistent identity) — shared by /epics
// and the List view's Epics band so both fall back to the same color.
export const DEFAULT_EPIC_COLOR = "#6366f1";

export type ContainerRow = { id: string; number: number; title: string; epicColor: string | null };
export type ContainerChild = { parentId: string; category: StateCategory | null; points: number | null };

export type ContainerListItem = ContainerRow & { rollup: ContainerRollup };

/**
 * Groups every child by its parent and rolls each container up independently
 * (packages/core rollupContainer, doc-18 §5) — every child, any zone, so the
 * roll-up never changes as a child gets scheduled (doc-20 §3, defect 3).
 * Shared by `/epics` and the List view's Epics band. `containers` is expected
 * pre-sorted by position (the caller's query order) — this function only
 * groups/rolls, it never reorders.
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

// The List view's Epics band location dot (doc-20 §3): "done" wins over
// zone (an accepted current-iteration child reads as Done, not Current).
export type BandChildLocation = "current" | "backlog" | "icebox" | "done";

const BAND_LOCATION_RANK: Record<BandChildLocation, number> = { current: 0, backlog: 1, icebox: 2, done: 3 };

export type EpicBandChildInput = {
  id: string;
  parentId: string;
  number: number;
  title: string;
  points: number | null;
  stateId: string | null;
  iterationId: string | null;
  isDone: boolean;
  position: number;
};

export type EpicBandChild = { id: string; number: number; title: string; points: number | null; location: BandChildLocation };

function bandChildLocation(
  child: Pick<EpicBandChildInput, "stateId" | "iterationId" | "isDone">,
  currentIterationId: string | null,
): BandChildLocation {
  if (child.isDone) return "done";
  if (child.stateId === null) return "icebox";
  if (currentIterationId && child.iterationId === currentIterationId) return "current";
  return "backlog";
}

/**
 * Every container's children, any zone, grouped by parent for the List
 * view's Epics band (doc-20 §3). `position` is scoped per zone (spec/
 * data-model.md "Position ordering invariant"), not one sequence comparable
 * across zones — so children are grouped by location first and only sorted
 * by position within that group, never compared across it. Built from the
 * same unfiltered query as `buildContainerListItems`' rollup (every child,
 * any zone — not the board's zone-filtered story lists), so a child whose
 * iteration later finalizes and rolls off the board still shows here
 * instead of silently vanishing from its epic (the defect doc-20 §3 fixes,
 * reappearing for a different reason if this read the filtered lists).
 */
export function buildEpicBandChildren(
  children: ReadonlyArray<EpicBandChildInput>,
  currentIterationId: string | null,
): Record<string, EpicBandChild[]> {
  const byEpic = new Map<string, { rank: number; position: number; child: EpicBandChild }[]>();
  for (const c of children) {
    const location = bandChildLocation(c, currentIterationId);
    const entry = {
      rank: BAND_LOCATION_RANK[location],
      position: c.position,
      child: { id: c.id, number: c.number, title: c.title, points: c.points, location },
    };
    const bucket = byEpic.get(c.parentId);
    if (bucket) bucket.push(entry);
    else byEpic.set(c.parentId, [entry]);
  }

  const result: Record<string, EpicBandChild[]> = {};
  for (const [epicId, bucket] of byEpic) {
    result[epicId] = bucket.sort((a, b) => a.rank - b.rank || a.position - b.position).map((entry) => entry.child);
  }
  return result;
}
