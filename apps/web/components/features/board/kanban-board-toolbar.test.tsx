import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    velocity: 0,
    nextVirtualIterationNumber: 1,
    iterationLength: 14,
    iterationGoals: {},
    canFinishIteration: false,
    canManageStates: false,
    filter: {},
    pointScale: [0, 1, 2, 3, 5, 8, 13],
  };
}

describe("KanbanBoard toolbar — Icebox toggle layout stability", () => {
  it("shows the iteration end date once and keeps committed points beside velocity", () => {
    render(
      <KanbanBoard
        {...baseProps()}
        velocity={8}
        currentIteration={{
          id: "i3",
          number: 3,
          goal: null,
          start_date: "2026-07-14",
          end_date: "2026-07-27",
          velocity: null,
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
});
