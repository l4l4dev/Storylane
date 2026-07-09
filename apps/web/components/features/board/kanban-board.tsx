"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List as ListIcon, Snowflake } from "lucide-react";
import { finishIteration, updateIterationGoal } from "@/app/projects/[id]/board/actions";
import { sumPoints } from "@/lib/utils/board";
import { BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID, STATE_COLUMNS } from "@/lib/utils/kanban";
import type { BacklogRowItem } from "@/lib/utils/iterations";
import type { StoryFilter } from "@/lib/utils/stories";
import { useProjectBoardRealtime } from "@/lib/supabase/realtime";
import { Button } from "@/components/ui/button";
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
import { KanbanColumnsBoard } from "./kanban-columns-board";
import type { StoryCardData } from "./story-card";

export { BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID };

// Card data plus the fields the drop validation and filters need (see
// lib/utils/kanban, lib/utils/stories "matchesStoryFilter"). `position` is
// the shared cross-state ordinal the List view's current zone sorts on
// (TASK-21) — it's meaningless for the Kanban view's own per-column order,
// which never reads it. `assignee_id`/`labelIds` are the raw ids filters
// match on, alongside `assigneeName`/`labels` (from `StoryCardData`), which
// are only ever used for display.
export type BoardStory = StoryCardData & {
  iteration_id: string | null;
  position: number;
  assignee_id: string | null;
  labelIds: string[];
};

export type IterationMeta = {
  id: string;
  number: number;
  goal: string | null;
  start_date: string;
  end_date: string;
  velocity: number | null;
  state: string;
};

type BoardView = "kanban" | "list";

// Top-level board component: owns the shared header (iteration bar, goal
// form, Icebox toggle, filters, and the Kanban/List view toggle — see
// spec/screens.md "Board layout") and delegates the story area to
// `KanbanColumnsBoard` or `BoardListView`, which each own their own drag
// state independently since the two views group stories differently
// (physical per-state columns vs. current/backlog/icebox zones).
export function KanbanBoard({
  projectId,
  currentIteration,
  initialContainers,
  initialBacklogItems,
  velocity,
  nextVirtualIterationNumber,
  iterationLength,
  iterationGoals,
  canFinishIteration,
  filter,
  toolbar,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  // Keyed by KanbanColumnId: backlog, icebox, and one bucket per state column.
  // Unfiltered (TASK-20) — `filter` is applied client-side, at render only,
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
  // the Backlog's virtual-iteration group headers (Task 9).
  iterationLength: number;
  iterationGoals: Record<number, string>;
  // TASK-10: owner/member only (spec/velocity.md "Manual finish") — the
  // finalize_iteration RPC enforces this too, this just keeps the button off
  // a viewer's screen.
  canFinishIteration: boolean;
  // Type/assignee/label criteria from the URL — hides non-matching rows in
  // both views without ever touching the underlying (unfiltered) data.
  filter: StoryFilter;
  // Filters / new-story controls supplied by the server component.
  toolbar?: ReactNode;
}) {
  const [view, setView] = useState<BoardView>("list");
  const [showIcebox, setShowIcebox] = useState(false);
  const router = useRouter();

  // Task 11: other users' story/divider changes arrive here and re-fetch the
  // board's Server Component, which flows back in as `initialContainers` /
  // `initialBacklogItems` and syncs in each view's own state — no client-side
  // grouping logic is duplicated for this, and it covers both views since
  // only one is ever mounted.
  useProjectBoardRealtime(projectId, () => router.refresh());

  const iceboxStories = initialContainers[ICEBOX_COLUMN_ID] ?? [];
  const iterationStories = STATE_COLUMNS.flatMap((column) => initialContainers[column] ?? []);
  const totalStoryCount =
    iterationStories.length +
    iceboxStories.length +
    initialBacklogItems.filter((item) => item.kind === "story").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {currentIteration && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Iteration #{currentIteration.number}</span>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                Current
              </span>
              <span className="text-xs text-muted-foreground">
                {currentIteration.start_date} – {currentIteration.end_date}
              </span>
              <span className="text-xs text-muted-foreground">
                {sumPoints(iterationStories)} pts committed
              </span>
              <span className="text-xs text-muted-foreground">
                auto-finishes on {currentIteration.end_date}
              </span>
              <FinishIterationButton
                projectId={projectId}
                iterationNumber={currentIteration.number}
                visible={canFinishIteration}
              />
            </div>
            <IterationGoalBar
              projectId={projectId}
              iterationId={currentIteration.id}
              initialGoal={currentIteration.goal ?? ""}
            />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            <Button
              type="button"
              variant={view === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("list")}
            >
              <ListIcon />
              List
            </Button>
            <Button
              type="button"
              variant={view === "kanban" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("kanban")}
            >
              <LayoutGrid />
              Kanban
            </Button>
          </div>
          {view === "list" && (
            <Button
              type="button"
              variant={showIcebox ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowIcebox((v) => !v)}
            >
              <Snowflake className="text-sky-600 dark:text-sky-400" />
              Icebox
              {iceboxStories.length > 0 && (
                <span className="text-xs text-muted-foreground">{iceboxStories.length}</span>
              )}
            </Button>
          )}
          {toolbar}
        </div>
      </div>

      {totalStoryCount === 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          No stories yet. Use &quot;+ Add story&quot; below to create the first one.
        </p>
      )}
      {view === "kanban" ? (
        <KanbanColumnsBoard
          projectId={projectId}
          currentIteration={currentIteration}
          initialContainers={initialContainers}
          filter={filter}
        />
      ) : (
        <BoardListView
          projectId={projectId}
          currentIteration={currentIteration}
          initialContainers={initialContainers}
          initialBacklogItems={initialBacklogItems}
          velocity={velocity}
          nextVirtualIterationNumber={nextVirtualIterationNumber}
          iterationLength={iterationLength}
          iterationGoals={iterationGoals}
          showIcebox={showIcebox}
          filter={filter}
        />
      )}
    </div>
  );
}

