import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyWorkSections, type MyWorkActiveItem, type MyWorkDoneItem } from "./my-work-sections";
import type { MyWorkProject } from "@/lib/utils/my-work";

vi.mock("@/app/stories/[id]/actions", () => ({ togglePin: vi.fn(() => Promise.resolve({ ok: true })) }));

const TEAM: MyWorkProject = { id: "team-a", name: "Alpha", isPersonal: false };

function activeItem(id: string, over: Partial<MyWorkActiveItem> = {}): MyWorkActiveItem {
  return {
    id,
    projectId: "team-a",
    iterationId: null,
    position: 0,
    category: "unstarted",
    row: {
      id,
      number: 1,
      title: `Story ${id}`,
      storyType: "feature",
      points: null,
      projectId: "team-a",
      projectName: "Alpha",
      stateBadge: { label: "Unstarted", className: "" },
      pinned: false,
    },
    ...over,
  };
}

function doneItem(id: string, completedAt: string): MyWorkDoneItem {
  return {
    completedAt,
    row: {
      id,
      number: 2,
      title: `Done ${id}`,
      storyType: "feature",
      points: null,
      projectId: "team-a",
      projectName: "Alpha",
      stateBadge: { label: "Accepted", className: "" },
      pinned: false,
    },
  };
}

describe("MyWorkSections", () => {
  it("renders Todo, Today, Doing, then Done (backlog -> planned -> live -> done last)", () => {
    render(
      <MyWorkSections
        activeItems={[
          activeItem("todo1"),
          activeItem("doing1", { category: "in_progress", row: { ...activeItem("doing1").row, title: "Story doing1" } }),
          activeItem("today1", { row: { ...activeItem("today1").row, pinned: true }, id: "today1" }),
        ]}
        doneItems={[doneItem("done1", new Date().toISOString())]}
        projects={[TEAM]}
        currentIterationByProject={[["team-a", null]]}
        pinnedStoryIds={["today1"]}
        // (pinned drives Today)
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Todo", "Today", "Doing", "Done"]);
  });

  it("labels the Done group for today as 'Today'", () => {
    render(
      <MyWorkSections
        activeItems={[]}
        doneItems={[doneItem("done1", new Date().toISOString())]}
        projects={[TEAM]}
        currentIterationByProject={[]}
        pinnedStoryIds={[]}
      />,
    );
    const done = screen.getByRole("heading", { level: 2, name: "Done" }).closest("section")!;
    expect(within(done).getByRole("heading", { level: 3 })).toHaveTextContent("Today");
  });

  it("the 'only current iteration' toggle hides out-of-iteration Todo stories", () => {
    render(
      <MyWorkSections
        activeItems={[
          activeItem("in-iter", { iterationId: "iter-a" }),
          activeItem("backlog", { iterationId: null }),
        ]}
        doneItems={[]}
        projects={[TEAM]}
        currentIterationByProject={[["team-a", "iter-a"]]}
        pinnedStoryIds={[]}
      />,
    );
    expect(screen.getByText("Story backlog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /only current iteration/i }));
    expect(screen.queryByText("Story backlog")).not.toBeInTheDocument();
    expect(screen.getByText("Story in-iter")).toBeInTheDocument();
  });

  it("keeps the toggle visible even when checking it empties Todo and Doing", () => {
    render(
      <MyWorkSections
        activeItems={[activeItem("backlog", { iterationId: null })]}
        doneItems={[]}
        projects={[TEAM]}
        currentIterationByProject={[["team-a", "iter-a"]]}
        pinnedStoryIds={[]}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /only current iteration/i }));
    expect(screen.queryByText("Story backlog")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /only current iteration/i })).toBeInTheDocument();
  });

  it("shows the empty state when there is nothing at all", () => {
    render(
      <MyWorkSections
        activeItems={[]}
        doneItems={[]}
        projects={[TEAM]}
        currentIterationByProject={[]}
        pinnedStoryIds={[]}
      />,
    );
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });
});
