import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyWorkSections } from "./my-work-sections";
import type { MyWorkRowData } from "./my-work-row";
import type { DoneEntry, MyWorkColumns, MyWorkStory } from "@/lib/utils/my-work";

function row(id: string, over: Partial<MyWorkRowData> = {}): MyWorkRowData {
  return {
    id,
    number: 1,
    title: `Story ${id}`,
    storyType: "feature",
    points: null,
    projectId: "team-a",
    projectName: "Alpha",
    stateBadge: { label: "Unstarted", className: "" },
    ...over,
  };
}

function active(id: string): MyWorkStory<MyWorkRowData> {
  return {
    id,
    projectId: "team-a",
    position: 0,
    category: "unstarted",
    isToday: false,
    localStatus: null,
    mapped: false,
    localUpdatedAt: null,
    row: row(id, { title: `Story ${id}` }),
  };
}

function doneEntry(id: string, completedAt: string): DoneEntry<MyWorkRowData> {
  return { completedAt, row: row(id, { title: `Done ${id}` }) };
}

const EMPTY: MyWorkColumns<MyWorkRowData> = { todo: [], today: [], doing: [], done: [] };

describe("MyWorkSections", () => {
  it("renders Todo, Today, Doing, then Done (backlog -> planned -> live -> done last)", () => {
    render(
      <MyWorkSections
        columns={{
          todo: [{ projectId: "team-a", projectName: "Alpha", isPersonal: false, stories: [active("todo1")] }],
          today: [active("today1")],
          doing: [active("doing1")],
          done: [doneEntry("done1", new Date().toISOString())],
        }}
      />,
    );
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Todo", "Today", "Doing", "Done"]);
  });

  it("labels the Done group for today as 'Today'", () => {
    render(<MyWorkSections columns={{ ...EMPTY, done: [doneEntry("done1", new Date().toISOString())] }} />);
    const done = screen.getByRole("heading", { level: 2, name: "Done" }).closest("section")!;
    expect(within(done).getByRole("heading", { level: 3 })).toHaveTextContent("Today");
  });

  it("shows the empty state when there is nothing at all", () => {
    render(<MyWorkSections columns={EMPTY} />);
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });
});
