import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyWorkColumnManager } from "./my-work-column-manager";
import type { ActionResult } from "@/lib/types";
import type { MyWorkFreeColumn } from "@/lib/utils/my-work";

const createMyWorkColumn = vi.fn<(name: string) => Promise<ActionResult>>(async () => ({ ok: true }));
const renameMyWorkColumn = vi.fn<(id: string, name: string) => Promise<ActionResult>>(async () => ({ ok: true }));
const deleteMyWorkColumn = vi.fn<(id: string) => Promise<ActionResult>>(async () => ({ ok: true }));

vi.mock("@/app/my-work/actions", () => ({
  createMyWorkColumn: (name: string) => createMyWorkColumn(name),
  renameMyWorkColumn: (id: string, name: string) => renameMyWorkColumn(id, name),
  deleteMyWorkColumn: (id: string) => deleteMyWorkColumn(id),
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
  createMyWorkColumn.mockResolvedValue({ ok: true });
  renameMyWorkColumn.mockResolvedValue({ ok: true });
  deleteMyWorkColumn.mockResolvedValue({ ok: true });
});

describe("MyWorkColumnManager", () => {
  it("stays collapsed until 'Manage columns' is clicked", () => {
    render(<MyWorkColumnManager freeColumns={[DOING]} />);
    expect(screen.queryByLabelText("Edit name: Doing")).not.toBeInTheDocument();
    open();
    expect(screen.getByLabelText("Edit name: Doing")).toBeInTheDocument();
  });

  it("lists every free column by name", () => {
    render(<MyWorkColumnManager freeColumns={[DOING, WAITING]} />);
    open();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("Doing");
    expect(items[1]).toContain("Waiting");
  });

  it("adding a column calls createMyWorkColumn with the trimmed name", async () => {
    render(<MyWorkColumnManager freeColumns={[]} />);
    open();
    fireEvent.change(screen.getByLabelText("New column"), { target: { value: "  Waiting  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(createMyWorkColumn).toHaveBeenCalledWith("Waiting"));
  });

  it("renaming a free column calls renameMyWorkColumn", async () => {
    render(<MyWorkColumnManager freeColumns={[DOING]} />);
    open();
    fireEvent.click(screen.getByLabelText("Edit name: Doing"));
    const input = screen.getByDisplayValue("Doing");
    fireEvent.change(input, { target: { value: "In progress" } });
    fireEvent.blur(input);
    await waitFor(() => expect(renameMyWorkColumn).toHaveBeenCalledWith("doing", "In progress"));
  });

  it("deleting a free column calls deleteMyWorkColumn", async () => {
    render(<MyWorkColumnManager freeColumns={[DOING, WAITING]} />);
    open();
    fireEvent.click(screen.getByLabelText("Delete column Waiting"));
    await waitFor(() => expect(deleteMyWorkColumn).toHaveBeenCalledWith("waiting"));
  });
});
