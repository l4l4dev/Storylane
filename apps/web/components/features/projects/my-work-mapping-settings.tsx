import { saveMyWorkMapping } from "@/app/projects/[id]/settings/actions";
import type { ProjectState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type MyWorkMappingRow = {
  doing_state_id: string | null;
  done_state_id: string | null;
};

// Project Settings "My Work sync" (TASK-133, doc-14): lets the owner map this
// project's own Doing/Done onto My Work's two virtual columns, or leave
// either/both unmapped — an explicit, always-available choice (doc-14), not
// just an empty default. A category-drifted selection (the owner recategorized
// a mapped state after configuring it) is called out here read-side, matching
// how classification itself treats a category mismatch as unmapped (never a
// client-side-only check) — see my-work/page.tsx's mappedProjectIds.
export function MyWorkMappingSettings({
  projectId,
  states,
  mapping,
}: {
  projectId: string;
  states: ProjectState[];
  mapping: MyWorkMappingRow | null;
}) {
  const doingOptions = states.filter((s) => s.category === "in_progress");
  const doneOptions = states.filter((s) => s.category === "done");

  const doingDrifted =
    !!mapping?.doing_state_id && !doingOptions.some((s) => s.id === mapping.doing_state_id);
  const doneDrifted = !!mapping?.done_state_id && !doneOptions.some((s) => s.id === mapping.done_state_id);
  // A drifted state isn't in its expected-category option list (it's the
  // whole reason it's drifted) — include it anyway so the select actually
  // shows what's currently configured instead of silently falling back to
  // "Not mapped" for a defaultValue that matches no rendered <option>.
  const driftedDoingState = doingDrifted ? states.find((s) => s.id === mapping!.doing_state_id) : undefined;
  const driftedDoneState = doneDrifted ? states.find((s) => s.id === mapping!.done_state_id) : undefined;

  return (
    <form action={saveMyWorkMapping} className="flex flex-col gap-4">
      <input type="hidden" name="project_id" value={projectId} />
      <p className="text-sm text-muted-foreground">
        Optionally sync My Work&apos;s Doing/Done columns to this project&apos;s own board states. Dragging a
        card to Doing/Done in My Work then also moves it here; left unmapped, My Work tracks its own status
        without touching this project.
      </p>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="my-work-doing-state">Doing</Label>
          <NativeSelect id="my-work-doing-state" name="doing_state_id" defaultValue={mapping?.doing_state_id ?? ""}>
            <option value="">Not mapped</option>
            {driftedDoingState && (
              <option value={driftedDoingState.id}>{driftedDoingState.name} (no longer Doing-category)</option>
            )}
            {doingOptions.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </NativeSelect>
          {doingDrifted && (
            <p className="text-xs text-destructive">
              The previously mapped state no longer has the Doing category — re-saving it as-is won&apos;t fix
              the sync; pick a different state (or Not mapped) and save.
            </p>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="my-work-done-state">Done</Label>
          <NativeSelect id="my-work-done-state" name="done_state_id" defaultValue={mapping?.done_state_id ?? ""}>
            <option value="">Not mapped</option>
            {driftedDoneState && (
              <option value={driftedDoneState.id}>{driftedDoneState.name} (no longer Done-category)</option>
            )}
            {doneOptions.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </NativeSelect>
          {doneDrifted && (
            <p className="text-xs text-destructive">
              The previously mapped state no longer has the Done category — re-saving it as-is won&apos;t fix
              the sync; pick a different state (or Not mapped) and save.
            </p>
          )}
        </div>
      </div>

      <div>
        <Button type="submit" variant="outline" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}
