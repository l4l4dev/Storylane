import Link from "next/link";
import { EpicProgressBar } from "@/components/features/epics/epic-progress-bar";
import type { EpicProgress } from "@/lib/utils/epics";

export type EpicPanelData = {
  id: string;
  name: string;
  color: string;
  progress: EpicProgress;
};

// Read-only summary for the board's Epics panel (spec/screens.md "Board
// layout"). Full epic CRUD stays on /projects/[id]/epics.
export function EpicPanel({ projectId, epics }: { projectId: string; epics: EpicPanelData[] }) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`/projects/${projectId}/epics`}
        className="self-end text-xs text-primary hover:underline"
      >
        Manage epics
      </Link>
      {epics.length === 0 ? (
        <p className="text-sm text-muted-foreground">No epics yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {epics.map((epic) => (
            <li key={epic.id} className="rounded-md border border-border p-2">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: epic.color }}
                />
                <span className="truncate text-sm">{epic.name}</span>
              </div>
              <EpicProgressBar progress={epic.progress} color={epic.color} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
