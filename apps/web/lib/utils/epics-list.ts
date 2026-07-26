import { rollupContainer, type ContainerRollup, type RollupChild, type StateCategory } from "@storylane/core";
import { zoneForStory } from "./kanban";

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

// The List view's Epics band location dot (doc-20 §3): "done" and "rejected"
// both win over zone (an accepted or rejected current-iteration child reads
// as its own terminal state, not Current) — kept as two distinct dots rather
// than folding rejected into done, since they are separate categories
// everywhere else in the app (lib/utils/stories.ts, kanban-columns-board.tsx)
// and interleaving a bounced story with finished ones would misreport
// progress at a glance (ux-principles principle 9).
export type BandChildLocation = "current" | "backlog" | "icebox" | "done" | "rejected";

// Ranks the story's underlying ZONE, never its display location — a done or
// rejected child still physically lives in current/backlog/icebox's position
// sequence (done/rejected always implies a non-null state_id, so never
// icebox in practice, but the type doesn't promise that). Ranking by
// BandChildLocation instead would put every done/rejected child in one
// bucket and sort it by raw position regardless of which sequence that
// position came from — exactly the cross-zone comparison this function's own
// doc comment says never to make. Zone rank, not display label, keeps a
// current-iteration accept from being compared against a since-finalized
// iteration's accept.
const BAND_ZONE_RANK: Record<"current" | "backlog" | "icebox", number> = { current: 0, backlog: 1, icebox: 2 };

export type EpicBandChildInput = {
  id: string;
  parentId: string;
  number: number;
  title: string;
  points: number | null;
  stateId: string | null;
  iterationId: string | null;
  // The child's own state category (null for Icebox) — done/rejected both
  // short-circuit the zone lookup below, since either is a terminal state
  // regardless of which zone the story physically still sits in.
  category: StateCategory | null;
  position: number;
};

export type EpicBandChild = { id: string; number: number; title: string; points: number | null; location: BandChildLocation };

function bandChildZone(
  child: Pick<EpicBandChildInput, "stateId" | "iterationId">,
  currentIterationId: string | null,
): "current" | "backlog" | "icebox" {
  // zoneForStory (kanban.ts) is the single source of truth for icebox/
  // current/backlog classification — only its state_id/iteration_id fields
  // matter, so story_type/points here are dummy values.
  return zoneForStory({ state_id: child.stateId, iteration_id: child.iterationId, story_type: "", points: null }, currentIterationId);
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
    const zone = bandChildZone(c, currentIterationId);
    const location: BandChildLocation = c.category === "done" ? "done" : c.category === "rejected" ? "rejected" : zone;
    const entry = {
      rank: BAND_ZONE_RANK[zone],
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
