import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanBoard } from "./kanban-board";
import type { ProjectState } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/realtime", () => ({
  useProjectBoardRealtime: () => {},
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  finishIteration: vi.fn(),
  updateIterationGoal: vi.fn(),
  dropStoryInList: vi.fn(),
  createBacklogDivider: vi.fn(),
  deleteBacklogDivider: vi.fn(),
  quickCreateStory: vi.fn(),
  estimateStory: vi.fn(),
  setStoryState: vi.fn(),
}));

// Ids match initialContainers' keys below — this test never resolves a real
// state_id, it just needs the state list shaped consistently with the
// containers it seeds.
const CLASSIC_STATES: ProjectState[] = [
  { id: "unstarted", name: "Unstarted", category: "unstarted", action_label: "Start", position: 0, project_id: "p1", created_at: "" },
  { id: "started", name: "Started", category: "in_progress", action_label: "Finish", position: 1, project_id: "p1", created_at: "" },
  { id: "finished", name: "Finished", category: "in_progress", action_label: "Deliver", position: 2, project_id: "p1", created_at: "" },
  { id: "delivered", name: "Delivered", category: "in_progress", action_label: "Accept", position: 3, project_id: "p1", created_at: "" },
  { id: "accepted", name: "Accepted", category: "done", action_label: null, position: 4, project_id: "p1", created_at: "" },
  { id: "rejected", name: "Rejected", category: "rejected", action_label: null, position: 5, project_id: "p1", created_at: "" },
];

function baseProps() {
  return {
    projectId: "p1",
    currentIteration: null,
    states: CLASSIC_STATES,
    initialContainers: {
      backlog: [],
      icebox: [],
      unstarted: [],
      started: [],
      finished: [],
      delivered: [],
      accepted: [],
      rejected: [],
    },
    initialBacklogItems: [],
    currentBudget: 1,
    backlogBudgets: [],
    nextVirtualIterationNumber: 1,
    iterationLength: 14,
    iterationGoals: {},
    canFinishIteration: false,
    canManageStates: false,
    filter: {},
    pointScale: [0, 1, 2, 3, 5, 8, 13],
  };
}

const localStorageValues = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    clear: vi.fn(() => localStorageValues.clear()),
    getItem: vi.fn((key: string) => localStorageValues.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => localStorageValues.set(key, value)),
    removeItem: vi.fn((key: string) => localStorageValues.delete(key)),
  },
});

describe("KanbanBoard toolbar — Icebox toggle layout stability", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the iteration end date once and keeps committed points beside velocity", () => {
    render(
      <KanbanBoard
        {...baseProps()}
        currentBudget={8}
        currentIteration={{
          id: "i3",
          number: 3,
          goal: null,
          start_date: "2026-07-14",
          end_date: "2026-07-27",
          velocity: null,
          capacity: null,
          state: "current",
          skipped: false,
        }}
      />,
    );

    expect(screen.getByText("0 / 8 pts committed")).toBeInTheDocument();
    expect(screen.getByText("2026/7/14 – 2026/7/27 (auto-finishes)")).toBeInTheDocument();
    expect(screen.getAllByText(/2026\/7\/27/)).toHaveLength(1);
  });

  it("keeps the Icebox button mounted (not removed) across all three views", () => {
    render(<KanbanBoard {...baseProps()} />);
    // Queried by test id, not role+name — once aria-hidden is set, the
    // accessible-name algorithm returns "" for the element itself (that's
    // correct AT behavior), so a role+name query can't find it anymore even
    // with `hidden: true`. The test id sidesteps that to keep asserting the
    // one thing that matters here: the element stays mounted.
    const iceboxButton = () => screen.getByTestId("icebox-toggle");

    expect(iceboxButton()).toBeInTheDocument();
    expect(iceboxButton()).not.toHaveAttribute("aria-hidden");

    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(iceboxButton()).toBeInTheDocument();
    expect(iceboxButton()).toHaveAttribute("aria-hidden", "true");
    expect(iceboxButton().className).toMatch(/\binvisible\b/);

    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(iceboxButton()).toBeInTheDocument();
    expect(iceboxButton()).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(iceboxButton()).toBeInTheDocument();
    expect(iceboxButton()).not.toHaveAttribute("aria-hidden");
    expect(iceboxButton().className).not.toMatch(/\binvisible\b/);
  });

  it("keeps the Icebox toggle out of the tab order while hidden outside List", () => {
    render(<KanbanBoard {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.getByTestId("icebox-toggle")).toHaveAttribute("tabIndex", "-1");
  });

  it("persists List/Kanban selection per project", () => {
    render(<KanbanBoard {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));

    expect(window.localStorage.getItem("storylane:board-view:p1")).toBe("kanban");
    expect(screen.getByRole("button", { name: "Kanban" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "false");
  });

  it("restores a saved Kanban view after mount", async () => {
    window.localStorage.setItem("storylane:board-view:p1", "kanban");
    render(<KanbanBoard {...baseProps()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Kanban" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("ignores a legacy Focus value when restoring the saved view", async () => {
    window.localStorage.setItem("storylane:board-view:p1", "focus");
    render(<KanbanBoard {...baseProps()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("keeps the selection in memory when localStorage writes fail", () => {
    vi.mocked(window.localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    render(<KanbanBoard {...baseProps()} projectId="p-quota" />);

    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));

    expect(screen.getByRole("button", { name: "Kanban" })).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem("storylane:board-view:p-quota")).toBeNull();
  });

  it("explains filtered totals and distinguishes an empty match from an empty project", () => {
    const story = {
      id: "s1",
      number: 1,
      title: "Feature story",
      description: null,
      story_type: "feature",
      isDone: false,
      points: 3,
      assigneeName: null,
      labels: [],
      epic: null,
      state_id: "unstarted",
      iteration_id: null,
      position: 1,
      assignee_id: null,
      labelIds: [],
      epic_id: null,
      focus: null,
      completed_at: null,
    };
    render(
      <KanbanBoard
        {...baseProps()}
        initialContainers={{ ...baseProps().initialContainers, backlog: [story] }}
        initialBacklogItems={[{ kind: "story", story }]}
        filter={{ type: "bug" }}
      />,
    );

    expect(screen.getByText("Point totals include hidden stories")).toBeInTheDocument();
    expect(screen.getByText("No stories match the current filters.")).toBeInTheDocument();
    expect(screen.queryByText(/No stories yet/)).not.toBeInTheDocument();
  });

  it("shows the filtered-empty status for the active view even when another zone has a match", () => {
    const currentStory = {
      id: "s-current",
      number: 1,
      title: "Current feature",
      description: null,
      story_type: "feature",
      isDone: false,
      points: 3,
      assigneeName: null,
      labels: [],
      epic: null,
      state_id: "unstarted",
      iteration_id: "i1",
      position: 1,
      assignee_id: null,
      labelIds: [],
      epic_id: null,
      focus: null,
      completed_at: null,
    };
    const backlogStory = {
      ...currentStory,
      id: "s-backlog",
      number: 2,
      title: "Backlog bug",
      story_type: "bug",
      state_id: "unstarted",
      iteration_id: null,
    };
    render(
      <KanbanBoard
        {...baseProps()}
        initialContainers={{
          ...baseProps().initialContainers,
          unstarted: [currentStory],
          backlog: [backlogStory],
        }}
        initialBacklogItems={[{ kind: "story", story: backlogStory }]}
        filter={{ type: "bug" }}
      />,
    );

    expect(screen.queryByText("No stories match the current filters.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.getByText("No stories match the current filters.")).toHaveAttribute("role", "status");
  });
});
