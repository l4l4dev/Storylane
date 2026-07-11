"use client";

import { Fragment, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Snowflake, X } from "lucide-react";
import {
  createBacklogDivider,
  deleteBacklogDivider,
  dropStoryInList,
  upsertIterationGoal,
} from "@/app/projects/[id]/board/actions";
import { findContainer, reorderContainer, storyById, sumPoints } from "@/lib/utils/board";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  evaluateListDrop,
  flattenCurrentZone,
  zoneForStory,
  type ListZoneId,
} from "@/lib/utils/kanban";
import {
  buildBacklogRows,
  projectedIterationDates,
  type BacklogDivider,
  type BacklogRow,
  type BacklogRowItem,
} from "@/lib/utils/iterations";
import { matchesStoryFilter, type StoryFilter } from "@/lib/utils/stories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MutationErrorBanner } from "./mutation-error-banner";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryListRow } from "./story-list-row";
import type { BoardStory, IterationMeta } from "./kanban-board";

// Collapse state for the Backlog's virtual-iteration groups and the Current
// section's own header (spec/screens.md "Backlog groups": "Collapse
// state persists per user in localStorage"). Keyed by group number
// (stringified) or the literal "current". A lazy useState initializer reads
// localStorage once on mount; the usual SSR/client hydration mismatch this
// causes for client-only UI prefs is accepted (collapse doesn't affect any
// SSR'd content's correctness, just first-paint state).
function collapseStorageKey(projectId: string): string {
  return `storylane:backlog-collapse:${projectId}`;
}

function readCollapsedGroups(projectId: string): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(collapseStorageKey(projectId));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function useCollapsedGroups(projectId: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedGroups(projectId));

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        window.localStorage.setItem(collapseStorageKey(projectId), JSON.stringify([...next]));
      } catch {
        // localStorage unavailable (private browsing, quota) — collapse
        // state just won't persist across reloads this session.
      }
      return next;
    });
  }

  return { collapsed, toggle };
}

// Internal drag item for the List view's zones. Current/Icebox only ever
// hold `kind: "story"`; only Backlog can also hold `kind: "divider"` (Task
// 15 follow-up: freeform planning rows, spec/screens.md "Board layout: List
// view"). A shared `id` at the top level (rather than nested under
// `story`/`divider`) lets the generic `findContainer`/`storyById` helpers
// (from lib/utils/board, shared with the Kanban view) work uniformly.
type ListItem =
  | { kind: "story"; id: string; story: BoardStory }
  | { kind: "divider"; id: string; divider: BacklogDivider };

function wrapStory(story: BoardStory): ListItem {
  return { kind: "story", id: story.id, story };
}

function toListItemContainers(
  source: Record<string, BoardStory[]>,
  backlogItems: ReadonlyArray<BacklogRowItem<BoardStory>>,
): Record<string, ListItem[]> {
  return {
    [ICEBOX_COLUMN_ID]: (source[ICEBOX_COLUMN_ID] ?? []).map(wrapStory),
    // Flattened by `position`, not by state — the List view's
    // current zone is one flat, priority-ordered list spanning every state
    // (see spec/screens.md "List view"); concatenating the physical Kanban
    // columns in state order would bucket by state instead.
    current: flattenCurrentZone(source).map(wrapStory),
    [BACKLOG_COLUMN_ID]: backlogItems.map((item) =>
      item.kind === "story" ? wrapStory(item.story) : { kind: "divider", id: item.divider.id, divider: item.divider },
    ),
  };
}

