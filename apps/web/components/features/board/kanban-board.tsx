"use client";

import { type ReactNode, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, LayoutGrid, List as ListIcon, Pencil, Snowflake } from "lucide-react";
import { finishIteration, updateIterationGoal } from "@/app/projects/[id]/board/actions";
import { formatDate, utcTodayKey } from "@/lib/utils/format";
import { sumPoints } from "@/lib/utils/board";
import { focusColumnForStory } from "@/lib/utils/focus";
import { ICEBOX_COLUMN_ID } from "@/lib/utils/kanban";
import { isImeComposing } from "@/lib/utils/keyboard";
import type { BacklogRowItem } from "@/lib/utils/iterations";
import { matchesStoryFilter, type StoryFilter } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import { useProjectBoardRealtime } from "@/lib/supabase/realtime";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BoardListView } from "./board-list-view";
import { FocusBoard } from "./focus-board";
import { KanbanColumnsBoard } from "./kanban-columns-board";
import type { StoryCardData } from "./story-card";
import { useInlineEdit } from "./use-inline-edit";

// Card data plus the fields the drop validation and filters need (see
// lib/utils/kanban, lib/utils/stories "matchesStoryFilter"). `position` is
// the shared cross-state ordinal the List view's current zone sorts on —
// it's meaningless for the Kanban view's own per-column order,
// which never reads it. `assignee_id`/`labelIds`/`epic_id` are the raw ids
// filters match on, alongside `assigneeName`/`labels`/`epic` (from
// `StoryCardData`), which are only ever used for display.
export type BoardStory = StoryCardData & {
  state_id: string | null;
  iteration_id: string | null;
  position: number;
  assignee_id: string | null;
  labelIds: string[];
  epic_id: string | null;
  // Focus view only (spec/screens.md "Focus view") — ignored by
  // the List/Kanban views.
  focus: string | null;
  completed_at: string | null;
};

export type IterationMeta = {
  id: string;
  number: number;
  goal: string | null;
  start_date: string;
  end_date: string;
  velocity: number | null;
  state: string;
  // Manually finished before it started (spec/velocity.md "Skipping") —
  // excluded from the velocity window.
  skipped: boolean;
};

type BoardView = "kanban" | "list" | "focus";
type PersistentBoardView = Exclude<BoardView, "focus">;
const BOARD_VIEW_CHANGE_EVENT = "storylane:board-view-change";
const inMemoryBoardViews = new Map<string, PersistentBoardView>();

function boardViewStorageKey(projectId: string) {
  return `storylane:board-view:${projectId}`;
}

function isPersistentBoardView(value: string | null): value is PersistentBoardView {
  return value === "list" || value === "kanban";
}

function readBoardView(projectId: string): PersistentBoardView {
  try {
    const stored = window.localStorage.getItem(boardViewStorageKey(projectId));
    return isPersistentBoardView(stored)
      ? stored
      : inMemoryBoardViews.get(projectId) ?? "list";
  } catch {
    return inMemoryBoardViews.get(projectId) ?? "list";
  }
}

function subscribeBoardView(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(BOARD_VIEW_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(BOARD_VIEW_CHANGE_EVENT, onStoreChange);
  };
}

function writeBoardView(projectId: string, view: PersistentBoardView) {
  try {
    window.localStorage.setItem(boardViewStorageKey(projectId), view);
    inMemoryBoardViews.delete(projectId);
  } catch {
    inMemoryBoardViews.set(projectId, view);
  }
  window.dispatchEvent(new Event(BOARD_VIEW_CHANGE_EVENT));
}

