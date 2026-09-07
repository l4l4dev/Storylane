import { useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass, Field, inputClass } from "./Field";

const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;

/**
 * New stories start in the Icebox (spec/features.md "Icebox"), so this always posts
 * `stateId: null` — the quick-add sits on the Icebox column, the group it adds to (principle 4).
 */
export function QuickAddCard({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [storyType, setStoryType] = useState<(typeof STORY_TYPES)[number]>("feature");
  const [points, setPoints] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setTitle("");
    setStoryType("feature");
    setPoints("");
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
          points: points === "" ? null : Number(points),
          stateId: null,
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
          onChange={(e) => setStoryType(e.target.value as (typeof STORY_TYPES)[number])}
        >
          {STORY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Points">
        <input
          className={inputClass}
          style={{ borderColor: "var(--line)" }}
          type="number"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
        />
      </Field>
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
