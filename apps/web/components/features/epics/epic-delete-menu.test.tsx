import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EpicDeleteMenu } from "./epic-delete-menu";

// TASK-72: epic delete moved behind a confirm dialog + overflow menu
// (spec/ux-principles.md principle 6) — a fable-advisor blocker.
const deleteEpicMock = vi.fn();
vi.mock("@/app/projects/[id]/epics/actions", () => ({
  deleteEpic: (...args: unknown[]) => deleteEpicMock(...args),
}));

async function openDeleteDialog() {
  render(<EpicDeleteMenu epicId="e1" epicName="Big migration" projectId="p1" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Big migration actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Delete epic" }));
  return user;
}

describe("EpicDeleteMenu", () => {
  beforeEach(() => {
    deleteEpicMock.mockReset();
    deleteEpicMock.mockResolvedValue({ ok: true });
  });

  it("does not delete immediately — Delete is behind the overflow menu and a confirm dialog", () => {
    render(<EpicDeleteMenu epicId="e1" epicName="Big migration" projectId="p1" />);

    expect(screen.queryByRole("button", { name: "Delete epic" })).not.toBeInTheDocument();
    expect(deleteEpicMock).not.toHaveBeenCalled();
  });

  it("names the epic and warns stories are unlinked, not deleted", async () => {
    await openDeleteDialog();

    expect(screen.getByText(/Big migration.{0,3} will be permanently deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/stories are kept but unlinked/i)).toBeInTheDocument();
    expect(deleteEpicMock).not.toHaveBeenCalled();
  });

  it("cancels without deleting", async () => {
    const user = await openDeleteDialog();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteEpicMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("confirms and deletes", async () => {
    const user = await openDeleteDialog();
    await user.click(screen.getByRole("button", { name: "Delete epic" }));

    expect(deleteEpicMock).toHaveBeenCalledWith("e1", "p1");
  });

  it("shows the failure in-dialog instead of throwing to the route error boundary", async () => {
    deleteEpicMock.mockResolvedValueOnce({ ok: false, message: "No matching row found" });
    const user = await openDeleteDialog();
    await user.click(screen.getByRole("button", { name: "Delete epic" }));

    expect(await screen.findByText("No matching row found")).toBeInTheDocument();
    // Dialog stays open on failure so the message is visible, not torn down.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
