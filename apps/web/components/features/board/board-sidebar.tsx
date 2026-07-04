// Slim panel-toggle sidebar for the multi-panel board (spec/screens.md
// "Board layout"). Purely presentational — panel visibility state lives in
// the parent `SprintBoard` client component.

import { Button } from "@/components/ui/button";

export type BoardPanelId = "current" | "backlog" | "icebox" | "done" | "epics";

export const BOARD_PANEL_IDS: readonly BoardPanelId[] = [
  "current",
  "backlog",
  "icebox",
  "done",
  "epics",
];

// Default on: Current, Backlog, Icebox (spec/screens.md "Board layout").
export const DEFAULT_BOARD_PANELS: ReadonlySet<BoardPanelId> = new Set(["current", "backlog", "icebox"]);

const PANEL_LABELS: Record<BoardPanelId, string> = {
  current: "Current",
  backlog: "Backlog",
  icebox: "Icebox",
  done: "Done",
  epics: "Epics",
};

export function BoardSidebar({
  enabled,
  onToggle,
}: {
  enabled: ReadonlySet<BoardPanelId>;
  onToggle: (panel: BoardPanelId) => void;
}) {
  return (
    <nav
      aria-label="Toggle board panels"
      className="flex w-28 shrink-0 flex-col gap-1 border-r border-border pr-2"
    >
      {BOARD_PANEL_IDS.map((panel) => {
        const isEnabled = enabled.has(panel);
        return (
          <Button
            key={panel}
            variant={isEnabled ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={isEnabled}
            onClick={() => onToggle(panel)}
            className={`w-full justify-start ${isEnabled ? "" : "text-muted-foreground"}`}
          >
            {PANEL_LABELS[panel]}
          </Button>
        );
      })}
    </nav>
  );
}
