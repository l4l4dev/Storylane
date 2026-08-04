"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, useDroppable, type DragEndEvent, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { splitStory, type SplitChildInput } from "@/app/stories/[id]/actions";
import {
  addChild,
  addChildFromSelection,
  applyTaskDrop,
  removeChild,
  updateChild,
  SOURCE_TASKS_DROP_ID,
  type SplitChildDraft,
} from "@/lib/utils/split-studio";
import { storyTypeUsesPoints } from "@/lib/utils/stories";
import { Button } from "@/components/ui/button";
import { SplitChildCard } from "./split-child-card";
import { SplitSourceTaskRow } from "./split-source-task-row";

export type SplitSourceTask = { id: string; title: string; is_done: boolean };

/**
 * Split Studio (doc-18 §7, spec/screens.md "Split Studio").
 */
export function SplitStudio({
  storyId,
  projectId,
  title,
  description,
  points,
  tasks,
  pointScale,
}: {
  storyId: string;
  projectId: string;
  title: string;
  description: string | null;
  points: number | null;
  tasks: SplitSourceTask[];
  pointScale: number[];
}) {
  const router = useRouter();
  const [children, setChildren] = useState<SplitChildDraft[]>([]);
  const [selectedText, setSelectedText] = useState("");
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const committingRef = useRef(false);
  const { setNodeRef: setSourceDropRef, isOver: isOverSource } = useDroppable({ id: SOURCE_TASKS_DROP_ID });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const taskTitleById = new Map(tasks.map((t) => [t.id, t.title]));
  const pointTotal = children.reduce(
    (total, child) => total + (storyTypeUsesPoints(child.storyType) ? (child.points ?? 0) : 0),
    0,
  );
  const hasBlankTitle = children.some((c) => !c.title.trim());
  // Which child (by title) currently holds each task, if any — shown on the
  // left pane's own row so a dragged-away task reads differently from one
  // still needing a home.
  const assignedChildTitleByTaskId = new Map(
    children.flatMap((child) => child.taskIds.map((taskId) => [taskId, child.title] as const)),
  );

  // selectionchange rather than onMouseUp on the paragraph: a mouse-up handler
  // sees only a pointer drag, so caret browsing, assistive tech and touch
  // selection could not reach "Extract selection" at all. This event fires
  // whatever made the selection.
  //
  // It does not make the paragraph keyboard-selectable on its own — it is a
  // plain <p> with no tabIndex, so plain shift+arrow does nothing without caret
  // browsing on. What keeps that from being a dead end is the disabled button
  // stating its reason in place, plus "+ new story" as the other way in.
  //
  // Only the part of the selection inside the description counts. It is clipped
  // rather than rejected for straddling the paragraph: a triple-click promotes
  // the range end past the <p>, and Cmd+A puts both ends outside it, so
  // demanding both boundaries be inside would drop the two selections a user is
  // most likely to make on a whole paragraph.
  //
  // A selection that misses the paragraph entirely leaves the last value alone —
  // clicking the Extract button itself moves the selection out, and clearing on
  // that would disable the button before its own click could land.
  useEffect(() => {
    function readSelection() {
      const node = descriptionRef.current;
      const selection = window.getSelection();
      if (!node || !selection || selection.rangeCount === 0) {
        return;
      }
      const range = selection.getRangeAt(0);
      if (!range.intersectsNode(node)) {
        return;
      }
      const withinDescription = document.createRange();
      withinDescription.selectNodeContents(node);
      const clipped = range.cloneRange();
      if (clipped.compareBoundaryPoints(Range.START_TO_START, withinDescription) < 0) {
        clipped.setStart(withinDescription.startContainer, withinDescription.startOffset);
      }
      if (clipped.compareBoundaryPoints(Range.END_TO_END, withinDescription) > 0) {
        clipped.setEnd(withinDescription.endContainer, withinDescription.endOffset);
      }
      setSelectedText(clipped.toString());
    }
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, []);

  function handleExtractSelection() {
    setChildren((prev) => addChildFromSelection(prev, selectedText));
    setSelectedText("");
    window.getSelection()?.removeAllRanges();
  }

  function handleDragEnd(event: DragEndEvent) {
    setChildren((prev) => applyTaskDrop(prev, String(event.active.id), event.over ? String(event.over.id) : null));
  }

  async function handleCommit() {
    // A second click before the first render disables the button would still
    // read the stale `pending` from this closure — a synchronous ref (not
    // React state, which only takes effect next render) is what actually
    // blocks the double RPC call.
    if (children.length === 0 || hasBlankTitle || committingRef.current) {
      return;
    }
    committingRef.current = true;
    setPending(true);
    setError(null);
    const payload: SplitChildInput[] = children.map((c) => ({
      title: c.title,
      description: c.description,
      storyType: c.storyType,
      points: c.points,
      taskIds: c.taskIds,
    }));
    const result = await splitStory(storyId, payload);
    setPending(false);
    if (!result.ok) {
      committingRef.current = false;
      setError(result.message);
      return;
    }
    // Return to the board/List, not the story detail — a container only
    // ever shows in the List view's Icebox (doc-18 §9), so both are forced
    // open for this one navigation (spec/ux-principles.md §8/§10: no
    // teleporting the user somewhere else after commit).
    router.push(`/projects/${projectId}/board?view=list&icebox=1`);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 p-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4">
          <h1 className="text-xl font-bold">{title}</h1>
          {description && (
            <p
              ref={descriptionRef}
              data-testid="split-source-description"
              className="whitespace-pre-wrap text-sm text-muted-foreground select-text"
            >
              {description}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Button type="button" size="xs" variant="outline" disabled={!selectedText.trim()} onClick={handleExtractSelection}>
              Extract selection as new story
            </Button>
            {!selectedText.trim() && (
              <p className="text-xs text-muted-foreground">Select text above to extract it as a new story.</p>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Tasks</h2>
            {tasks.length > 0 ? (
              <>
                <p className="mb-1.5 text-xs text-muted-foreground">Drag a task onto a new story card to reassign it.</p>
                <ul ref={setSourceDropRef} className={`flex flex-col gap-1.5 rounded-lg p-1 ${isOverSource ? "bg-primary/5" : ""}`}>
                  {tasks.map((task) => (
                    <SplitSourceTaskRow key={task.id} task={task} assignedToTitle={assignedChildTitleByTaskId.get(task.id)} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">New stories</h2>
            <Button type="button" size="xs" onClick={() => setChildren((prev) => addChild(prev))}>
              + new story
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {children.map((child) => (
              <SplitChildCard
                key={child.id}
                child={child}
                pointScale={pointScale}
                taskTitleById={taskTitleById}
                onChange={(patch) => setChildren((prev) => updateChild(prev, child.id, patch))}
                onRemove={() => setChildren((prev) => removeChild(prev, child.id))}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {pointTotal} of {points ?? "—"} pts
          </p>

          {children.length > 0 && (
            <div className="rounded-lg border border-dashed border-border p-3 text-sm">
              <p className="mb-1 font-medium">This will create {children.length} new {children.length === 1 ? "story" : "stories"}:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {children.map((child) => (
                  <li key={child.id}>{child.title.trim() || "(untitled)"}</li>
                ))}
              </ul>
            </div>
          )}

          {/* A blank title must never reach split_story — the RPC's raw
              not-null violation isn't a meaningful error message
              (ux-principles principle 2). Shown inline rather than only
              disabling Split, so it's clear why the button won't go. */}
          {hasBlankTitle && (
            <p className="text-sm text-muted-foreground">Give every new story a title before splitting.</p>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button
            type="button"
            disabled={children.length === 0 || hasBlankTitle || pending}
            onClick={() => void handleCommit()}
          >
            {pending ? "Splitting…" : "Split"}
          </Button>
        </section>
      </div>
    </DndContext>
  );
}