// The current iteration's goal (spec/screens.md "Board layout": commits on
// Enter, Esc reverts, no Save button — same UX contract as the Backlog
// virtual-group goal inputs, board-list-view.tsx's IterationGoalInput). Adds
// a brief "Saved ✓" confirmation flash on success, matching
// story-detail-panel.tsx's autosave-status convention (TASK-10 AC #4).
export function IterationGoalBar({
  projectId,
  iterationId,
  initialGoal,
}: {
  projectId: string;
  iterationId: string;
  initialGoal: string;
}) {
  const [value, setValue] = useState(initialGoal);
  const [synced, setSynced] = useState(initialGoal);
  const [error, setError] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
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
    formData.set("iteration_id", iterationId);
    formData.set("goal", trimmed);
    try {
      await updateIterationGoal(formData);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save goal");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex min-w-56 flex-1 items-center gap-2 sm:max-w-md">
      <input
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
          setShowSaved(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setValue(synced);
            setError(null);
            setShowSaved(false);
          }
        }}
        placeholder="Sprint goal"
        aria-label="Iteration goal"
        disabled={isSaving}
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm focus:outline-none disabled:opacity-60"
      />
      {showSaved && <span className="shrink-0 text-xs text-muted-foreground">Saved ✓</span>}
      {error && <span className="shrink-0 text-xs text-destructive">{error}</span>}
    </div>
  );
}

// "Finish iteration" (spec/velocity.md "Manual finish"): irreversible, so it
// confirms before calling the shared finalize_iteration RPC (TASK-10).
export function FinishIterationButton({
  projectId,
  iterationNumber,
  visible,
}: {
  projectId: string;
  iterationNumber: number;
  visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!visible) {
    return null;
  }

  function handleConfirm() {
    setError(null);
    const formData = new FormData();
    formData.set("project_id", projectId);
    startTransition(async () => {
      try {
        await finishIteration(formData);
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to finish the iteration");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setError(null);
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
          <DialogTitle>Finish iteration #{iterationNumber}?</DialogTitle>
          <DialogDescription>
            This closes the iteration today instead of on its scheduled end date. Unaccepted stories move
            to the next iteration. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Finishing…" : "Finish iteration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
