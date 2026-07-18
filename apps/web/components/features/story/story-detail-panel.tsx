"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { updateStory, type StoryDetail } from "@/app/stories/[id]/actions";
import { useStoryRealtime, type StoryRealtimeRow } from "@/lib/supabase/realtime";
import { describeActivity } from "@/lib/utils/activity";
import { formatDateTime } from "@/lib/utils/format";
import { isImeComposing } from "@/lib/utils/keyboard";
import { STORY_TYPES } from "@/lib/utils/stories";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CommentThread } from "./comment-thread";
import { TaskChecklist } from "./task-checklist";
import { TransitionButtons } from "./transition-buttons";

// The story fields this panel edits inline — everything else on
// `StoryDetail` (comments, tasks, epics/labels/members lists,
// state, number, pointScale) is read-only display data the panel always
// takes fresh from the latest `detail` prop, never locked.
type EditableFields = {
  title: string;
  description: string;
  storyType: string;
  points: number | null;
  epicId: string;
  assigneeId: string;
  labelIds: string[];
};

const LOCKABLE_FIELDS = [
  "title",
  "description",
  "storyType",
  "points",
  "epicId",
  "assigneeId",
  "labelIds",
] as const;
type LockableField = (typeof LOCKABLE_FIELDS)[number];

function toEditableFields(detail: StoryDetail): EditableFields {
  return {
    title: detail.title,
    description: detail.description ?? "",
    storyType: detail.storyType,
    points: detail.points,
    epicId: detail.epicId ?? "",
    assigneeId: detail.assigneeId ?? "",
    labelIds: detail.labelIds,
  };
}

function toEditableFieldsFromRealtime(row: StoryRealtimeRow): EditableFields {
  return {
    title: row.title,
    description: row.description ?? "",
    storyType: row.story_type,
    points: row.points,
    epicId: row.epic_id ?? "",
    assigneeId: row.assignee_id ?? "",
    // Realtime doesn't carry the joined story_labels rows — labels only
    // ever change through this panel's own save, so they're never merged
    // remotely (there's nothing to merge: no other surface edits them).
    labelIds: [],
  };
}

type SaveStatus = "saved" | "saving" | "error";