// Top-level board component: owns the shared header (iteration bar, goal
// form, Icebox toggle, filters, and the Kanban/List view toggle — see
// spec/screens.md "Board layout") and delegates the story area to
// `KanbanColumnsBoard` or `BoardListView`, which each own their own drag
// state independently since the two views group stories differently
// (physical per-state columns vs. current/backlog/icebox zones).
export function KanbanBoard({
  projectId,
  currentIteration,
  states,
  initialContainers,
  initialBacklogItems,
  velocity,
  nextVirtualIterationNumber,
  iterationLength,
  iterationGoals,
  canFinishIteration,
  canManageStates,
  filter,
  toolbar,
  pointScale,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  // The project's states, ordered by position — the column set is
  // per-project and data-driven (TASK-91), not a fixed 6-value list.
  states: ProjectState[];
  // Keyed by KanbanColumnId: backlog, icebox, and one bucket per state column.
  // Unfiltered — `filter` is applied client-side, at render only,
  // so drag persistence and virtual-iteration/point-sum math never see a
  // filtered-down subset.
  initialContainers: Record<string, BoardStory[]>;
  // Backlog stories + freeform planning dividers, pre-merged/ordered
  // server-side — List-view-only (see BoardListView).
  initialBacklogItems: BacklogRowItem<BoardStory>[];
  // Current velocity, used to segment the Backlog column into virtual future
  // iterations (see spec/velocity.md "Marker computation").
  velocity: number;
  nextVirtualIterationNumber: number;
  // List-view-only (see BoardListView): projected dates and draft goals for
  // the Backlog's virtual-iteration group headers.
  iterationLength: number;
  iterationGoals: Record<number, string>;
  // Owner/member only (spec/velocity.md "Manual finish") — the
  // finalize_iteration RPC enforces this too, this just keeps the button off
  // a viewer's screen.
  canFinishIteration: boolean;
  // Owner/member only (matches project_states' own INSERT/UPDATE RLS) —
  // gates the Kanban view's inline column rename / "+ Add column" (doc-8 §2
  // option C hybrid). The RPCs enforce this too; this just keeps the
  // controls off a viewer's screen.
  canManageStates: boolean;
  // Type/assignee/label criteria from the URL — hides non-matching rows in
  // both views without ever touching the underlying (unfiltered) data.
  filter: StoryFilter;
  // Filters / new-story controls supplied by the server component.
  toolbar?: ReactNode;
  // The project's selectable point values (spec/features.md), threaded down
  // to List/Focus views' TransitionButtons for the unestimated-feature
  // estimation picker (TASK-37). The Kanban columns view never needs it —
  // state changes there are drag-only, no transition buttons render.
  pointScale: number[];
}) {
  const persistentView = useSyncExternalStore<PersistentBoardView>(
    subscribeBoardView,
    () => readBoardView(projectId),
    () => "list",
  );
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null);
  const view: BoardView = focusProjectId === projectId ? "focus" : persistentView;
  const [showIcebox, setShowIcebox] = useState(false);
  const router = useRouter();

  function selectView(next: BoardView) {
    if (isPersistentBoardView(next)) {
      setFocusProjectId(null);
      writeBoardView(projectId, next);
    } else {
      setFocusProjectId(projectId);
    }
  }

  // Other users' story/divider changes arrive here and re-fetch the
  // board's Server Component, which flows back in as `initialContainers` /
  // `initialBacklogItems` and syncs in each view's own state — no client-side
  // grouping logic is duplicated for this, and it covers both views since
  // only one is ever mounted.
  useProjectBoardRealtime(projectId, () => router.refresh());

  const iceboxStories = initialContainers[ICEBOX_COLUMN_ID] ?? [];
  const sortedStateIds = [...states].sort((a, b) => a.position - b.position).map((s) => s.id);
  const iterationStories = sortedStateIds.flatMap((column) => initialContainers[column] ?? []);
  const backlogStories = initialBacklogItems
    .filter((item): item is Extract<BacklogRowItem<BoardStory>, { kind: "story" }> => item.kind === "story")
    .map((item) => item.story);
  const allStories = [...iterationStories, ...iceboxStories, ...backlogStories];
  const totalStoryCount = allStories.length;
  const isFiltered = Object.values(filter).some(Boolean);
  const displayedStories =
    view === "kanban"
      ? iterationStories
      : view === "list"
        ? [...iterationStories, ...backlogStories, ...(showIcebox ? iceboxStories : [])]
        : allStories.filter((story) => {
            const category =
              story.state_id === null
                ? null
                : states.find((state) => state.id === story.state_id)?.category ?? null;
            return (
              focusColumnForStory(
                { category, focus: story.focus, iteration_id: story.iteration_id },
                currentIteration?.id ?? null,
              ) !== null
            );
          });
  const visibleDisplayedStoryCount = displayedStories.filter((story) =>
    matchesStoryFilter(story, filter),
  ).length;
  const hiddenIterationStoryCount = iterationStories.filter(
    (story) => !matchesStoryFilter(story, filter),
  ).length;

  return (
    <div>
      {/* TASK-45: split into two rows — iteration info (what a member reads
          before touching anything) above, controls (view switcher, Icebox,
          filters, Finish iteration) below. Previously all in one wrapping
          row, which both cramped the info and put Finish iteration at the
          horizontal center between the info and the goal input — an
          irreversible action sitting exactly where routine clicks land
          (spec/ux-principles.md principle 6). Finish iteration now anchors
          the controls row's right edge via its own `ml-auto`, away from
          both the info above and the story rows below. */}
      <div className="mb-4 flex flex-col gap-2">
        {currentIteration && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-base font-semibold">Iteration #{currentIteration.number}</span>
            <Badge className="bg-primary/15 text-primary">
              Current
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDate(currentIteration.start_date)} – {formatDate(currentIteration.end_date)} (auto-finishes)
            </span>
            <span className="text-xs text-muted-foreground">
              {sumPoints(iterationStories)} / {velocity} pts committed
              <span
                className={`ml-1 inline-block w-16 ${
                  isFiltered && hiddenIterationStoryCount > 0 ? "" : "invisible"
                }`}
                aria-hidden={!(isFiltered && hiddenIterationStoryCount > 0) || undefined}
              >
                (all stories)
              </span>
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <IterationGoalBar
              projectId={projectId}
              iterationId={currentIteration.id}
              initialGoal={currentIteration.goal ?? ""}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <Button
              type="button"
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => selectView("list")}
              aria-pressed={view === "list"}
            >
              <ListIcon />
              List
            </Button>
            <Button
              type="button"
              variant={view === "kanban" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => selectView("kanban")}
              aria-pressed={view === "kanban"}
            >
              <LayoutGrid />
              Kanban
            </Button>
            <Button
              type="button"
              variant={view === "focus" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => selectView("focus")}
              aria-pressed={view === "focus"}
            >
              <Crosshair />
              Focus
            </Button>
          </div>
          {/* Always mounted (TASK-35) — only List has an Icebox column to
              toggle, but unmounting this button for Kanban/Focus shrank the
              toolbar and shifted the view switcher and filters left/right on
              every switch (spec/ux-principles.md principle 3: conditional UI
              never shifts layout). `invisible` reserves its layout box
              without painting or hit-testing it outside List, and browsers
              already exclude a `visibility: hidden` element from the tab
              order; `aria-hidden`/`tabIndex={-1}` make that explicit rather
              than relying on it. The toggle's own show/hide behavior for
              List is unchanged. */}
          <Button
            type="button"
            variant={showIcebox ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowIcebox((v) => !v)}
            className={view === "list" ? undefined : "invisible"}
            aria-hidden={view !== "list" || undefined}
            tabIndex={view === "list" ? undefined : -1}
            data-testid="icebox-toggle"
          >
            <Snowflake className="text-sky-600 dark:text-sky-400" />
            Icebox
            {/* Always rendered (TASK-59) to reserve layout space; hidden when
                the Icebox is empty. Unlike the List/Kanban/Focus toggle's
                unmounting, the badge appearing/disappearing on the 0/1 boundary
                nudges the view-switcher and filters (spec/ux-principles.md
                principle 3). */}
            <span
              className={iceboxStories.length > 0 ? "text-xs text-muted-foreground" : "invisible"}
              aria-hidden={iceboxStories.length === 0 || undefined}
            >
              {iceboxStories.length}
            </span>
          </Button>
          {toolbar}
          {currentIteration && (
            <div className="ml-auto pl-4">
              <FinishIterationButton
                projectId={projectId}
                iterationId={currentIteration.id}
                iterationNumber={currentIteration.number}
                iterationStartDate={currentIteration.start_date}
                visible={canFinishIteration}
              />
            </div>
          )}
        </div>
      </div>

      {totalStoryCount === 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          No stories yet. Use &quot;+ Add story&quot; below to create the first one.
        </p>
      )}
      {isFiltered && displayedStories.length > 0 && visibleDisplayedStoryCount === 0 && (
        <p
          className="mb-3 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          No stories match the current filters.
        </p>
      )}
      {view === "kanban" ? (
        <KanbanColumnsBoard
          projectId={projectId}
          currentIteration={currentIteration}
          states={states}
          initialContainers={initialContainers}
          filter={filter}
          canManageStates={canManageStates}
        />
      ) : view === "focus" ? (
        <FocusBoard
          projectId={projectId}
          currentIteration={currentIteration}
          states={states}
          initialContainers={initialContainers}
          filter={filter}
          pointScale={pointScale}
        />
      ) : (
        <BoardListView
          projectId={projectId}
          currentIteration={currentIteration}
          states={states}
          initialContainers={initialContainers}
          initialBacklogItems={initialBacklogItems}
          velocity={velocity}
          nextVirtualIterationNumber={nextVirtualIterationNumber}
          iterationLength={iterationLength}
          iterationGoals={iterationGoals}
          showIcebox={showIcebox}
          filter={filter}
          pointScale={pointScale}
        />
      )}
    </div>
  );
}

