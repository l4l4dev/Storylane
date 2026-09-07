import { useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass, Field, inputClass } from "./Field";
import { PointButtons } from "./PointButtons";

const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;

/**
 * Posts into whichever column it's rendered on (`stateId`) — the Icebox and the first
 * `unstarted` column both get one (spec/features.md "Icebox" says new stories start there;
 * spec/screens.md "Kanban view" puts the `+` on the first unstarted column).
 */
export function QuickAddCard({
  projectId,
  stateId,
  scaleValues,
  onAdded,
}: {
  projectId: string;
  stateId: string | null;
  scaleValues: number[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [storyType, setStoryType] = useState<(typeof STORY_TYPES)[number]>("feature");
  const [points, setPoints] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setTitle("");
    setStoryType("feature");
    setPoints(null);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/projects/${projectId}/stories`, {
        method: "POST",
        body: {
          title,
          storyType,
          // Points are feature-only in this UI (see StoryCard) — a non-feature type never had a
          // button row to set one from, so it always posts null here.
          points: storyType === "feature" ? points : null,
          stateId,
        },
      });
      reset();
      onAdded();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!open) {
    return (
      <button type="button" className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => setOpen(true)}>
        + Add a story
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded border p-2" style={{ borderColor: "var(--line)" }}>
      <Field label="Title">
        <input className={inputClass} style={{ borderColor: "var(--line)" }} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label="Type">
        <select
          className={inputClass}
          style={{ borderColor: "var(--line)" }}
          value={storyType}
          onChange={(e) => {
            setStoryType(e.target.value as (typeof STORY_TYPES)[number]);
            setPoints(null);
          }}
        >
          {STORY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </Field>
      {storyType === "feature" && (
        <Field label="Points" hint="Optional — you can estimate it later.">
          <PointButtons scaleValues={scaleValues} value={points} onSelect={setPoints} />
        </Field>
      )}
      <p role="alert" className="min-h-4 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass} style={{ borderColor: "var(--line)" }}>
          Add
        </button>
        <button type="button" className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={reset}>
          Cancel
        </button>
      </div>
    </form>
  );
}
