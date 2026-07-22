import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddColumnTile, ColumnNameField, DeleteColumnButton } from "./my-work-column-manager";
import type { ActionResult } from "@/lib/types";
import type { MyWorkFreeColumn } from "@/lib/utils/my-work";

const createMyWorkColumn = vi.fn<(name: string) => Promise<ActionResult>>(async () => ({ ok: true }));
const deleteMyWorkColumn = vi.fn<(id: string) => Promise<ActionResult>>(async () => ({ ok: true }));

// ColumnNameField no longer calls an action directly (it takes onRename from
// its caller — see the test below), so only create/delete need mocking here.
vi.mock("@/app/my-work/actions", () => ({
  createMyWorkColumn: (name: string) => createMyWorkColumn(name),
  deleteMyWorkColumn: (id: string) => deleteMyWorkColumn(id),
}));

const DOING: MyWorkFreeColumn = { id: "doing", name: "Doing", position: 0 };

beforeEach(() => {
  createMyWorkColumn.mockClear();
  deleteMyWorkColumn.mockClear();
  createMyWorkColumn.mockResolvedValue({ ok: true });
  deleteMyWorkColumn.mockResolvedValue({ ok: true });
});

describe("ColumnNameField", () => {
  it("commits a rename through the caller-supplied onRename", async () => {
    const onRename = vi.fn<(name: string) => Promise<void>>(async () => {});
    render(<ColumnNameField name={DOING.name} onRename={onRename} />);
    fireEvent.click(screen.getByLabelText("Edit name: Doing"));
    const input = screen.getByDisplayValue("Doing");
    fireEvent.change(input, { target: { value: "In progress" } });
    fireEvent.blur(input);
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("In progress"));
  });
});

describe("DeleteColumnButton", () => {
  it("asks for confirmation before deleting, stating where cards go", () => {
    render(<DeleteColumnButton columnId="doing" name="Doing" />);
    fireEvent.click(screen.getByLabelText("Delete column Doing"));
    expect(screen.getByText('Delete column "Doing"?')).toBeInTheDocument();
    expect(screen.getByText(/Its cards move to Todo/)).toBeInTheDocument();
    expect(deleteMyWorkColumn).not.toHaveBeenCalled();
  });

  it("does not delete when the confirmation is cancelled", () => {
    render(<DeleteColumnButton columnId="doing" name="Doing" />);
    fireEvent.click(screen.getByLabelText("Delete column Doing"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteMyWorkColumn).not.toHaveBeenCalled();
  });

  it("deletes only after the confirmation is accepted", async () => {
    render(<DeleteColumnButton columnId="doing" name="Doing" />);
    fireEvent.click(screen.getByLabelText("Delete column Doing"));
    fireEvent.click(screen.getByRole("button", { name: "Delete column" }));
    await waitFor(() => expect(deleteMyWorkColumn).toHaveBeenCalledWith("doing"));
  });
});

describe("AddColumnTile", () => {
  it("starts collapsed as a '+ Add column' tile", () => {
    render(<AddColumnTile />);
    expect(screen.getByText("+ Add column")).toBeInTheDocument();
    expect(screen.queryByLabelText("New column")).not.toBeInTheDocument();
  });

  it("adding a column calls createMyWorkColumn with the trimmed name", async () => {
    render(<AddColumnTile />);
    fireEvent.click(screen.getByText("+ Add column"));
    fireEvent.change(screen.getByLabelText("New column"), { target: { value: "  Waiting  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(createMyWorkColumn).toHaveBeenCalledWith("Waiting"));
  });

  it("collapses back to the tile on cancel", () => {
    render(<AddColumnTile />);
    fireEvent.click(screen.getByText("+ Add column"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("+ Add column")).toBeInTheDocument();
  });
});
