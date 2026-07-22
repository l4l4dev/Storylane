import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/types";
import { MyWorkSections } from "./my-work-sections";
import type { MyWorkRowData } from "./my-work-row";
import { localTodayKey } from "@/lib/utils/format";
import { resolveColumnOrder, type DoneEntry, type MyWorkFreeColumn, type MyWorkProject, type MyWorkStory } from "@/lib/utils/my-work";

const saveMyWorkColumnOrder = vi.fn<(order: string[]) => Promise<ActionResult>>(async () => ({ ok: true }));
const renameMyWorkFixedColumn = vi.fn<(slot: string, name: string) => Promise<ActionResult>>(async () => ({ ok: true }));

// Only saveMyWorkColumnOrder/renameMyWorkFixedColumn are exercised below (the
// move-button fallback, doc-17 #7, and the fixed-slot rename follow-up);
// every other action is a stub so a component render never hits the real
// Supabase server client. vi.mock's factory is hoisted above every top-level
// const, so the stub must be defined inline here, not referenced.
vi.mock("@/app/my-work/actions", () => {
  const ok = async () => ({ ok: true });
  return {
    carryOverToday: ok,
    createMyWorkColumn: ok,
    deleteMyWorkColumn: ok,
    dismissCarryOver: ok,
    renameMyWorkColumn: ok,
    renameMyWorkFixedColumn: (slot: string, name: string) => renameMyWorkFixedColumn(slot, name),
    reorderMyWorkColumn: ok,
    reorderMyWorkToday: ok,
    saveMyWorkColumnOrder: (order: string[]) => saveMyWorkColumnOrder(order),
    setMyWorkColumn: ok,
  };
});

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
    isPersonal: false,
    stateBadge: { label: "Unstarted", className: "" },
    ...over,
  };
}

function active(id: string, over: Partial<MyWorkStory<MyWorkRowData>> = {}): MyWorkStory<MyWorkRowData> {
  return {
    id,
    projectId: "team-a",
    position: 0,
    todayDate: null,
    todayPosition: null,
    columnId: null,
    columnPosition: null,
    row: row(id),
    ...over,
  };
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
  hasQuickAdd?: boolean;
}) {
  const freeColumns = props.freeColumns ?? [DOING];
  return render(
    <MyWorkSections
      assigned={props.assigned ?? []}
      completions={props.completions ?? []}
      projects={props.projects ?? [TEAM_A]}
      freeColumns={freeColumns}
      order={props.order ?? resolveColumnOrder([], freeColumns)}
      hasQuickAdd={props.hasQuickAdd}
      serverTodayKey={TODAY}
    />,
  );
}

describe("MyWorkSections", () => {
  beforeEach(() => {
    saveMyWorkColumnOrder.mockClear();
    saveMyWorkColumnOrder.mockResolvedValue({ ok: true });
    renameMyWorkFixedColumn.mockClear();
    renameMyWorkFixedColumn.mockResolvedValue({ ok: true });
  });

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

  it("points the empty state at the quick-add when it's present", () => {
    renderSections({ hasQuickAdd: true });
    expect(screen.getByText(/add a personal task above/)).toBeInTheDocument();
  });

  // doc-17 #4: the quick-add only renders for exactly one personal project —
  // for zero/multiple, the empty-state copy must not point at a control
  // that isn't there.
  it("points the empty state at a project board instead when there's no quick-add", () => {
    renderSections({ hasQuickAdd: false });
    expect(screen.getByText(/add one from a personal project's board/)).toBeInTheDocument();
    expect(screen.queryByText(/add a personal task above/)).not.toBeInTheDocument();
  });

  // doc-17 #5: an empty column body used to be a bare strip with no
  // placeholder — even when OTHER columns have cards (isEmpty is false).
  it("shows a placeholder in an empty column even when other columns have cards", () => {
    renderSections({ assigned: [active("t1")] }); // only Todo has a card
    const today = screen.getByRole("heading", { level: 2, name: "Today" }).closest("section")!;
    expect(within(today).getByText("Drag stories here to plan today.")).toBeInTheDocument();
  });

  // fable-advisor review: Done isn't a drop target from My Work, so its
  // empty hint must not invite a drag the way the generic wording would.
  it("gives Done its own empty-hint wording, not the generic drag prompt", () => {
    renderSections({ assigned: [active("t1")] });
    const done = screen.getByRole("heading", { level: 2, name: "Done" }).closest("section")!;
    expect(within(done).getByText("Completed stories appear here.")).toBeInTheDocument();
  });

  // fable-advisor review: when the WHOLE board is empty, the per-column
  // hints would just repeat the single whole-board message N times.
  it("suppresses per-column empty hints when the whole board is empty", () => {
    renderSections({});
    expect(screen.queryByText("Drag stories here.")).not.toBeInTheDocument();
    expect(screen.queryByText("Drag stories here to plan today.")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed stories appear here.")).not.toBeInTheDocument();
    expect(screen.queryByText("Assigned stories appear here.")).not.toBeInTheDocument();
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

  // doc-17 #9: the decline control used to read "Not today", a generic
  // dismiss that never said items just fall back to their own columns.
  it("labels the carry-over decline with its actual outcome, not a generic dismiss", () => {
    renderSections({ assigned: [active("stale", { todayDate: "2020-01-01" })] });
    expect(screen.getByRole("button", { name: "Leave in their columns" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not today" })).not.toBeInTheDocument();
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

  // doc-17 #7: dragging a column's header has no keyboard-arrow-free
  // equivalent for touch, so every column also gets left/right move buttons.
  it("disables the move-left button on the first column and move-right on the last", () => {
    renderSections({});
    expect(screen.getByRole("button", { name: "Move Todo column left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Done column right" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Todo column right" })).not.toBeDisabled();
  });

  it("moving a column right persists the swapped order", async () => {
    renderSections({});
    fireEvent.click(screen.getByRole("button", { name: "Move Todo column right" }));
    await waitFor(() => expect(saveMyWorkColumnOrder).toHaveBeenCalledWith(["today", "todo", "doing", "done"]));
  });

  // doc-17 #6: rename/delete for a free column live in its own header now,
  // not a separate collapsed manage panel.
  it("shows rename and delete controls in a free column's own header", () => {
    renderSections({});
    expect(screen.getByLabelText("Edit name: Doing")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete column Doing")).toBeInTheDocument();
  });

  it("fixed columns (Todo/Today/Done) have no delete control", () => {
    renderSections({});
    expect(screen.queryByLabelText("Delete column Todo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete column Today")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete column Done")).not.toBeInTheDocument();
  });

  it("offers a '+ Add column' tile at the end of the row", () => {
    renderSections({});
    expect(screen.getByText("+ Add column")).toBeInTheDocument();
  });

  // Owner follow-up 2026-07-22: the fixed slots (Todo/Today/Done) can be
  // renamed too, display label only.
  it("lets a fixed slot's name be edited, calling renameMyWorkFixedColumn with its slot id", async () => {
    renderSections({});
    fireEvent.click(screen.getByLabelText("Edit name: Todo"));
    const input = screen.getByDisplayValue("Todo");
    fireEvent.change(input, { target: { value: "Backlog" } });
    fireEvent.blur(input);
    await waitFor(() => expect(renameMyWorkFixedColumn).toHaveBeenCalledWith("todo", "Backlog"));
  });
});
