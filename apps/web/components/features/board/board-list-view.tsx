"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronDown, ChevronRight, MoreVertical, Snowflake, X } from "lucide-react";
import {
  createBacklogDivider,
  deleteBacklogDivider,
  dropStoryInList,
  upsertIterationGoal,
} from "@/app/projects/[id]/board/actions";
import { beforeAnchorId, findContainer, moveBetweenContainers, storyById, sumPoints } from "@/lib/utils/board";
import { reorderContainer } from "@/lib/utils/board-dnd";
import { formatDate } from "@/lib/utils/format";
import { isImeComposing } from "@/lib/utils/keyboard";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MutationErrorBanner } from "./mutation-error-banner";
import { BOARD_COLUMN_HEIGHT_CLASS } from "./kanban-columns-board";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryListRow } from "./story-list-row";
import { SortableItem } from "./sortable-item";
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
function SortableListRow({
  item,
  projectId,
  pointScale,
}: {
  item: ListItem;
  projectId: string;
  pointScale: number[];
}) {
  return (
    <SortableItem id={item.id}>
      {item.kind === "divider" ? (
        // Unreachable in practice — Current/Icebox ListItems are always
        // stories (see the doc comment above) — kept type-correct with a
        // no-op rather than threading onError through two more prop layers
        // for a branch that never renders.
        <DividerRow projectId={projectId} divider={item.divider} onError={() => {}} />
      ) : (
        <StoryListRow story={item.story} projectId={projectId} pointScale={pointScale} />
      )}
    </SortableItem>
  );
}

