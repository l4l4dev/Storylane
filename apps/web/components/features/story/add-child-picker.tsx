"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { setStoryParent } from "@/app/projects/[id]/board/actions";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type AddChildCandidate = { id: string; number: number; title: string };

/**
 * "Add a child" on a container's own detail (doc-20 §6). No confirmation
 * dialog like the Parent picker's reverse direction needs: candidates are
 * already filtered to plain, parentless stories server-side (getStoryDetail),
 * so nothing here can containerize a story by surprise. router.refresh()
 * picks up setStoryParent's revalidatePath of this very page.
 */
export function AddChildPicker({
  containerId,
  projectId,
  candidates,
}: {
  containerId: string;
  projectId: string;
  candidates: AddChildCandidate[];
}) {
  const router = useRouter();
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(value: string) {
    if (!value) {
      return;
    }
    setPending(true);
    setError(null);
    // try/finally so `pending` always clears, including if setStoryParent
    // itself throws (e.g. createClient() failing) rather than resolving to
    // {ok:false} — a bare .then() with no .catch left the select disabled
    // forever on that path (/code-review).
    try {
      const result = await setStoryParent({ storyId: value, projectId, parentId: containerId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add child");
    } finally {
      setPending(false);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Add a child</Label>
      <NativeSelect
        id={id}
        value=""
        disabled={pending}
        onChange={(event) => handleSelect(event.target.value)}
      >
        <option value="">Select a story…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            #{c.number} {c.title}
          </option>
        ))}
      </NativeSelect>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
