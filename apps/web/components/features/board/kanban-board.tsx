"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List as ListIcon, Snowflake } from "lucide-react";
import { updateIterationGoal } from "@/app/projects/[id]/board/actions";
import { sumPoints } from "@/lib/utils/board";
import { BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID, STATE_COLUMNS } from "@/lib/utils/kanban";
import { useProjectStoriesRealtime } from "@/lib/supabase/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardListView } from "./board-list-view";
import { KanbanColumnsBoard } from "./kanban-columns-board";
import type { StoryCardData } from "./story-card";

export { BACKLOG_COLUMN_ID, ICEBOX_COLUMN_ID };

// Card data plus the fields the drop validation needs (see lib/utils/kanban).
export type BoardStory = StoryCardData & { iteration_id: string | null };

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
  velocity,
  nextVirtualIterationNumber,
  toolbar,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  // Keyed by KanbanColumnId: backlog, icebox, and one bucket per state column.
  initialContainers: Record<string, BoardStory[]>;
  // Current velocity, used to segment the Backlog column into virtual future
  // iterations (see spec/velocity.md "Marker computation").
  velocity: number;
  nextVirtualIterationNumber: number;
  // Filters / new-story controls supplied by the server component.
  toolbar?: ReactNode;
}) {
  const [view, setView] = useState<BoardView>("kanban");
  const [showIcebox, setShowIcebox] = useState(false);
  const router = useRouter();

  // Task 11: other users' story changes arrive here and re-fetch the board's
  // Server Component, which flows back in as `initialContainers` and syncs
  // in each view's own state — no client-side grouping logic is duplicated
  // for this, and it covers both views since only one is ever mounted.
  useProjectStoriesRealtime(projectId, () => router.refresh());

  const iceboxStories = initialContainers[ICEBOX_COLUMN_ID] ?? [];
  const iterationStories = STATE_COLUMNS.flatMap((column) => initialContainers[column] ?? []);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {currentIteration && (
          <>
            <div className="flex items-center gap-2">
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
            </div>
            <form action={updateIterationGoal} className="flex min-w-56 flex-1 items-center gap-2 sm:max-w-md">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="iteration_id" value={currentIteration.id} />
              <Input
                name="goal"
                placeholder="Sprint goal"
                defaultValue={currentIteration.goal ?? ""}
                className="h-8 flex-1"
              />
              <Button type="submit" variant="outline" size="sm">
                Save
              </Button>
            </form>
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
          {toolbar}
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanColumnsBoard
          projectId={projectId}
          currentIteration={currentIteration}
          initialContainers={initialContainers}
          velocity={velocity}
          nextVirtualIterationNumber={nextVirtualIterationNumber}
          showIcebox={showIcebox}
        />
      ) : (
        <BoardListView
          projectId={projectId}
          currentIteration={currentIteration}
          initialContainers={initialContainers}
          velocity={velocity}
          nextVirtualIterationNumber={nextVirtualIterationNumber}
          showIcebox={showIcebox}
        />
      )}
    </div>
  );
}