// Renders the full story detail content — editable fields, state-transition
// buttons, the task checklist, and the comment thread (see spec/screens.md
// "Board layout": the inline expansion shows "the same content as
// `/stories/[id]`"). Used both by that standalone page and by the board's
// inline expansion (story-card.tsx), which is why mutations flow through the
// optional `onMutated` hook rather than relying solely on route revalidation.
export function StoryDetailPanel({
  detail,
  onMutated,
}: {
  detail: StoryDetail;
  onMutated?: () => Promise<void> | void;
}) {
  const localRef = useRef<EditableFields>(toEditableFields(detail));
  const [local, setLocalState] = useState<EditableFields>(localRef.current);
  const syncedRef = useRef<EditableFields>(toEditableFields(detail));
  const dirtyRef = useRef<Set<LockableField>>(new Set());
  const focusedRef = useRef<Set<LockableField>>(new Set());
  const savingRef = useRef(false);
  const needsTrailingSaveRef = useRef(false);
  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevDetailRef = useRef(detail);

  const [status, setStatus] = useState<SaveStatus>("saved");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  function setLocal(patch: Partial<EditableFields>) {
    localRef.current = { ...localRef.current, ...patch };
    setLocalState(localRef.current);
  }

  function isLocked(field: LockableField): boolean {
    return focusedRef.current.has(field) || dirtyRef.current.has(field);
  }

  // Applies a remote field snapshot (Realtime, or a fresh `detail` prop from
  // a task/comment mutation elsewhere) — only into fields that aren't
  // currently locked (spec/screens.md "Conflict & failure rules": "a text
  // field is locked while focused or dirty ... Remote updates apply
  // immediately to unlocked fields"). No self-echo special-casing is
  // needed: `synced` (and thus `local`, for an unlocked field) is set to
  // the exact value our own save just confirmed before the matching
  // Realtime echo can arrive, so adopting it again is a no-op; a field
  // dirtied again in the meantime is locked, so the stale echo is ignored.
  function mergeRemote(remote: EditableFields, options: { includeLabels: boolean }) {
    const patch: Partial<EditableFields> = {};
    for (const field of LOCKABLE_FIELDS) {
      if (field === "labelIds" && !options.includeLabels) {
        continue;
      }
      if (isLocked(field)) {
        continue;
      }
      syncedRef.current[field] = remote[field] as never;
      patch[field] = remote[field] as never;
    }
    if (Object.keys(patch).length > 0) {
      setLocal(patch);
    }
  }

  async function runSave() {
    if (savingRef.current) {
      needsTrailingSaveRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    setErrorMessage(null);

    const snapshot = localRef.current;
    const result = await updateStory({
      storyId: detail.id,
      title: snapshot.title,
      description: snapshot.description.trim() ? snapshot.description : null,
      storyType: snapshot.storyType,
      points: snapshot.points,
      epicId: snapshot.epicId || null,
      assigneeId: snapshot.assigneeId || null,
      labelIds: snapshot.labelIds,
    });

    savingRef.current = false;

    if (!result.ok) {
      if (result.reason === "not_found") {
        setDeleted(true);
        return;
      }
      setStatus("error");
      setErrorMessage(result.message);
      return;
    }

    const serverFields = toEditableFields({ ...detail, ...result.story });
    syncedRef.current = { ...syncedRef.current, ...serverFields };
    const patch: Partial<EditableFields> = {};
    for (const field of LOCKABLE_FIELDS) {
      const untouchedSinceSnapshot =
        field === "labelIds"
          ? localRef.current.labelIds === snapshot.labelIds
          : localRef.current[field] === snapshot[field];
      if (untouchedSinceSnapshot) {
        dirtyRef.current.delete(field);
        if (!focusedRef.current.has(field)) {
          patch[field] = serverFields[field] as never;
        }
      }
    }
    if (Object.keys(patch).length > 0) {
      setLocal(patch);
    }

    if (needsTrailingSaveRef.current) {
      needsTrailingSaveRef.current = false;
      void runSave();
      return;
    }

    setStatus(dirtyRef.current.size > 0 ? "saving" : "saved");
  }

  function handleTextChange(field: "title" | "description", value: string) {
    setLocal({ [field]: value } as Partial<EditableFields>);
    dirtyRef.current.add(field);
    setStatus("saving");
    clearTimeout(textDebounceRef.current);
    textDebounceRef.current = setTimeout(() => void runSave(), 800);
  }

  function handleTextBlur(field: "title" | "description") {
    focusedRef.current.delete(field);
    if (field === "title" && !localRef.current.title.trim()) {
      // Empty title is never saved (NOT NULL) — revert instead of sending it.
      dirtyRef.current.delete("title");
      setLocal({ title: syncedRef.current.title });
      return;
    }
    if (dirtyRef.current.has(field)) {
      clearTimeout(textDebounceRef.current);
      void runSave();
    }
  }

  function handleTextKeyDown(field: "title" | "description", event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // isImeComposing guards the IME candidate-window Escape (the peek's own
    // window listener also guards on isComposing).
    if (event.key !== "Escape" || isImeComposing(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(textDebounceRef.current);
    dirtyRef.current.delete(field);
    setLocal({ [field]: syncedRef.current[field] } as Partial<EditableFields>);
    event.currentTarget.blur();
  }

  function handleDiscreteChange<F extends Exclude<LockableField, "title" | "description">>(
    field: F,
    value: EditableFields[F],
  ) {
    setLocal({ [field]: value } as Partial<EditableFields>);
    dirtyRef.current.add(field);
    setStatus("saving");
    void runSave();
  }

  // Realtime keeps this story's fields, and its comment thread, in sync
  // with other users — fields merge only into unlocked ones; a
  // DELETE switches to the "story was deleted" state (spec/screens.md).
  useStoryRealtime(
    detail.id,
    (row) => mergeRemote(toEditableFieldsFromRealtime(row), { includeLabels: false }),
    () => setDeleted(true),
    () => void onMutated?.(),
  );

  // A fresh `detail` prop (e.g. after a task/comment mutation elsewhere
  // calls `onMutated`, which re-fetches the whole story) must go through the
  // same per-field lock as Realtime — otherwise finishing a task while
  // mid-edit on the title could silently overwrite it.
  useEffect(() => {
    if (prevDetailRef.current === detail) {
      return;
    }
    prevDetailRef.current = detail;
    mergeRemote(toEditableFields(detail), { includeLabels: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  // Flushes on unmount — covers both "peek closed" and "route changed away
  // from /stories/[id]" (spec: "Pending debounced edits flush on blur, on
  // peek close, and on route change"). React never fires onBlur for an
  // input that's unmounting, so this is the only hook available; its save
  // is necessarily fire-and-forget (no component left to show a retry if it
  // fails) — an accepted Phase 1 gap.
  useEffect(() => {
    return () => {
      clearTimeout(textDebounceRef.current);
      // Deliberately reads the ref's value *at cleanup time* (not a stale
      // closure over its value when the effect was set up) — this isn't the
      // "ref may have changed by cleanup time" DOM-node footgun the lint
      // rule warns about, it's a plain mutable Set this effect is meant to
      // read fresh.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (dirtyRef.current.size > 0) {
        void runSave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id]);

  if (deleted) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This story was deleted. Your unsaved changes are kept below so you can copy them.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detail-title">Title</Label>
          <input
            id="detail-title"
            readOnly
            value={local.title}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detail-description">Description</Label>
          <Textarea id="detail-description" readOnly value={local.description} rows={4} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <TransitionButtons
          storyId={detail.id}
          projectId={detail.projectId}
          state={detail.state}
          storyType={detail.storyType}
          points={detail.points}
          pointScale={detail.pointScale}
        />
        <span
          className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
          aria-live="polite"
        >
          {status === "saving" && "Saving…"}
          {status === "saved" && "Saved ✓"}
          {status === "error" && (
            <>
              {errorMessage ?? "Failed to save"}{" "}
              <button type="button" className="underline" onClick={() => void runSave()}>
                Retry
              </button>
            </>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detail-title">Title</Label>
          <input
            id="detail-title"
            value={local.title}
            required
            onChange={(e) => handleTextChange("title", e.target.value)}
            onFocus={() => focusedRef.current.add("title")}
            onBlur={() => handleTextBlur("title")}
            onKeyDown={(e) => handleTextKeyDown("title", e)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detail-description">Description</Label>
          <Textarea
            id="detail-description"
            value={local.description}
            rows={4}
            onChange={(e) => handleTextChange("description", e.target.value)}
            onFocus={() => focusedRef.current.add("description")}
            onBlur={() => handleTextBlur("description")}
            onKeyDown={(e) => handleTextKeyDown("description", e)}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="detail-type">Type</Label>
            <NativeSelect
              id="detail-type"
              value={local.storyType}
              onChange={(e) => handleDiscreteChange("storyType", e.target.value)}
            >
              {STORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex w-32 flex-col gap-1.5">
            <Label htmlFor="detail-points">Points</Label>
            {/* Points come from the project's point scale — no free numeric
                input (see spec/features.md). */}
            <NativeSelect
              id="detail-points"
              value={local.points ?? ""}
              onChange={(e) => handleDiscreteChange("points", e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">Unestimated</option>
              {detail.pointScale.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="detail-epic">Epic</Label>
            <NativeSelect
              id="detail-epic"
              value={local.epicId}
              onChange={(e) => handleDiscreteChange("epicId", e.target.value)}
            >
              <option value="">None</option>
              {detail.epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="detail-assignee">Assignee</Label>
            <NativeSelect
              id="detail-assignee"
              value={local.assigneeId}
              onChange={(e) => handleDiscreteChange("assigneeId", e.target.value)}
            >
              <option value="">Unassigned</option>
              {detail.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        {detail.labels.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Labels</span>
            <div className="flex flex-wrap gap-2">
              {detail.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={local.labelIds.includes(label.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...local.labelIds, label.id]
                        : local.labelIds.filter((id) => id !== label.id);
                      handleDiscreteChange("labelIds", next);
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

      <TaskChecklist storyId={detail.id} tasks={detail.tasks} onMutated={onMutated} />
      <CommentThread
        storyId={detail.id}
        projectId={detail.projectId}
        comments={detail.comments}
        onMutated={onMutated}
      />

      {detail.history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">History</h3>
          <ul className="flex flex-col gap-1.5">
            {detail.history.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {describeActivity({
                    action: entry.action,
                    payload: entry.payload,
                    actorName: entry.actorName,
                    storyTitle: detail.title,
                  })}
                </span>
                <time className="shrink-0" dateTime={entry.createdAt}>
                  {formatDateTime(entry.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
