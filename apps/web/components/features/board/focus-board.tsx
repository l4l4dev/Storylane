"use client";

import { useState, useTransition } from "react";
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
import { CircleCheckBig, CircleDot, ListTodo, PlayCircle, type LucideIcon } from "lucide-react";
import { setStoryFocus } from "@/app/projects/[id]/board/actions";
import { beforeAnchorId, findContainer, moveBetweenContainers, storyById } from "@/lib/utils/board";
import { reorderContainer } from "@/lib/utils/board-dnd";
import {
  FOCUS_DRAG_TARGETS,
  evaluateFocusDrop,
  focusColumnForStory,
  groupDoneStories,
  localDateKey,
  todayLocalDateKey,
  type FocusColumnId,
  type FocusDragTarget,
} from "@/lib/utils/focus";
import { matchesStoryFilter, type StoryFilter } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import type { StateCategory } from "@storylane/core";
import { MutationErrorBanner } from "./mutation-error-banner";
import { QuickAddComposer } from "./quick-add-composer";
import { StoryCard } from "./story-card";
import { StoryListRow } from "./story-list-row";
import { SortableItem } from "./sortable-item";
import type { BoardStory, IterationMeta } from "./kanban-board";

type DragColumnMeta = { label: string; icon: LucideIcon };

const DRAG_COLUMN_META: Record<FocusDragTarget, DragColumnMeta> = {
  todo: { label: "Todo", icon: ListTodo },
  today: { label: "Today", icon: CircleDot },
};

function SortableFocusCard({ story, projectId }: { story: BoardStory; projectId: string }) {
  return (
    <SortableItem id={story.id}>
      <StoryCard story={story} projectId={projectId} />
    </SortableItem>
  );
}

function DroppableFocusList({
  containerId,
  stories,
  projectId,
}: {
  containerId: string;
  stories: BoardStory[];
  projectId: string;
}) {
  const { setNodeRef } = useDroppable({ id: containerId });

  return (
    <SortableContext items={stories.map((s) => s.id)} strategy={verticalListSortingStrategy}>
      <ul ref={setNodeRef} className="flex min-h-10 flex-1 flex-col gap-2">
        {stories.map((story) => (
          <SortableFocusCard key={story.id} story={story} projectId={projectId} />
        ))}
      </ul>
    </SortableContext>
  );
}

