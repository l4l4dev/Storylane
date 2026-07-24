"use client";

import { useDroppable } from "@dnd-kit/core";
import { X } from "lucide-react";
import { STORY_TYPES, storyTypeUsesPoints } from "@/lib/utils/stories";
import type { SplitChildDraft } from "@/lib/utils/split-studio";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

/**
 * One right-pane child card in the Split Studio (doc-18 §7). A dedicated,
 * lighter field set than StoryFields (title/description/story_type/points
 * only) — a split child never carries an assignee or labels (doc-18 §7:
 * "assignee is never inherited"; labels aren't part of the RPC payload
 * either), so reusing StoryFields would mean growing it with props unused
 * everywhere else it's called.
 *
 * Also a dnd-kit drop target: dragging a source task here (SplitStudio's own
 * DndContext, drop-only — this card is never itself draggable) reassigns it,
 * shown as a small removable-looking list of its currently assigned tasks.
 */
export function SplitChildCard({
  child,
  pointScale,
  taskTitleById,
  onChange,
  onRemove,
}: {
  child: SplitChildDraft;
  pointScale: number[];
  taskTitleById?: Map<string, string>;
  onChange: (patch: Partial<Omit<SplitChildDraft, "id" | "taskIds">>) => void;
  onRemove: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: child.id });
  const idPrefix = `split-child-${child.id}`;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-3 rounded-lg border p-3 shadow-xs transition-colors ${
        isOver ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-title`}>Title</Label>
          <input
            id={`${idPrefix}-title`}
            value={child.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="New story title"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove this child story" onClick={onRemove}>
          <X />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-description`}>Description</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={child.description}
          rows={3}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-type`}>Type</Label>
          <NativeSelect
            id={`${idPrefix}-type`}
            value={child.storyType}
            onChange={(e) => {
              const storyType = e.target.value;
              // storyTypeUsesPoints is the app's existing invariant
              // (parsePoints, lib/utils/board.ts, lib/utils/iterations.ts) —
              // clear points here too, or split_story would persist a value
              // for a type (chore/release) that carries none anywhere else.
              onChange(storyTypeUsesPoints(storyType) ? { storyType } : { storyType, points: null });
            }}
          >
            {STORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-points`}>Points</Label>
          <NativeSelect
            id={`${idPrefix}-points`}
            value={child.points ?? ""}
            onChange={(e) => onChange({ points: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">Unestimated</option>
            {pointScale.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {child.taskIds.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {child.taskIds.map((taskId) => (
            <li key={taskId} className="truncate rounded bg-muted px-2 py-1">
              {taskTitleById?.get(taskId) ?? taskId}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
