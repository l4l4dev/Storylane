import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyWorkColumnManager } from "./my-work-column-manager";
import type { ActionResult } from "@/lib/types";
import type { MyWorkFreeColumn } from "@/lib/utils/my-work";

const createMyWorkColumn = vi.fn<(name: string) => Promise<ActionResult>>(async () => ({ ok: true }));
const renameMyWorkColumn = vi.fn<(id: string, name: string) => Promise<ActionResult>>(async () => ({ ok: true }));
const deleteMyWorkColumn = vi.fn<(id: string) => Promise<ActionResult>>(async () => ({ ok: true }));
const saveMyWorkColumnOrder = vi.fn<(order: string[]) => Promise<ActionResult>>(async () => ({ ok: true }));

vi.mock("@/app/my-work/actions", () => ({
  createMyWorkColumn: (name: string) => createMyWorkColumn(name),
  renameMyWorkColumn: (id: string, name: string) => renameMyWorkColumn(id, name),
  deleteMyWorkColumn: (id: string) => deleteMyWorkColumn(id),
  saveMyWorkColumnOrder: (order: string[]) => saveMyWorkColumnOrder(order),
}));

const DOING: MyWorkFreeColumn = { id: "doing", name: "Doing", position: 0 };
const WAITING: MyWorkFreeColumn = { id: "waiting", name: "Waiting", position: 1 };

function open() {
  fireEvent.click(screen.getByText("Manage columns"));
}

beforeEach(() => {
  createMyWorkColumn.mockClear();
  renameMyWorkColumn.mockClear();
  deleteMyWorkColumn.mockClear();
  saveMyWorkColumnOrder.mockClear();
  createMyWorkColumn.mockResolvedValue({ ok: true });
  renameMyWorkColumn.mockResolvedValue({ ok: true });
  deleteMyWorkColumn.mockResolvedValue({ ok: true });
  saveMyWorkColumnOrder.mockResolvedValue({ ok: true });
});

describe("MyWorkColumnManager", () => {
  it("stays collapsed until 'Manage columns' is clicked", () => {
    render(<MyWorkColumnManager order={["todo", "today", "doing", "done"]} freeColumns={[DOING]} />);
    expect(screen.queryByLabelText("Move Todo up")).not.toBeInTheDocument();
    open();
    expect(screen.getByLabelText("Move Todo up")).toBeInTheDocument();
  });

  it("lists every slot in order, labelling fixed slots and free columns by name", () => {
    render(<MyWorkColumnManager order={["today", "doing", "todo", "done"]} freeColumns={[DOING]} />);
    open();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Today");
    expect(items[1]).toContain("Doing");
    expect(items[2]).toContain("Todo");
    expect(items[3]).toContain("Done");
  });

  it("disables the up arrow on the first slot and the down arrow on the last", () => {
    render(<MyWorkColumnManager order={["todo", "today", "done"]} freeColumns={[]} />);
    open();
    expect(screen.getByLabelText("Move Todo up")).toBeDisabled();
    expect(screen.getByLabelText("Move Done down")).toBeDisabled();
    expect(screen.getByLabelText("Move Todo down")).not.toBeDisabled();
  });

  it("moving a slot down swaps it with its neighbour and persists the whole order", async () => {
    render(<MyWorkColumnManager order={["todo", "today", "doing", "done"]} freeColumns={[DOING]} />);
    open();
    fireEvent.click(screen.getByLabelText("Move Today down"));
    await waitFor(() => expect(saveMyWorkColumnOrder).toHaveBeenCalledWith(["todo", "doing", "today", "done"]));
  });

  // fable-advisor (TASK-141): move() computes the next array from the `order`
  // prop, which stays stale until the in-flight save's revalidate lands — if
  // only the clicked row's arrows disabled, a second click on a DIFFERENT row
  // during that window would compute from the same stale array and silently
  // clobber the first move. Every row's arrows must disable while ANY reorder
  // is saving.
  it("disables every row's arrows while a reorder save is in flight, not just the clicked row's", async () => {
    let resolveSave: (v: { ok: true }) => void;
    saveMyWorkColumnOrder.mockReturnValue(new Promise((resolve) => (resolveSave = resolve)));
    render(<MyWorkColumnManager order={["todo", "today", "doing", "done"]} freeColumns={[DOING]} />);
    open();

    fireEvent.click(screen.getByLabelText("Move Today down"));
    expect(screen.getByLabelText("Move Doing down")).toBeDisabled();
    expect(screen.getByLabelText("Move Todo down")).toBeDisabled();

    resolveSave!({ ok: true });
    await waitFor(() => expect(screen.getByLabelText("Move Doing down")).not.toBeDisabled());
  });

  it("moving the first slot up is a no-op (no server call)", () => {
    render(<MyWorkColumnManager order={["todo", "today", "done"]} freeColumns={[]} />);
    open();
    fireEvent.click(screen.getByLabelText("Move Todo up"));
    expect(saveMyWorkColumnOrder).not.toHaveBeenCalled();
  });

  it("adding a column calls createMyWorkColumn with the trimmed name", async () => {
    render(<MyWorkColumnManager order={["todo", "today", "done"]} freeColumns={[]} />);
    open();
    fireEvent.change(screen.getByLabelText("New column"), { target: { value: "  Waiting  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(createMyWorkColumn).toHaveBeenCalledWith("Waiting"));
  });

  it("renaming a free column calls renameMyWorkColumn", async () => {
    render(<MyWorkColumnManager order={["todo", "today", "doing", "done"]} freeColumns={[DOING]} />);
    open();
    fireEvent.click(screen.getByLabelText("Edit name: Doing"));
    const input = screen.getByDisplayValue("Doing");
    fireEvent.change(input, { target: { value: "In progress" } });
    fireEvent.blur(input);
    await waitFor(() => expect(renameMyWorkColumn).toHaveBeenCalledWith("doing", "In progress"));
  });

  it("a fixed slot (Todo/Today/Done) has no rename or delete affordance", () => {
    render(<MyWorkColumnManager order={["todo", "today", "done"]} freeColumns={[]} />);
    open();
    expect(screen.queryByLabelText("Edit name: Todo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete column Todo")).not.toBeInTheDocument();
  });

  it("deleting a free column calls deleteMyWorkColumn", async () => {
    render(<MyWorkColumnManager order={["todo", "today", "doing", "waiting", "done"]} freeColumns={[DOING, WAITING]} />);
    open();
    fireEvent.click(screen.getByLabelText("Delete column Waiting"));
    await waitFor(() => expect(deleteMyWorkColumn).toHaveBeenCalledWith("waiting"));
  });

  it("surfaces a reorder failure inline", async () => {
    saveMyWorkColumnOrder.mockResolvedValue({ ok: false, message: "boom" });
    render(<MyWorkColumnManager order={["todo", "today", "done"]} freeColumns={[]} />);
    open();
    fireEvent.click(screen.getByLabelText("Move Today down"));
    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
  });
});
