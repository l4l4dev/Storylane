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

  // Every column stays visible (with a "0" count) even when empty — unlike
  // the old stacked-lists layout, a column must always render as a drop
  // target or a card could never be dragged INTO an empty Doing/Done/Today
  // (TASK-132 AC #1).
  it("keeps every column visible, including empty ones, so each stays a valid drop target", () => {
    render(<MyWorkSections columns={{ ...EMPTY, doing: [active("only-one")] }} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Todo", "Today", "Doing", "Done"]);
  });

  it("groups Todo into per-project header blocks", () => {
    render(
      <MyWorkSections
        columns={{
          ...EMPTY,
          todo: [
            { projectId: "team-a", projectName: "Alpha", isPersonal: false, stories: [active("a1")] },
            {
              projectId: "team-b",
              projectName: "Bravo",
              isPersonal: false,
              stories: [
                {
                  ...active("b1"),
                  projectId: "team-b",
                  row: row("b1", { projectId: "team-b", projectName: "Bravo" }),
                },
              ],
            },
          ],
        }}
      />,
    );
    const todo = screen.getByRole("heading", { level: 2, name: "Todo" }).closest("section")!;
    const projectHeadings = within(todo).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(projectHeadings).toEqual(["Alpha", "Bravo"]);
  });

  // fable-advisor (TASK-132, ux-principles.md principle 9): Done is additive
  // (TASK-131 AC #12b) — a reopened, currently in_progress story can render
  // as a card in BOTH Doing and Done at once. Only the Done instance gets a
  // completion marker, so the two are distinguishable card-by-card, not just
  // by which column they're in.
  it("marks only the Done instance of a story that appears in both Doing and Done", () => {
    render(
      <MyWorkSections
        columns={{
          ...EMPTY,
          doing: [active("s1")],
          done: [doneEntry("s1", new Date().toISOString())],
        }}
      />,
    );
    const markers = screen.getAllByLabelText("Completion log entry");
    expect(markers).toHaveLength(1);
  });
});