// The whole row is the drag handle, same convention as the Kanban view's
// cards — plain clicks still open the side peek since dnd-kit only takes
// over past the pointer's activation distance. Used by the Current/Icebox
// sections, which only ever hold stories — the Backlog section uses
// `SortableBacklogRow` instead since it also renders notes/iteration breaks.
function SortableListRow({ item, projectId }: { item: ListItem; projectId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const className = `cursor-grab active:cursor-grabbing ${isDragging ? "opacity-60" : ""}`;

  return (
    <li ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {item.kind === "divider" ? (
        <DividerRow projectId={projectId} divider={item.divider} />
      ) : (
        <StoryListRow story={item.story} projectId={projectId} />
      )}
    </li>
  );
}

// A freeform planning row: dashed border, muted label, delete button. Used
// for both a user-created note (its own typed label) and a manual iteration
// break (fixed "Iteration break" label) — unified into one flush-left
// divider style (spec/screens.md "Indent distinction": "note/
// divider labels start flush at the list's left edge"); the break's own
// number now lives on the `IterationHeaderRow` that follows it, not here.
function DividerRow({ projectId, divider }: { projectId: string; divider: BacklogDivider }) {
  const [, startTransition] = useTransition();
  const label = divider.kind === "note" ? divider.label : "Iteration break";

  function handleDelete() {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("divider_id", divider.id);
    startTransition(() => {
      void deleteBacklogDivider(formData);
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-1.5">
      <span className="flex-1 truncate text-sm font-medium text-muted-foreground">{label}</span>
      <Button type="button" variant="ghost" size="icon-xs" onClick={handleDelete} aria-label={`Remove "${label}"`}>
        <X />
      </Button>
    </div>
  );
}

// Inline-editable goal for a virtual (not-yet-real) iteration
// (spec/screens.md "Backlog groups": "commits on Enter like the iteration
// bar's"). Enter is awaited and its failure caught here — never a
// fire-and-forget `void` call — so a rejected save shows an inline error
// and keeps what was typed instead of silently reverting. Esc reverts to
// the last server-confirmed value without saving.
function IterationGoalInput({
  projectId,
  number,
  initialGoal,
}: {
  projectId: string;
  number: number;
  initialGoal: string;
}) {
  const [value, setValue] = useState(initialGoal);
  const [synced, setSynced] = useState(initialGoal);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (synced !== initialGoal) {
    setSynced(initialGoal);
    setValue(initialGoal);
    setError(null);
  }

  async function commit() {
    const trimmed = value.trim();
    if (trimmed === synced) {
      return;
    }
    setError(null);
    setIsSaving(true);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("number", String(number));
    formData.set("goal", trimmed);
    try {
      await upsertIterationGoal(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save goal");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setValue(synced);
            setError(null);
          }
        }}
        placeholder="Goal"
        aria-label={`Iteration #${number} goal`}
        disabled={isSaving}
        className="h-6 min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 text-xs hover:border-border focus:border-border focus:outline-none disabled:opacity-60"
      />
      {error && <span className="shrink-0 text-destructive">{error}</span>}
    </div>
  );
}

// A virtual-iteration group header — always precedes its group's rows,
// even for the very first (or a lone, never-split) group, and even when
// empty. Heading every group up front, rather than only once a *later*
// story crosses into the next one, is what keeps the first — and a final
// — group from rendering with no label at all. Not draggable: there's no
// backlog_dividers row behind it, only `buildBacklogRows`' derived
// number/points.
function IterationHeaderRow({
  number,
  points,
  projectId,
  goal,
  projectedDates,
  collapsed,
  onToggle,
}: {
  number: number;
  points: number;
  projectId: string;
  goal: string;
  projectedDates: { start_date: string; end_date: string } | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? `Expand iteration #${number}` : `Collapse iteration #${number}`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        <span className="shrink-0 font-medium text-foreground">Iteration #{number}</span>
        {projectedDates && (
          <span className="shrink-0">
            {projectedDates.start_date} – {projectedDates.end_date}
          </span>
        )}
        <IterationGoalInput projectId={projectId} number={number} initialGoal={goal} />
        <span className="shrink-0">{points} pts</span>
      </div>
    </li>
  );
}

// A draggable Backlog row: a story, a note, or a manually-placed iteration
// break — every one of these has a real backing row (a story or a
// `backlog_dividers` entry), so it can be reordered and deleted like any
// other item. `iteration-header` rows are never passed here — they render
// directly via `IterationHeaderRow` instead (see `BacklogSection`).
// Indent distinction (spec/screens.md): story rows sit slightly right of
// note/iteration-break dividers, which stay flush at the left edge.
function SortableBacklogRow({
  row,
  projectId,
}: {
  row: Extract<BacklogRow<BoardStory>, { kind: "story" | "note" | "iteration-break" }>;
  projectId: string;
}) {
  const dragId = row.kind === "story" ? row.story.id : row.divider.id;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dragId });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const className = `cursor-grab active:cursor-grabbing ${row.kind === "story" ? "pl-3" : ""} ${isDragging ? "opacity-60" : ""}`;

  return (
    <li ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>
      {row.kind === "story" ? (
        <StoryListRow story={row.story} projectId={projectId} />
      ) : (
        <DividerRow projectId={projectId} divider={row.divider} />
      )}
    </li>
  );
}

