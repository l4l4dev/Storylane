import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanBoard } from "./kanban-board";

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
  transitionStory: vi.fn(),
}));

function baseProps() {
  return {
    projectId: "p1",
    currentIteration: null,
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
    filter: {},
    pointScale: [0, 1, 2, 3, 5, 8, 13],
  };
}

// TASK-35: the Icebox toggle used to unmount entirely outside List view,
// shrinking the toolbar and shifting the view switcher/filters on every
// switch. It's now always mounted; only its visibility changes.
describe("KanbanBoard toolbar — Icebox toggle layout stability", () => {
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