// The current iteration's goal (spec/screens.md "Board layout": commits on
// Enter, Esc reverts, no Save button — same UX contract as the Backlog
// virtual-group goal inputs, board-list-view.tsx's IterationGoalInput).
// spec/ux-principles.md principle 5: a saved value renders as text, not a
// live input — a permanently-visible input implies unsaved state even right
// after a successful save. Clicking the text opens the editor; Enter or
// blur commits and returns to text (only on success — a failed save stays
// in edit mode with the typed value and the error still visible, same as
// before this became click-to-edit); Esc discards and returns to text.
// Returning to text view *is* the success feedback, so there's no separate
// "Saved ✓" flash the way story-detail-panel.tsx's always-visible fields use.
export function IterationGoalBar({
  projectId,
  iterationId,
  initialGoal,
}: {
  projectId: string;
  iterationId: string;
  initialGoal: string;
}) {
  const { buttonRef, editor } = useInlineEdit({
    initialValue: initialGoal,
    fallbackError: "Failed to save goal",
    async onCommit(trimmed) {
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("iteration_id", iterationId);
    formData.set("goal", trimmed);
      await updateIterationGoal(formData);
    },
  });

  if (!editor.editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={editor.startEditing}
        aria-label={editor.synced ? `Edit iteration goal: ${editor.synced}` : "Add iteration goal"}
        className="group flex min-w-0 max-w-md items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted"
      >
        {editor.synced ? (
          <span className="truncate">{editor.synced}</span>
        ) : (
          <span className="text-muted-foreground italic">Add goal…</span>
        )}
        <Pencil
          className="size-3 shrink-0 text-muted-foreground opacity-60"
          aria-hidden
        />
      </button>
    );
  }

  return (
    <div className="flex min-w-56 flex-1 items-center gap-2 sm:max-w-md">
      <input
        autoFocus
        value={editor.value}
        onChange={(event) => editor.setValue(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) {
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void editor.commitAndClose("keyboard");
          } else if (event.key === "Escape") {
            event.preventDefault();
            editor.cancel("keyboard");
          }
        }}
        onBlur={() => void editor.commitAndClose("blur")}
        placeholder="Sprint goal"
        aria-label="Iteration goal"
        readOnly={editor.isSaving}
        aria-busy={editor.isSaving || undefined}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm focus:outline-none disabled:opacity-60"
      />
      {editor.error && <span className="shrink-0 text-xs text-destructive">{editor.error}</span>}
    </div>
  );
}

