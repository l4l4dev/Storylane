import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyWorkSections } from "./my-work-sections";
import type { MyWorkRowData } from "./my-work-row";
import { localTodayKey } from "@/lib/utils/format";
import { resolveColumnOrder, type DoneEntry, type MyWorkFreeColumn, type MyWorkProject, type MyWorkStory } from "@/lib/utils/my-work";

const TODAY = localTodayKey();
const TEAM_A: MyWorkProject = { id: "team-a", name: "Alpha", isPersonal: false };
const TEAM_B: MyWorkProject = { id: "team-b", name: "Bravo", isPersonal: false };
const DOING: MyWorkFreeColumn = { id: "doing", name: "Doing", position: 0 };

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

function active(id: string, over: Partial<MyWorkStory<MyWorkRowData>> = {}): MyWorkStory<MyWorkRowData> {
  return { id, projectId: "team-a", position: 0, todayDate: null, todayPosition: null, columnId: null, row: row(id), ...over };
}

function doneEntry(id: string, completedAt: string): DoneEntry<MyWorkRowData> {
  return { completedAt, row: row(id, { title: `Done ${id}` }) };
}

function renderSections(props: {
  assigned?: MyWorkStory<MyWorkRowData>[];
  completions?: DoneEntry<MyWorkRowData>[];
  projects?: MyWorkProject[];
  freeColumns?: MyWorkFreeColumn[];
  order?: string[];
}) {
  const freeColumns = props.freeColumns ?? [DOING];
  return render(
    <MyWorkSections
      assigned={props.assigned ?? []}
      completions={props.completions ?? []}
      projects={props.projects ?? [TEAM_A]}
      freeColumns={freeColumns}
      order={props.order ?? resolveColumnOrder([], freeColumns)}
      serverTodayKey={TODAY}
    />,
  );
}

describe("MyWorkSections", () => {
  it("renders Todo, Today, the free columns, then Done", () => {
    renderSections({
      assigned: [active("todo1"), active("today1", { todayDate: TODAY }), active("doing1", { columnId: "doing" })],
      completions: [doneEntry("done1", `${TODAY}T12:00:00.000Z`)],
    });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Todo", "Today", "Doing", "Done"]);
  });

  it("labels the Done group for today as 'Today'", () => {
    renderSections({ completions: [doneEntry("done1", `${TODAY}T12:00:00.000Z`)] });
    const done = screen.getByRole("heading", { level: 2, name: "Done" }).closest("section")!;
    expect(within(done).getByRole("heading", { level: 3 })).toHaveTextContent("Today");
  });

  it("shows the empty state when there is nothing at all", () => {
    renderSections({});
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument();
  });

  // Every column stays visible (with a "0" count) even when empty, so a card
  // can always be dragged INTO an empty column (TASK-132 AC #1).
  it("keeps every column visible, including empty ones, so each stays a valid drop target", () => {
    renderSections({ assigned: [active("only-one", { columnId: "doing" })] });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Todo", "Today", "Doing", "Done"]);
  });

  it("groups Todo into per-project header blocks", () => {
    renderSections({
      assigned: [
        active("a1"),
        active("b1", { projectId: "team-b", row: row("b1", { projectId: "team-b", projectName: "Bravo" }) }),
      ],
      projects: [TEAM_A, TEAM_B],
    });
    const todo = screen.getByRole("heading", { level: 2, name: "Todo" }).closest("section")!;
    const projectHeadings = within(todo).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(projectHeadings).toEqual(["Alpha", "Bravo"]);
  });

  // Done is additive (ux-principles principle 9): a story sitting in a free
  // column can ALSO have a past completion in Done. Only the Done instance gets
  // the completion marker, so the two are distinguishable card-by-card.
  it("marks only the Done instance of a story that also sits in a free column", () => {
    renderSections({
      assigned: [active("s1", { columnId: "doing" })],
      completions: [doneEntry("s1", `${TODAY}T12:00:00.000Z`)],
    });
    const markers = screen.getAllByLabelText("Completion log entry");
    expect(markers).toHaveLength(1);
  });

  it("prompts to carry over stale Today items", () => {
    renderSections({ assigned: [active("stale", { todayDate: "2020-01-01" })] });
    expect(screen.getByText(/marked Today on an earlier day/)).toBeInTheDocument();
  });

  // TASK-141: the column display order (including the fixed slots) is
  // caller-supplied, not hardcoded.
  it("renders columns in the given custom order", () => {
    renderSections({ order: ["done", "doing", "today", "todo"] });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Done", "Doing", "Today", "Todo"]);
  });

  it("skips an order entry whose free column no longer exists", () => {
    renderSections({ order: ["todo", "today", "stale-column-id", "done"] });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Todo", "Today", "Done"]);
  });

  // TASK-148: every column exposes its own focusable drag-handle button
  // (rather than making the whole header/section draggable) — this is also
  // what keeps keyboard reordering (dnd-kit's KeyboardSensor) working, since
  // dnd-kit attaches its listeners/tabIndex to whichever element gets
  // {...attributes} {...listeners}.
  it("gives each column its own focusable drag handle, separate from the card list", () => {
    renderSections({});
    ["Todo", "Today", "Doing", "Done"].forEach((title) => {
      const handle = screen.getByRole("button", { name: `Reorder ${title} column` });
      expect(handle.tagName).toBe("BUTTON");
    });
  });
});
