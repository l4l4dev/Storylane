"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type ParentCandidate = { id: string; number: number; title: string; isContainer: boolean };

/**
 * The former Epic dropdown (doc-18 §9) — picks an existing top-level story to
 * nest this one under (sets parent_id; the single-level trigger rejects an
 * illegal choice server-side). Picking a candidate that isn't yet a container
 * containerizes it (clears its points/state/iteration, doc-18 §4) — shown a
 * confirmation first, parity with the old Promote flow's dialog. Picking an
 * already-container target, or clearing to "None", needs no confirmation
 * since nothing is lost.
 */
export function ParentPicker({
  idPrefix,
  value,
  candidates,
  onChange,
}: {
  idPrefix: string;
  value: string | null;
  candidates: ParentCandidate[];
  onChange: (parentId: string | null) => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = candidates.find((c) => c.id === pendingId) ?? null;

  function handleSelect(next: string) {
    if (next === "") {
      onChange(null);
      return;
    }
    const target = candidates.find((c) => c.id === next);
    if (target && !target.isContainer) {
      setPendingId(next);
      return;
    }
    onChange(next);
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-parent`}>Parent</Label>
        <NativeSelect id={`${idPrefix}-parent`} value={value ?? ""} onChange={(e) => handleSelect(e.target.value)}>
          <option value="">None</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.number} {c.title}
            </option>
          ))}
        </NativeSelect>
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPendingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Make &ldquo;{pending?.title}&rdquo; an epic?</DialogTitle>
            <DialogDescription>
              &ldquo;{pending?.title}&rdquo; will become an epic and leave the board; its points and state are cleared.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const id = pendingId;
                setPendingId(null);
                if (id) onChange(id);
              }}
            >
              Make epic
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