// Hover-revealed "insert a line here" affordance between two adjacent
// Backlog rows — appending then dragging into place wasn't discoverable
// enough. `beforeItemId` is a `"story:<id>"` / `"divider:<id>"`
// pair identifying the exact spot server-side (see board/actions.ts
// "createBacklogDivider"); `null` means "at the end".
function InsertBetweenRows({ projectId, beforeItemId }: { projectId: string; beforeItemId: string | null }) {
  const [addingNote, setAddingNote] = useState(false);
  const [label, setLabel] = useState("");
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("label", trimmed);
    formData.set("kind", "note");
    if (beforeItemId) {
      formData.set("before_item_id", beforeItemId);
    }
    setLabel("");
    setAddingNote(false);
    startTransition(() => {
      void createBacklogDivider(formData);
    });
  }

  function insertIterationBreak() {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("kind", "iteration_break");
    if (beforeItemId) {
      formData.set("before_item_id", beforeItemId);
    }
    startTransition(() => {
      void createBacklogDivider(formData);
    });
  }

  if (addingNote) {
    return (
      <li className="py-0.5">
        <form onSubmit={submitNote}>
          <Input
            ref={inputRef}
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLabel("");
                setAddingNote(false);
              }
            }}
            onBlur={() => {
              if (!label.trim()) {
                setAddingNote(false);
              }
            }}
            placeholder="Divider label — Enter to add"
            aria-label="New divider label"
            className="h-7 bg-card text-xs"
          />
        </form>
      </li>
    );
  }

  return (
    <li className="group/insert relative -my-1 h-2 shrink-0">
      <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/insert:opacity-100">
        <span className="h-px flex-1 bg-border" />
        <button
          type="button"
          onClick={() => setAddingNote(true)}
          className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          + Note
        </button>
        <button
          type="button"
          onClick={insertIterationBreak}
          className="rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          + Iteration break
        </button>
        <span className="h-px flex-1 bg-border" />
      </div>
    </li>
  );
}