// A freeform planning row: dashed border, muted label, delete button. Only
// ever rendered for a user-created note now — a manual iteration break's
// own row was folded into the `IterationHeaderRow` it creates instead
// (TASK-43); `divider.kind` is still checked generically since
// `BacklogDivider` itself covers both kinds.
export function DividerRow({
  projectId,
  divider,
  insertMenu,
  onError,
}: {
  projectId: string;
  divider: BacklogDivider;
  insertMenu?: ReactNode;
  // Surfaces a failed delete in the shared banner (TASK-60) — this used to
  // be a fire-and-forget `void` call, so a rejected delete left the row on
  // screen with no explanation for why it didn't disappear.
  onError: (message: string) => void;
}) {
  const [isRemoving, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const label = divider.kind === "note" ? divider.label : "Iteration break";

  function handleDelete() {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("divider_id", divider.id);
    startTransition(async () => {
      try {
        await deleteBacklogDivider(formData);
        setConfirmOpen(false);
      } catch (err) {
        setConfirmOpen(false);
        onError(err instanceof Error ? err.message : "Failed to remove");
      }
    });
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-2.5 py-1.5">
        <span className="flex-1 truncate text-sm font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => setConfirmOpen(true)}
          aria-label={`Remove "${label}"`}
        >
          <X />
        </Button>
        {insertMenu}
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove note &quot;{label}&quot;?</DialogTitle>
            <DialogDescription>
              This removes the planning note from the backlog. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={isRemoving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleDelete} disabled={isRemoving}>
              {isRemoving ? "Removing…" : "Remove note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
          if (isImeComposing(event)) {
            return;
          }
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
//
// `manualBreakDividerId` (TASK-43): when this group's boundary was forced
// by a manual "iteration break" rather than capacity alone, the raw break
// row is no longer rendered on its own — it read as redundant clutter
// stacked right above the header that already announces the same boundary
// (number, dates, points), and every break ever placed kept its row
// forever with no way for it to feel "resolved". Its only remaining UI is
// this small removable badge on the header it created; removing it lets
// automatic capacity-based splitting reclaim that spot.
export function IterationHeaderRow({
  number,
  points,
  projectId,
  goal,
  projectedDates,
  collapsed,
  onToggle,
  manualBreakDividerId,
}: {
  number: number;
  points: number;
  projectId: string;
  goal: string;
  projectedDates: { start_date: string; end_date: string } | null;
  collapsed: boolean;
  onToggle: () => void;
  manualBreakDividerId?: string;
}) {
  const [isRemoving, startTransition] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleRemoveManualBreak() {
    if (!manualBreakDividerId) {
      return;
    }
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("divider_id", manualBreakDividerId);
    setRemoveError(null);
    startTransition(async () => {
      try {
        await deleteBacklogDivider(formData);
        setConfirmOpen(false);
      } catch (err) {
        setRemoveError(err instanceof Error ? err.message : "Failed to remove");
      }
    });
  }

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
        {manualBreakDividerId && (
          <span
            className="flex shrink-0 items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[10px]"
            title="This boundary was manually forced, remove it to let capacity decide again"
          >
            manual
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setConfirmOpen(true)}
              disabled={isRemoving}
              aria-label="Remove manual iteration break"
            >
              <X className="size-3" />
            </Button>
          </span>
        )}
        {projectedDates && (
          <span className="shrink-0">
            {formatDate(projectedDates.start_date)} – {formatDate(projectedDates.end_date)}
          </span>
        )}
        <IterationGoalInput projectId={projectId} number={number} initialGoal={goal} />
        <span className="shrink-0">{points} pts</span>
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove manual iteration break?</DialogTitle>
            <DialogDescription>
              This removes the forced boundary and lets iteration capacity determine the split again. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p className="text-sm text-destructive" role="alert">
              {removeError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={isRemoving}>
              Cancel
            </Button>
            <Button type="button" onClick={handleRemoveManualBreak} disabled={isRemoving}>
              {isRemoving ? "Removing…" : "Remove break"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

// Row-level "…" menu (TASK-42): the primary path for inserting a note or
// iteration break at a chosen position, replacing pixel-hunting the
// hover-line's thin gap (kept below as a secondary shortcut). `aboveId` is
// this row's own `"story:<id>"` / `"divider:<id>"` pair (always real);
// `belowId` is the next real row's, or `null` at the very end of the
// backlog — both are the same `before_item_id` convention
// createBacklogDivider already uses.
export function RowInsertMenu({
  projectId,
  aboveId,
  belowId,
  onError,
}: {
  projectId: string;
  aboveId: string;
  belowId: string | null;
  // Reports a failed insert to the shared MutationErrorBanner at the top
  // of the list (TASK-42) — there's no per-row slot to show it inline
  // without shifting layout (spec/ux-principles.md principle 3).
  onError: (message: string) => void;
}) {
  const [noteTarget, setNoteTarget] = useState<"above" | "below" | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function closeNoteDialog() {
    setNoteTarget(null);
    setLabel("");
    setError(null);
  }

  function insertBreak(beforeItemId: string | null) {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("kind", "iteration_break");
    if (beforeItemId) {
      formData.set("before_item_id", beforeItemId);
    }
    startTransition(async () => {
      try {
        await createBacklogDivider(formData);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to insert iteration break");
      }
    });
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || !noteTarget) {
      return;
    }
    const beforeItemId = noteTarget === "above" ? aboveId : belowId;
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("label", trimmed);
    formData.set("kind", "note");
    if (beforeItemId) {
      formData.set("before_item_id", beforeItemId);
    }
    setError(null);
    startTransition(async () => {
      try {
        await createBacklogDivider(formData);
        closeNoteDialog();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add note");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Insert note or iteration break">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setNoteTarget("above")}>Insert note above</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setNoteTarget("below")}>Insert note below</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insertBreak(aboveId)}>Insert iteration break above</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insertBreak(belowId)}>Insert iteration break below</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={noteTarget !== null} onOpenChange={(open) => !open && closeNoteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert note {noteTarget}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitNote} className="flex flex-col gap-2">
            <Input
              autoFocus
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setError(null);
              }}
              placeholder="Note label"
              aria-label="New note label"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeNoteDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !label.trim()}>
                Insert
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// A draggable Backlog row: a story or a note — each has a real backing row
// (a story or a `backlog_dividers` entry), so it can be reordered and
// deleted like any other item. `iteration-header` rows render directly via
// `IterationHeaderRow` instead, and `iteration-break` rows render nothing
// of their own — folded into the header they create (see `BacklogSection`,
// TASK-43). Indent distinction (spec/screens.md): story rows sit slightly
// right of note dividers, which stay flush at the left edge.
function SortableBacklogRow({
  row,
  projectId,
  pointScale,
  insertAboveId,
  insertBelowId,
  onError,
}: {
  row: Extract<BacklogRow<BoardStory>, { kind: "story" | "note" }>;
  projectId: string;
  pointScale: number[];
  insertAboveId: string;
  insertBelowId: string | null;
  onError: (message: string) => void;
}) {
  const dragId = row.kind === "story" ? row.story.id : row.divider.id;

  const insertMenu = (
    <RowInsertMenu projectId={projectId} aboveId={insertAboveId} belowId={insertBelowId} onError={onError} />
  );

  return (
    <SortableItem id={dragId} className={row.kind === "story" ? "pl-3" : ""}>
      {row.kind === "story" ? (
        <StoryListRow story={row.story} projectId={projectId} pointScale={pointScale} insertMenu={insertMenu} />
      ) : (
        <DividerRow projectId={projectId} divider={row.divider} insertMenu={insertMenu} onError={onError} />
      )}
    </SortableItem>
  );
}

// Hover-revealed "insert a line here" affordance between two adjacent
// Backlog rows — appending then dragging into place wasn't discoverable
// enough. `beforeItemId` is a `"story:<id>"` / `"divider:<id>"`
// pair identifying the exact spot server-side (see board/actions.ts
// "createBacklogDivider"); `null` means "at the end".
export function InsertBetweenRows({
  projectId,
  beforeItemId,
  onError,
}: {
  projectId: string;
  beforeItemId: string | null;
  // Surfaces a failed insert in the shared banner (TASK-60) — both actions
  // below used to be fire-and-forget `void` calls, so a rejected insert
  // silently did nothing.
  onError: (message: string) => void;
}) {
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
    startTransition(async () => {
      try {
        await createBacklogDivider(formData);
        // Only clear/close on success — a failure keeps the typed label so
        // the user doesn't have to retype it after seeing the error.
        setLabel("");
        setAddingNote(false);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to add note");
      }
    });
  }

  function insertIterationBreak() {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("kind", "iteration_break");
    if (beforeItemId) {
      formData.set("before_item_id", beforeItemId);
    }
    startTransition(async () => {
      try {
        await createBacklogDivider(formData);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to insert iteration break");
      }
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
              if (event.key === "Escape" && !isImeComposing(event)) {
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
      {/* Invisible, oversized hover target (TASK-42, secondary shortcut
          behind the row "…" menu): the visible gap stays a thin h-2 line so
          rows don't visually spread apart (no layout shift when this
          appears), and the hoverable band is h-6 rather than a full row —
          this li is `position: relative`, so anything absolutely positioned
          inside it paints above the *static* neighboring row lis regardless
          of DOM order (CSS stacking: positioned content always paints over
          in-flow static siblings). A band as tall as a full row would
          overlap far enough into each neighbor to swallow clicks on its own
          buttons; h-6 only reaches each neighbor's own padding, well short
          of its interactive content, while still being a much easier target
          than the old 8px line. */}
      <div className="absolute inset-x-0 top-1/2 h-6 -translate-y-1/2" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center gap-1.5 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/insert:pointer-events-auto group-hover/insert:opacity-100">
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
  pointScale,
}: {
  zoneId: string;
  title: ReactNode;
  items: ListItem[];
  projectId: string;
  composer?: ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  pointScale: number[];
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
        <span className="h-px flex-1 bg-border" />
      </header>
      {/* Kept mounted (not conditionally rendered) even while collapsed —
          dnd-kit's droppable ref must stay registered so a story can still
          be dropped into this zone. */}
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className={`flex min-h-10 flex-col gap-1.5 ${collapsed ? "hidden" : ""}`}>
          {items.map((item) => (
            <SortableListRow key={item.id} item={item} projectId={projectId} pointScale={pointScale} />
          ))}
        </ul>
      </SortableContext>
      {/* The add-story affordance lives at the group's bottom edge, not the
          header (TASK-36) — hidden along with the rest of a collapsed
          group's content. */}
      {!collapsed && composer}
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

// Backlog section: rows come from `buildBacklogRows`, which interleaves
// numbered virtual-iteration headers, freeform notes, and manual iteration
// breaks with the stories in one flat sortable list. Stories and notes
// drag as ordinary rows; a manual break has no row of its own to drag —
// see the `rows.map` below. A hover-revealed insert affordance sits
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
  pointScale,
  onError,
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
  pointScale: number[];
  // Surfaces a row insert-menu failure (TASK-42) in the shared banner at
  // the top of the list, the same slot drag failures already use.
  onError: (message: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: BACKLOG_COLUMN_ID });

  const rowItems: BacklogRowItem<BoardStory>[] = items.map((item) =>
    item.kind === "story" ? { kind: "story", story: item.story } : { kind: "divider", divider: item.divider },
  );
  const rows = buildBacklogRows(rowItems, velocity, startingIterationNumber);
  const nextRealRowIds: Array<string | null> = Array(rows.length + 1).fill(null);
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    nextRealRowIds[index] =
      row.kind === "story"
        ? `story:${row.story.id}`
        : row.kind === "note" || row.kind === "iteration-break"
          ? `divider:${row.divider.id}`
          : nextRealRowIds[index + 1];
  }

  // A story/note row is hidden while its group is collapsed, or (a story
  // only) while it doesn't match the active filter. Headers always render
  // — collapsing only hides a group's *contents*. A manual break has no
  // row/id of its own to add here at all (TASK-43: folded into the header
  // it creates, see the `rows.map` below) — unlike before, it's never a
  // member of the sortable/visible set.
  let currentGroupCollapsed = false;
  let currentGroupNumber = startingIterationNumber;
  const visibleRowIds = new Set<string>();
  // Parallel to `rows` — whether the row at that index's group is collapsed,
  // computed in this same pass so the per-group "+ Add story" composer
  // (TASK-36) below can look it up by index instead of tracking its own
  // mutable state across the JSX-building `.map()` (React disallows
  // reassigning a plain variable from inside a render-time callback).
  const rowGroupCollapsed: boolean[] = [];
  const rowGroupNumbers: number[] = [];
  for (const row of rows) {
    if (row.kind === "iteration-header") {
      currentGroupNumber = row.number;
      currentGroupCollapsed = collapsedGroups.has(String(row.number));
    }
    rowGroupCollapsed.push(currentGroupCollapsed);
    rowGroupNumbers.push(currentGroupNumber);
    if (row.kind === "iteration-header" || row.kind === "iteration-break") {
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
        <span className="h-px flex-1 bg-border" />
      </header>
      <SortableContext items={[...visibleRowIds]} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="flex min-h-10 flex-col gap-1.5">
          <InsertBetweenRows projectId={projectId} beforeItemId={nextRealRowIds[0]} onError={onError} />
          {rows.flatMap((row, index) => {
            // A manual break renders nothing of its own — buildBacklogRows
            // guarantees the very next row is always the iteration-header
            // it forced (TASK-43), which picks it up via
            // `manualBreakDividerId` below instead of a separate row.
            if (row.kind === "iteration-break") {
              return [];
            }

            // This row is the last one in its virtual-iteration group (or,
            // for an empty group, the header itself) whenever the next row
            // starts a new group/break or there is none — that's exactly
            // the group's bottom edge the per-group composer belongs at.
            const next = rows[index + 1];
            const isGroupEnd = !next || next.kind === "iteration-header" || next.kind === "iteration-break";
            const renderedRows: ReactNode[] = [];

            if (row.kind === "iteration-header") {
              const key = String(row.number);
              renderedRows.push(
                <IterationHeaderRow
                  key={rowKey(row, index)}
                  number={row.number}
                  points={row.points}
                  projectId={projectId}
                  goal={iterationGoals[row.number] ?? ""}
                  projectedDates={projectedDatesFor(row.number)}
                  collapsed={collapsedGroups.has(key)}
                  onToggle={() => onToggleGroup(key)}
                  manualBreakDividerId={row.manualBreakDividerId}
                />,
              );
            } else {
              const id = row.kind === "story" ? row.story.id : row.divider.id;
              const aboveId = row.kind === "story" ? `story:${row.story.id}` : `divider:${row.divider.id}`;
              if (visibleRowIds.has(id)) {
                renderedRows.push(
                  <SortableBacklogRow
                    key={rowKey(row, index)}
                    row={row}
                    projectId={projectId}
                    pointScale={pointScale}
                    insertAboveId={aboveId}
                    insertBelowId={nextRealRowIds[index + 1]}
                    onError={onError}
                  />,
                );
              }
            }

            // Stable by virtual iteration rather than by whichever story is
            // currently last in it. Realtime can move this sibling without
            // remounting it, preserving QuickAddComposer's open/title state.
            if (isGroupEnd && !rowGroupCollapsed[index]) {
              renderedRows.push(
                <li key={`group-composer-${rowGroupNumbers[index]}`} className="pl-3">
                  <QuickAddComposer
                    projectId={projectId}
                    target="backlog"
                    beforeItemId={nextRealRowIds[index + 1] ?? undefined}
                  />
                </li>,
              );
            }

            renderedRows.push(
              <InsertBetweenRows
                key={`insert-after-${rowKey(row, index)}`}
                projectId={projectId}
                beforeItemId={nextRealRowIds[index + 1]}
                onError={onError}
              />,
            );

            return renderedRows;
          })}
        </ul>
      </SortableContext>
      {/* No virtual-iteration group renders at all for a totally empty
          backlog (buildBacklogRows emits nothing) — this fallback keeps an
          add-story affordance available even then. */}
      {rows.length === 0 && <QuickAddComposer projectId={projectId} target="backlog" />}
    </section>
  );
}

// Icebox rendered as its own narrow side column rather than an inline
// stacked section — it's a pre-triage parking lot, not part
// of the priority order, so keeping it out of the main list lets the PO
// focus purely on Current/Backlog priority (see spec/screens.md "Board
// layout: List view").
function IceboxColumn({
  items,
  projectId,
  pointScale,
}: {
  items: ListItem[];
  projectId: string;
  pointScale: number[];
}) {
  const { setNodeRef } = useDroppable({ id: ICEBOX_COLUMN_ID });

  return (
    <section className={`flex w-72 shrink-0 flex-col rounded-lg border border-border bg-sky-50/50 dark:bg-sky-950/20 ${BOARD_COLUMN_HEIGHT_CLASS}`}>
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Snowflake className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
        <h2 className="text-sm font-semibold">Icebox</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-1.5">
            {items.map((item) => (
              <SortableListRow key={item.id} item={item} projectId={projectId} pointScale={pointScale} />
            ))}
          </ul>
        </SortableContext>
      </div>
      {/* Pinned below the scroll area (TASK-36) rather than inside it, so
          it's reachable without scrolling to the bottom of a long Icebox. */}
      <div className="px-3 pb-3">
        <QuickAddComposer projectId={projectId} target="icebox" />
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
  pointScale,
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
  // The project's selectable point values (spec/features.md) — passed down
  // to every TransitionButtons render so an unestimated feature's estimation
  // picker offers the right scale (TASK-37).
  pointScale: number[];
}) {
  const [containers, setContainers] = useState(() => toListItemContainers(initialContainers, initialBacklogItems));
  const [synced, setSynced] = useState(initialContainers);
  const [syncedBacklogItems, setSyncedBacklogItems] = useState(initialBacklogItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Shared by drag failures and each row's insert-menu failures (TASK-42) —
  // one error slot for the whole List view, not "drag" specifically.
  const [mutationError, setMutationError] = useState<string | null>(null);
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

    const overContainer = findContainer(containers, String(over.id));
    if (!overContainer) {
      return;
    }

    setContainers((prev) => moveBetweenContainers(prev, String(active.id), overContainer, String(over.id), isAllowedMove));
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
    setMutationError(null);

    const activeItem = storyById(containers, String(active.id));
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("item_kind", activeItem?.kind ?? "story");
    formData.set("item_id", String(active.id));
    formData.set("target_zone", overContainer);
    // Intent, not a full sequence: the neighbour ("story:<id>"/"divider:<id>")
    // the item now sits before (or nothing = append to the zone's end). The
    // server re-derives dense positions across both tables from current DB
    // order, so a stale client can't overwrite a concurrent drag (TASK-56).
    const beforeId = beforeAnchorId(reordered, String(active.id));
    if (beforeId) {
      formData.set("before_item_id", beforeId);
    }
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
        setMutationError(err instanceof Error ? err.message : "Failed to move the story");
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
          {mutationError && (
            <div className="sticky top-0 z-20">
              <MutationErrorBanner message={mutationError} onDismiss={() => setMutationError(null)} />
            </div>
          )}
          <ListSection
            zoneId="current"
            title={
              <span className="font-semibold text-foreground">
                Current · {sumPoints(currentStoryItems.map((item) => item.story))} pts
              </span>
            }
            items={visibleCurrentItems}
            projectId={projectId}
            composer={<QuickAddComposer projectId={projectId} target="unstarted" />}
            collapsed={collapsedGroups.has("current")}
            onToggleCollapse={() => onToggleGroup("current")}
            pointScale={pointScale}
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
            pointScale={pointScale}
            onError={setMutationError}
          />
        </div>

        {showIcebox && (
          <IceboxColumn items={visibleIceboxItems} projectId={projectId} pointScale={pointScale} />
        )}
      </div>

      <DragOverlay>
        {activeItem && (
          <div className="max-w-3xl rotate-1 cursor-grabbing">
            {activeItem.kind === "divider" ? (
              <DividerRow projectId={projectId} divider={activeItem.divider} onError={setMutationError} />
            ) : (
              <StoryListRow story={activeItem.story} projectId={projectId} pointScale={pointScale} />
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