// "Finish iteration" (spec/velocity.md "Manual finish" / "Skipping a
// not-yet-started iteration"): irreversible, so it confirms before calling
// the shared finalize_iteration RPC. When the current iteration hasn't
// started yet (its predecessor was just finished, so it begins tomorrow),
// finishing it *skips* it — the dialog says so, and every RPC outcome
// (finished, skipped, or a raced no-op) renders visible feedback rather than
// ending in silence (spec/ux-principles.md principle 2).
export function FinishIterationButton({
  projectId,
  iterationId,
  iterationNumber,
  iterationStartDate,
  visible,
}: {
  projectId: string;
  iterationId: string;
  iterationNumber: number;
  // The current iteration's start_date (YYYY-MM-DD). When it is in the
  // future the iteration hasn't started and finishing it is a "skip".
  iterationStartDate: string;
  visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // UTC boundary, matching finalize_iteration's `v_today` — a local-time
  // comparison could label a finish "Skip" (or vice-versa) the RPC then
  // does the opposite of (fable-advisor F1, 2026-07-15).
  const notStarted = iterationStartDate > utcTodayKey();

  function handleConfirm() {
    setError(null);
    setInfo(null);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("iteration_id", iterationId);
    startTransition(async () => {
      try {
        const { events } = await finishIteration(formData);
        // A no-op (nothing to finish, or a racing/double call already
        // finished this iteration) reports its reason instead of silently
        // closing — the board didn't change, so the dialog must say why.
        const noop = events.find((event) => event.kind === "noop");
        if (noop && !events.some((event) => event.kind === "finalized")) {
          setInfo(
            noop.reason === "already_finished"
              ? "This iteration was already finished — the board is up to date."
              : "There's no current iteration to finish.",
          );
          return;
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to finish the iteration");
      }
    });
  }

  return (
    /* Always mounted (TASK-59) to reserve the layout space for the Finish
       iteration button, but only visible when the user can actually finish.
       Unmounting would shift IterationGoalBar left/right whenever
       canFinishIteration flips (rare but possible on role re-grant/revoke,
       spec/ux-principles.md principle 3). Same pattern as Icebox toggle
       (TASK-35): invisible reserves the box, aria-hidden/tabIndex exclude it
       from the document's semantics. */
    <div className={visible ? undefined : "invisible"} aria-hidden={!visible || undefined} tabIndex={visible ? undefined : -1}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setError(null);
            setInfo(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Finish iteration
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {notStarted ? `Skip iteration #${iterationNumber}?` : `Finish iteration #${iterationNumber}?`}
            </DialogTitle>
            <DialogDescription>
              {notStarted
                ? `Iteration #${iterationNumber} starts ${formatDate(iterationStartDate)} and hasn't begun. Finishing it now skips it — its stories move to iteration #${iterationNumber + 1}, and it won't count toward velocity. This can't be undone.`
                : "This closes the iteration today instead of on its scheduled end date. Unaccepted stories move to the next iteration. This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              {info ? "Done" : "Cancel"}
            </Button>
            {!info && (
              <Button type="button" onClick={handleConfirm} disabled={isPending}>
                {isPending
                  ? notStarted
                    ? "Skipping…"
                    : "Finishing…"
                  : notStarted
                    ? "Skip iteration"
                    : "Finish iteration"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
