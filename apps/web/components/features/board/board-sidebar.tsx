// Slim panel-toggle sidebar for the multi-panel board (spec/screens.md
// "Board layout"). Purely presentational — panel visibility state lives in
// the parent `SprintBoard` client component.

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
      className="flex w-28 shrink-0 flex-col gap-1 border-r border-gray-200 pr-2 dark:border-gray-800"
    >
      {BOARD_PANEL_IDS.map((panel) => {
        const isEnabled = enabled.has(panel);
        return (
          <button
            key={panel}
            type="button"
            aria-pressed={isEnabled}
            onClick={() => onToggle(panel)}
            className={`rounded-md px-2 py-1.5 text-left text-sm font-medium ${
              isEnabled
                ? "bg-indigo-600 text-white"
                : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-zinc-800"
            }`}
          >
            {PANEL_LABELS[panel]}
          </button>
        );
      })}
    </nav>
  );
}
