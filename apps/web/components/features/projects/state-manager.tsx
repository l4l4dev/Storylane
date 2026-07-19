"use client";

import { useActionState, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  createProjectState,
  deleteProjectState,
  renameProjectState,
  reorderProjectState,
  updateProjectStateActionLabel,
  type ProjectStateActionState,
} from "@/app/projects/[id]/settings/actions";
import type { ProjectState } from "@/lib/types";
import type { StateCategory } from "@storylane/core";
import { isImeComposing } from "@/lib/utils/keyboard";
import { useInlineEdit } from "@/components/features/board/use-inline-edit";
import { MutationErrorBanner } from "@/components/features/board/mutation-error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

const CATEGORY_LABELS: Record<StateCategory, string> = {
  unstarted: "Unstarted",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as StateCategory[];

// Click-to-edit field for a state's name or action_label — same interaction
// pattern as the retired free-mode ColumnNameEditor (useInlineEdit is
// state-model-agnostic and survived that removal). `required` blocks
// committing an empty value (name); action_label is nullable, so its caller
// omits `required` and an empty commit clears it.
function InlineTextField({
  projectId,
  stateId,
  fieldName,
  initialValue,
  placeholder,
  ariaLabel,
  required,
  action,
}: {
  projectId: string;
  stateId: string;
  fieldName: string;
  initialValue: string;
  placeholder: string;
  ariaLabel: string;
  required?: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const { buttonRef, editor } = useInlineEdit({
    initialValue,
    fallbackError: "Failed to save",
    shouldCommit: required ? (value) => Boolean(value) : () => true,
    async onCommit(trimmed) {
      const formData = new FormData();
      formData.set("project_id", projectId);
      formData.set("state_id", stateId);
      formData.set(fieldName, trimmed);
      await action(formData);
    },
  });

  if (!editor.editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={editor.startEditing}
        aria-label={ariaLabel}
        className="w-full truncate rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
      >
        {editor.synced || <span className="text-muted-foreground italic">{placeholder}</span>}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <input
        autoFocus
        value={editor.value}
        onChange={(event) => editor.setValue(event.target.value)}
        onKeyDown={(event) => {
          if (isImeComposing(event)) {
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            void editor.commitAndClose("keyboard");
          } else if (event.key === "Escape") {
            event.preventDefault();
            editor.cancel("keyboard");
          }
        }}
        onBlur={() => void editor.commitAndClose("blur")}
        readOnly={editor.isSaving}
        aria-busy={editor.isSaving || undefined}
        placeholder={placeholder}
        className="h-7 w-full rounded-md border border-border bg-transparent px-1.5 text-sm focus:outline-none disabled:opacity-60"
      />
      {editor.error && <span className="text-xs text-destructive">{editor.error}</span>}
    </div>
  );
}

function DeleteStateButton({
  projectId,
  stateId,
  stateName,
}: {
  projectId: string;
  stateId: string;
  stateName: string;
}) {
  const [state, formAction] = useActionState<ProjectStateActionState, FormData>(deleteProjectState, {});
  return (
    <form action={formAction} className="flex flex-col items-end gap-0.5">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="state_id" value={stateId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete state ${stateName}`}
        className="text-muted-foreground hover:text-destructive"
      >
        <X />
      </Button>
      {state.error && <span className="max-w-40 text-right text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

/**
 * Project-settings "States" section (doc-8 §2, owner decision 2026-07-18
 * option C hybrid): reorder within category, rename, edit the action_label,
 * delete (with the plain-FK/min-count errors surfaced inline), and add a
 * state. Category is read-only after creation (spec/data-model.md
 * "Integrity rules") — shown as a badge, never an editable field.
 */
export function StateManager({
  projectId,
  states,
  canManage,
  canDelete,
}: {
  projectId: string;
  states: ProjectState[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const [reorderError, setReorderError] = useState<string | null>(null);
  // The state currently mid-reorder — its arrows disable so a fast
  // double-click can't fire two overlapping reorder RPCs racing the same
  // pair (the advisory lock serializes them server-side, but the second
  // would read stale positions and land the UI one step off).
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sorted = [...states].sort((a, b) => a.position - b.position);
  const byCategory = new Map<StateCategory, ProjectState[]>();
  for (const state of sorted) {
    (byCategory.get(state.category) ?? byCategory.set(state.category, []).get(state.category)!).push(state);
  }

  function move(stateId: string, direction: "up" | "down") {
    setReorderError(null);
    setReorderingId(stateId);
    const formData = new FormData();
    formData.set("project_id", projectId);
    formData.set("state_id", stateId);
    formData.set("direction", direction);
    startTransition(async () => {
      try {
        await reorderProjectState(formData);
      } catch (err) {
        setReorderError(err instanceof Error ? err.message : "Failed to reorder");
      } finally {
        setReorderingId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {reorderError && <MutationErrorBanner message={reorderError} onDismiss={() => setReorderError(null)} />}
      <ul className="flex flex-col gap-1.5">
        {sorted.map((state) => {
          const categoryStates = byCategory.get(state.category) ?? [];
          const rank = categoryStates.findIndex((s) => s.id === state.id);
          return (
            <li key={state.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
              {canManage && (
                <div className="flex shrink-0 flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={rank === 0 || reorderingId === state.id}
                    aria-label={`Move ${state.name} up within ${CATEGORY_LABELS[state.category]}`}
                    onClick={() => move(state.id, "up")}
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={rank === categoryStates.length - 1 || reorderingId === state.id}
                    aria-label={`Move ${state.name} down within ${CATEGORY_LABELS[state.category]}`}
                    onClick={() => move(state.id, "down")}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </div>
              )}

              <span className="w-24 shrink-0 truncate rounded-full bg-muted px-2 py-0.5 text-center text-xs font-medium text-muted-foreground">
                {CATEGORY_LABELS[state.category]}
              </span>

              <div className="min-w-0 flex-1">
                {canManage ? (
                  <InlineTextField
                    projectId={projectId}
                    stateId={state.id}
                    fieldName="name"
                    initialValue={state.name}
                    placeholder="Name"
                    ariaLabel={`Edit name: ${state.name}`}
                    required
                    action={renameProjectState}
                  />
                ) : (
                  <span className="block truncate px-1.5 py-1 text-sm">{state.name}</span>
                )}
              </div>

              <div className="w-36 shrink-0">
                {canManage ? (
                  <InlineTextField
                    projectId={projectId}
                    stateId={state.id}
                    fieldName="action_label"
                    initialValue={state.action_label ?? ""}
                    placeholder="No button"
                    ariaLabel={`Edit action label for ${state.name}: ${state.action_label ?? "none"}`}
                    action={updateProjectStateActionLabel}
                  />
                ) : (
                  <span className="block truncate px-1.5 py-1 text-sm text-muted-foreground">
                    {state.action_label ?? "—"}
                  </span>
                )}
              </div>

              {canDelete && <DeleteStateButton projectId={projectId} stateId={state.id} stateName={state.name} />}
            </li>
          );
        })}
      </ul>

      {canManage && (
        <form action={createProjectState} className="flex items-end gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="new-state-name">New state</Label>
            <Input id="new-state-name" name="name" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-state-category">Category</Label>
            <NativeSelect id="new-state-category" name="category" defaultValue="unstarted">
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
