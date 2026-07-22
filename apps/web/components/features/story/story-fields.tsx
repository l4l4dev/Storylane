"use client";

import type { KeyboardEvent } from "react";
import { STORY_TYPES } from "@/lib/utils/stories";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export type StoryFieldsValue = {
  title: string;
  description: string;
  storyType: string;
  points: number | null;
  epicId: string;
  assigneeId: string;
  labelIds: string[];
};

type TextField = "title" | "description";
type DiscreteField = Exclude<keyof StoryFieldsValue, TextField>;

// The story field editors shared by StoryDetailPanel (autosave, per-field
// locking) and DraftStoryCard (local state, explicit Save) — same markup,
// different wiring (TASK-82 plan item 1: "do NOT fork the field markup").
// Text fields (title/description) get focus/blur/keydown hooks for the
// autosave caller's debounce+lock bookkeeping; the draft caller can leave
// those undefined since it has none of that to do.
export function StoryFields({
  value,
  onTextChange,
  onTextFocus,
  onTextBlur,
  onTextKeyDown,
  onDiscreteChange,
  pointScale,
  epics,
  members,
  labels,
  idPrefix,
  titleAutoFocus,
  hidePointsAndEpic,
}: {
  value: StoryFieldsValue;
  onTextChange: (field: TextField, value: string) => void;
  onTextFocus?: (field: TextField) => void;
  onTextBlur?: (field: TextField) => void;
  onTextKeyDown?: (field: TextField, event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onDiscreteChange: <F extends DiscreteField>(field: F, value: StoryFieldsValue[F]) => void;
  pointScale: number[];
  epics: { id: string; name: string }[];
  members: { id: string; name: string; isAgent?: boolean }[];
  labels: { id: string; name: string }[];
  // Distinguishes ids between the detail panel and a draft card that could
  // both be mounted at once (e.g. a draft open while the peek is too).
  idPrefix: string;
  titleAutoFocus?: boolean;
  // TASK-147: the hidden personal project has no epics and never estimates
  // (doc-8 §10 "title only, defaults for everything else"; set_story_state
  // also skips the estimation gate for it server-side, TASK-139) — omitted
  // entirely rather than shown-disabled (ux-principles principle 1: no dead
  // controls).
  hidePointsAndEpic?: boolean;
}) {
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("title")}>Title</Label>
        <input
          id={id("title")}
          value={value.title}
          required
          autoFocus={titleAutoFocus}
          onChange={(e) => onTextChange("title", e.target.value)}
          onFocus={() => onTextFocus?.("title")}
          onBlur={() => onTextBlur?.("title")}
          onKeyDown={(e) => onTextKeyDown?.("title", e)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id("description")}>Description</Label>
        <Textarea
          id={id("description")}
          value={value.description}
          rows={4}
          onChange={(e) => onTextChange("description", e.target.value)}
          onFocus={() => onTextFocus?.("description")}
          onBlur={() => onTextBlur?.("description")}
          onKeyDown={(e) => onTextKeyDown?.("description", e)}
        />
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={id("type")}>Type</Label>
          <NativeSelect
            id={id("type")}
            value={value.storyType}
            onChange={(e) => onDiscreteChange("storyType", e.target.value)}
          >
            {STORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </div>

        {!hidePointsAndEpic && (
          <div className="flex w-32 flex-col gap-1.5">
            <Label htmlFor={id("points")}>Points</Label>
            {/* Points come from the project's point scale — no free numeric
                input (see spec/features.md). */}
            <NativeSelect
              id={id("points")}
              value={value.points ?? ""}
              onChange={(e) => onDiscreteChange("points", e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">Unestimated</option>
              {pointScale.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>

      <div className="flex gap-4">
        {!hidePointsAndEpic && (
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor={id("epic")}>Epic</Label>
            <NativeSelect
              id={id("epic")}
              value={value.epicId}
              onChange={(e) => onDiscreteChange("epicId", e.target.value)}
            >
              <option value="">None</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor={id("assignee")}>Assignee</Label>
          <NativeSelect
            id={id("assignee")}
            value={value.assigneeId}
            onChange={(e) => onDiscreteChange("assigneeId", e.target.value)}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.isAgent ? " (agent)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {labels.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Labels</span>
          <div className="flex flex-wrap gap-2">
            {labels.map((label) => (
              <label key={label.id} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={value.labelIds.includes(label.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...value.labelIds, label.id]
                      : value.labelIds.filter((id) => id !== label.id);
                    onDiscreteChange("labelIds", next);
                  }}
                  className="accent-primary"
                />
                {label.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