// One zone's section: a title/point-sum header, an optional quick-add
// composer, and a flat sortable list — no independent scroll, no fixed
// width, unlike a Kanban column (this is the point: everything reads as one
// continuous list, see spec/screens.md "Board layout: List view").
function ListSection({
  zoneId,
  title,
  items,
  projectId,
  composer,
  collapsed,
  onToggleCollapse,
}: {
  zoneId: string;
  title: ReactNode;
  items: ListItem[];
  projectId: string;
  composer?: ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: zoneId });

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand" : "Collapse"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        {title}
        {composer}
        <span className="h-px flex-1 bg-border" />
      </header>
      {/* Kept mounted (not conditionally rendered) even while collapsed —
          dnd-kit's droppable ref must stay registered so a story can still
          be dropped into this zone. */}
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className={`flex min-h-10 flex-col gap-1.5 ${collapsed ? "hidden" : ""}`}>
          {items.map((item) => (
            <SortableListRow key={item.id} item={item} projectId={projectId} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

// A stable React key for a backlog row.
function rowKey(row: BacklogRow<BoardStory>, index: number): string {
  if (row.kind === "story") {
    return row.story.id;
  }
  if (row.kind === "note" || row.kind === "iteration-break") {
    return row.divider.id;
  }
  return `header-${row.number}-${index}`;
}

// Finds the id (`"story:<id>"` / `"divider:<id>"`) of the next *real* row at
// or after `fromIndex` — skipping over header rows, which aren't stored
// rows and so have nothing to anchor an insertion to. `null` means "insert
// at the end" (no real row follows).
function nextRealRowId(rows: BacklogRow<BoardStory>[], fromIndex: number): string | null {
  for (let i = fromIndex; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "story") {
      return `story:${row.story.id}`;
    }
    if (row.kind === "note" || row.kind === "iteration-break") {
      return `divider:${row.divider.id}`;
    }
  }
  return null;
}

// Backlog section: rows come from `buildBacklogRows`, which interleaves
// numbered virtual-iteration headers, freeform notes, and manual iteration
// breaks with the stories in one flat sortable list — a drag across any of
// them is an ordinary reorder. A hover-revealed insert affordance sits
// between every pair of rows so a note or break can be placed at an exact
// spot instead of appended-then-dragged.
function BacklogSection({
  items,
  velocity,
  startingIterationNumber,
  projectId,
  filter,
  iterationGoals,
  projectedDatesFor,
  collapsedGroups,
  onToggleGroup,
  composer,
}: {
  // Full, unfiltered backlog (stories + dividers) — the virtual-iteration
  // groups/point sums/dates below must reflect the true backlog regardless
  // of `filter`, which only decides which *rows* get rendered.
  items: ListItem[];
  velocity: number;
  startingIterationNumber: number;
  projectId: string;
  filter: StoryFilter;
  iterationGoals: Record<number, string>;
  projectedDatesFor: (iterationNumber: number) => { start_date: string; end_date: string } | null;
  collapsedGroups: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  composer?: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: BACKLOG_COLUMN_ID });

  const rowItems: BacklogRowItem<BoardStory>[] = items.map((item) =>
    item.kind === "story" ? { kind: "story", story: item.story } : { kind: "divider", divider: item.divider },
  );
  const rows = buildBacklogRows(rowItems, velocity, startingIterationNumber);

  // A story/note row is hidden while its group is collapsed, or (a story
  // only) while it doesn't match the active filter. Headers and
  // break rows always render — collapsing only hides a group's *contents*,
  // and a break stays visible/deletable regardless of either neighbor's
  // group state.
  let currentGroupCollapsed = false;
  const visibleRowIds = new Set<string>();
  for (const row of rows) {
    if (row.kind === "iteration-header") {
      currentGroupCollapsed = collapsedGroups.has(String(row.number));
      continue;
    }
    if (row.kind === "iteration-break") {
      visibleRowIds.add(row.divider.id);
      continue;
    }
    if (currentGroupCollapsed) {
      continue;
    }
    if (row.kind === "story" && !matchesStoryFilter(row.story, filter)) {
      continue;
    }
    visibleRowIds.add(row.kind === "story" ? row.story.id : row.divider.id);
  }

  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Backlog</span>
        {composer}
        <span className="h-px flex-1 bg-border" />
      </header>
      <SortableContext items={[...visibleRowIds]} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-col gap-1.5">
          <InsertBetweenRows projectId={projectId} beforeItemId={nextRealRowId(rows, 0)} />
          {rows.map((row, index) => {
            if (row.kind === "iteration-header") {
              const key = String(row.number);
              return (
                <Fragment key={rowKey(row, index)}>
                  <IterationHeaderRow
                    number={row.number}
                    points={row.points}
                    projectId={projectId}
                    goal={iterationGoals[row.number] ?? ""}
                    projectedDates={projectedDatesFor(row.number)}
                    collapsed={collapsedGroups.has(key)}
                    onToggle={() => onToggleGroup(key)}
                  />
                  <InsertBetweenRows projectId={projectId} beforeItemId={nextRealRowId(rows, index + 1)} />
                </Fragment>
              );
            }

            const id = row.kind === "story" ? row.story.id : row.divider.id;
            return (
              <Fragment key={rowKey(row, index)}>
                {visibleRowIds.has(id) && <SortableBacklogRow row={row} projectId={projectId} />}
                <InsertBetweenRows projectId={projectId} beforeItemId={nextRealRowId(rows, index + 1)} />
              </Fragment>
            );
          })}
        </ul>
      </SortableContext>
    </section>
  );
}