function DragColumn({
  columnId,
  stories,
  composer,
  children,
}: {
  columnId: FocusDragTarget;
  stories: BoardStory[];
  composer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const meta = DRAG_COLUMN_META[columnId];
  const Icon = meta.icon;

  return (
    <section className="flex h-[calc(100dvh-13rem)] w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">{meta.label}</h2>
        <span className="text-xs text-muted-foreground">{stories.length}</span>
      </header>
      {composer && <div className="px-3 pb-2">{composer}</div>}
      <div className="flex flex-1 flex-col overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

// Read-only column (In progress / Done) — no drag, one-click transition
// buttons instead (spec/screens.md "Focus view": "In progress and Done
// columns are not drop targets").
function ReadOnlyColumn({
  icon: Icon,
  label,
  count,
  children,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-[calc(100dvh-13rem)] w-80 shrink-0 flex-col rounded-lg border border-border bg-muted/30">
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">{children}</div>
    </section>
  );
}

// Focus view (spec/screens.md "Focus view") — a personal,
// Daily-inspired execution view over the current iteration's stories.
// Todo/Today are draggable (drag only ever sets/clears `focus`, never
// state); In progress and Done are read-only, using the same one-click
// transition buttons as the List view.
export function FocusBoard({
  projectId,
  currentIteration,
  states,
  initialContainers,
  filter,
  pointScale,
}: {
  projectId: string;
  currentIteration: IterationMeta | null;
  states: ProjectState[];
  initialContainers: Record<string, BoardStory[]>;
  filter: StoryFilter;
  pointScale: number[];
}) {
  const [containers, setContainers] = useState(initialContainers);
  const [synced, setSynced] = useState(initialContainers);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (synced !== initialContainers) {
    setSynced(initialContainers);
    setContainers(initialContainers);
  }

  function categoryOf(story: BoardStory): StateCategory | null {
    if (story.state_id === null) return null;
    return states.find((s) => s.id === story.state_id)?.category ?? null;
  }

  const currentIterationId = currentIteration?.id ?? null;
  const allStories = Object.values(containers).flat();

  const buckets: Record<FocusColumnId, BoardStory[]> = {
    todo: [],
    today: [],
    in_progress: [],
    done: [],
  };
  for (const story of allStories) {
    if (!matchesStoryFilter(story, filter)) {
      continue;
    }
    const column = focusColumnForStory({ category: categoryOf(story), focus: story.focus, iteration_id: story.iteration_id }, currentIterationId);
    if (column) {
      buckets[column].push(story);
    }
  }
  for (const target of FOCUS_DRAG_TARGETS) {
    buckets[target].sort((a, b) => a.position - b.position);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Only Todo/Today ever appear as dnd-kit containers — In progress/Done
  // cards aren't draggable, so they're never registered as
  // sortable/droppable and can't be reached by this lookup.
  const dragContainers: Record<string, BoardStory[]> = {
    todo: buckets.todo,
    today: buckets.today,
  };

  function isAllowedMove(storyId: string, target: string): boolean {
    const story = storyById(dragContainers, storyId);
    if (!story || !FOCUS_DRAG_TARGETS.includes(target as FocusDragTarget)) {
      return false;
    }
    return evaluateFocusDrop({ category: categoryOf(story) }, target as FocusDragTarget).ok;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) {
      return;
    }
    const overContainer = findContainer(dragContainers, String(over.id));
    if (!overContainer) {
      return;
    }

    setContainers((prev) => moveBetweenContainers(prev, String(active.id), overContainer, String(over.id), isAllowedMove));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) {
      setContainers(synced);
      return;
    }

    const overContainer = findContainer(dragContainers, String(over.id));
    if (!overContainer || !isAllowedMove(String(active.id), overContainer)) {
      setContainers(synced);
      return;
    }

    const items = containers[overContainer] ?? [];
    const reordered = reorderContainer(items, String(active.id), String(over.id));

    setContainers((prev) => ({ ...prev, [overContainer]: reordered }));
    setDragError(null);

    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("story_id", String(active.id));
    formData.set("target", overContainer);
    // Intent, not a full sequence: the neighbour the card now sits before (or
    // nothing = append) — the server re-derives dense positions (TASK-56).
    const beforeId = beforeAnchorId(reordered, String(active.id));
    if (beforeId) {
      formData.set("before_item_id", beforeId);
    }
    startTransition(async () => {
      try {
        await setStoryFocus(formData);
      } catch (err) {
        setContainers(synced);
        setDragError(err instanceof Error ? err.message : "Failed to move the story");
      }
    });
  }

  const activeStory = activeId ? storyById(dragContainers, activeId) : undefined;
  const todayKey = todayLocalDateKey();
  const doneGroups = groupDoneStories(
    buckets.done.map((story) => ({ ...story, completedDateKey: story.completed_at ? localDateKey(story.completed_at) : todayKey })),
    todayKey,
  );

  return (
    <DndContext
      id="focus-board"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {dragError && <MutationErrorBanner message={dragError} onDismiss={() => setDragError(null)} />}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {FOCUS_DRAG_TARGETS.map((target) => (
          <DragColumn
            key={target}
            columnId={target}
            stories={buckets[target]}
            composer={target === "todo" ? <QuickAddComposer projectId={projectId} target="unstarted" /> : undefined}
          >
            <DroppableFocusList containerId={target} stories={buckets[target]} projectId={projectId} />
          </DragColumn>
        ))}

        <ReadOnlyColumn icon={PlayCircle} label="In progress" count={buckets.in_progress.length}>
          {buckets.in_progress.map((story) => (
            <StoryListRow key={story.id} story={story} projectId={projectId} states={states} pointScale={pointScale} />
          ))}
        </ReadOnlyColumn>

        <ReadOnlyColumn icon={CircleCheckBig} label="Done" count={buckets.done.length}>
          {doneGroups.map((group) => (
            <div key={group.dateKey} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">{group.label}</h3>
              {group.stories.map((story) => (
                <StoryListRow key={story.id} story={story} projectId={projectId} states={states} pointScale={pointScale} />
              ))}
            </div>
          ))}
        </ReadOnlyColumn>
      </div>

      <DragOverlay>
        {activeStory && (
          <div className="w-64 rotate-1 cursor-grabbing">
            <StoryCard story={activeStory} projectId={projectId} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