// Icebox rendered as its own narrow side column rather than an inline
// stacked section — it's a pre-triage parking lot, not part
// of the priority order, so keeping it out of the main list lets the PO
// focus purely on Current/Backlog priority (see spec/screens.md "Board
// layout: List view").
function IceboxColumn({ items, projectId }: { items: ListItem[]; projectId: string }) {
  const { setNodeRef } = useDroppable({ id: ICEBOX_COLUMN_ID });

  return (
    <section className="flex h-[calc(100dvh-13rem)] w-72 shrink-0 flex-col rounded-lg border border-border bg-sky-50/50 dark:bg-sky-950/20">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Snowflake className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
        <h2 className="text-sm font-semibold">Icebox</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
        <span className="ml-auto">
          <QuickAddComposer projectId={projectId} target="icebox" compact />
        </span>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-1.5">
            {items.map((item) => (
              <SortableListRow key={item.id} item={item} projectId={projectId} />
            ))}
          </ul>
        </SortableContext>
      </div>
    </section>
  );
}

// List view (see spec/screens.md "Board layout: List view" — Pivotal
// Tracker parity): the current iteration and the backlog render as one
// continuous, priority-ordered list segmented by iteration lines, instead of
// the Kanban view's physical per-state columns. State renders as a badge on
// each row (`StoryListRow`); one-click transition buttons replace
// drag-to-transition since there's no column to drop onto.
export function BoardListView({
  projectId,
  currentIteration,
  initialContainers,
  initialBacklogItems,
  velocity,
  nextVirtualIterationNumber,
  iterationLength,
  iterationGoals,
  showIcebox,
  filter,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  // Unfiltered — see `filter` below, applied only at render.
  initialContainers: Record<string, BoardStory[]>;
  // Backlog stories and freeform planning rows, pre-merged and ordered
  // server-side (see board/page.tsx) since only the server has both tables'
  // raw `position` values needed to interleave them correctly.
  initialBacklogItems: BacklogRowItem<BoardStory>[];
  velocity: number;
  nextVirtualIterationNumber: number;
  // Projected dates and draft goals for the Backlog's virtual-iteration
  // group headers — `iterationGoals` is pre-scoped server-side to numbers
  // above the current iteration's.
  iterationLength: number;
  iterationGoals: Record<number, string>;
  showIcebox: boolean;
  filter: StoryFilter;
}) {
  const [containers, setContainers] = useState(() => toListItemContainers(initialContainers, initialBacklogItems));
  const [synced, setSynced] = useState(initialContainers);
  const [syncedBacklogItems, setSyncedBacklogItems] = useState(initialBacklogItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { collapsed: collapsedGroups, toggle: onToggleGroup } = useCollapsedGroups(projectId);

  if (synced !== initialContainers || syncedBacklogItems !== initialBacklogItems) {
    setSynced(initialContainers);
    setSyncedBacklogItems(initialBacklogItems);
    setContainers(toListItemContainers(initialContainers, initialBacklogItems));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Derived from the item's own data (via the server-confirmed `synced`
  // snapshot), not the visual zone. A divider can only ever reorder within
  // the Backlog zone — it never has a story's state/iteration to validate.
  function isAllowedMove(itemId: string, targetZone: string): boolean {
    const item = storyById(containers, itemId);
    if (!item) {
      return false;
    }
    if (item.kind === "divider") {
      return targetZone === BACKLOG_COLUMN_ID;
    }
    const story = storyById(synced, itemId);
    if (!story) {
      return false;
    }
    const from = zoneForStory(story, currentIteration?.id ?? null);
    return evaluateListDrop(story, from, targetZone as ListZoneId).ok;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) {
      return;
    }

    const activeContainer = findContainer(containers, String(active.id));
    const overContainer = findContainer(containers, String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return;
    }
    if (!isAllowedMove(String(active.id), overContainer)) {
      return;
    }

    setContainers((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.findIndex((item) => item.id === active.id);
      const overIndex = overItems.findIndex((item) => item.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;
      const moved = activeItems[activeIndex];
      if (!moved) {
        return prev;
      }

      return {
        ...prev,
        [activeContainer]: activeItems.filter((item) => item.id !== active.id),
        [overContainer]: [...overItems.slice(0, insertAt), moved, ...overItems.slice(insertAt)],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    const fallback = () => setContainers(toListItemContainers(synced, syncedBacklogItems));

    if (!over) {
      fallback();
      return;
    }

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer || !isAllowedMove(String(active.id), overContainer)) {
      fallback();
      return;
    }

    // Reorders against the *full* zone (containers), not just what's
    // rendered under the active filter — active.id/over.id always belong to
    // visible rows, but relocating them within the full list is what keeps a
    // hidden row's relative position intact.
    const items = containers[overContainer];
    const reordered = reorderContainer(items, String(active.id), String(over.id));

    setContainers((prev) => ({ ...prev, [overContainer]: reordered }));
    setDragError(null);

    const activeItem = storyById(containers, String(active.id));
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("item_kind", activeItem?.kind ?? "story");
    formData.set("item_id", String(active.id));
    formData.set("target_zone", overContainer);
    reordered.forEach((item) => formData.append("ordered_ids", `${item.kind}:${item.id}`));
    // Awaited and caught — the server re-derives the move from the
    // story's *current* row (see dropStoryInList), so a stale client (e.g.
    // another user already accepted this story) gets a rejection here even
    // though the client-side isAllowedMove check above passed. Un-caught,
    // this optimistic update above would never be reverted.
    startTransition(async () => {
      try {
        await dropStoryInList(formData);
      } catch (err) {
        fallback();
        setDragError(err instanceof Error ? err.message : "Failed to move the story");
      }
    });
  }

  const iceboxItems = containers[ICEBOX_COLUMN_ID] ?? [];
  const currentItems = containers.current ?? [];
  const backlogItems = containers[BACKLOG_COLUMN_ID] ?? [];
  // Point sum uses the full (unfiltered) current-zone items — the
  // iteration bar's committed points must not shift with the active filter.
  const currentStoryItems = currentItems.filter((item): item is Extract<ListItem, { kind: "story" }> => item.kind === "story");
  const activeItem = activeId ? storyById(containers, activeId) : undefined;

  // Rendered (visible) views only — passed to the presentational sections
  // below; `containers` itself (above) stays the full, unfiltered set.
  const isVisible = (item: ListItem) => item.kind !== "story" || matchesStoryFilter(item.story, filter);
  const visibleCurrentItems = currentItems.filter(isVisible);
  const visibleIceboxItems = iceboxItems.filter(isVisible);

  // Projected date range for a virtual iteration's group header, derived
  // from the current iteration's real end_date + the project's
  // iteration_length — null when there's no current iteration to project
  // from (shouldn't happen in tracker mode once ensureCurrentIteration has
  // run, but this component has no other fallback date to anchor on).
  function projectedDatesFor(iterationNumber: number) {
    if (!currentIteration) {
      return null;
    }
    return projectedIterationDates(
      currentIteration.end_date,
      iterationLength,
      iterationNumber - currentIteration.number,
    );
  }

  return (
    <DndContext
      id="board-list-view"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-4">
        <div className="flex max-w-3xl flex-1 flex-col gap-6">
          {dragError && <MutationErrorBanner message={dragError} onDismiss={() => setDragError(null)} />}
          <ListSection
            zoneId="current"
            title={
              <span className="font-semibold text-foreground">
                {currentIteration ? `Iteration #${currentIteration.number} · current` : "Current iteration"} ·{" "}
                {sumPoints(currentStoryItems.map((item) => item.story))} pts
              </span>
            }
            items={visibleCurrentItems}
            projectId={projectId}
            composer={<QuickAddComposer projectId={projectId} target="unstarted" compact />}
            collapsed={collapsedGroups.has("current")}
            onToggleCollapse={() => onToggleGroup("current")}
          />

          <BacklogSection
            items={backlogItems}
            velocity={velocity}
            startingIterationNumber={nextVirtualIterationNumber}
            projectId={projectId}
            filter={filter}
            iterationGoals={iterationGoals}
            projectedDatesFor={projectedDatesFor}
            collapsedGroups={collapsedGroups}
            onToggleGroup={onToggleGroup}
            composer={<QuickAddComposer projectId={projectId} target="backlog" compact />}
          />
        </div>

        {showIcebox && <IceboxColumn items={visibleIceboxItems} projectId={projectId} />}
      </div>

      <DragOverlay>
        {activeItem && (
          <div className="max-w-3xl rotate-1 cursor-grabbing">
            {activeItem.kind === "divider" ? (
              <DividerRow projectId={projectId} divider={activeItem.divider} />
            ) : (
              <StoryListRow story={activeItem.story} projectId={projectId} />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
