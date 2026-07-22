import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EpicFormDialog } from "./epic-form-dialog";

// TASK-122 (doc-13 finding #14): the dialog used to close synchronously on
// submit regardless of whether the server action succeeded.
const createEpicMock = vi.fn();
const updateEpicMock = vi.fn();
vi.mock("@/app/projects/[id]/epics/actions", () => ({
  createEpic: (...args: unknown[]) => createEpicMock(...args),
  updateEpic: (...args: unknown[]) => updateEpicMock(...args),
}));

function openDialog() {
  render(<EpicFormDialog projectId="p1" trigger={<button>New epic</button>} />);
  const user = userEvent.setup();
  return { user };
}

describe("EpicFormDialog", () => {
  beforeEach(() => {
    createEpicMock.mockReset();
    updateEpicMock.mockReset();
    createEpicMock.mockResolvedValue({ ok: true });
    updateEpicMock.mockResolvedValue({ ok: true });
  });

  it("closes only after the server action resolves successfully", async () => {
    const { user } = openDialog();
    await user.click(screen.getByRole("button", { name: "New epic" }));
    await user.type(screen.getByLabelText("Name"), "Big migration");

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(createEpicMock).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows an inline error and keeps the dialog open when submitting a whitespace-only name", async () => {
    createEpicMock.mockResolvedValueOnce({ ok: false, message: "Name is required" });
    const { user } = openDialog();
    await user.click(screen.getByRole("button", { name: "New epic" }));
    await user.type(screen.getByLabelText("Name"), "   ");

    await user.click(screen.getByRole("button", { name: "Create" }));

    // role="alert" (not just a plain <p>) so a screen reader announces it too
    // — matches epic-delete-menu.tsx's sibling error pattern.
    expect(await screen.findByRole("alert")).toHaveTextContent("Name is required");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows an inline error and keeps the dialog open when the server write fails", async () => {
    createEpicMock.mockResolvedValueOnce({ ok: false, message: "No matching row found" });
    const { user } = openDialog();
    await user.click(screen.getByRole("button", { name: "New epic" }));
    await user.type(screen.getByLabelText("Name"), "Big migration");

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("No matching row found")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clears a previous error once a later submit succeeds", async () => {
    createEpicMock.mockResolvedValueOnce({ ok: false, message: "Name is required" });
    createEpicMock.mockResolvedValueOnce({ ok: true });
    const { user } = openDialog();
    await user.click(screen.getByRole("button", { name: "New epic" }));
    await user.type(screen.getByLabelText("Name"), "   ");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Name is required");

    await user.type(screen.getByLabelText("Name"), "Big migration");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("uses updateEpic and includes the epic id when editing an existing epic", async () => {
    render(
      <EpicFormDialog
        projectId="p1"
        epic={{ id: "e1", name: "Big migration", description: null, color: "#6366f1" }}
        trigger={<button>Edit</button>}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateEpicMock).toHaveBeenCalled();
    expect(createEpicMock).not.toHaveBeenCalled();
    const submittedFormData = updateEpicMock.mock.calls[0][0] as FormData;
    expect(submittedFormData.get("epic_id")).toBe("e1");
  });
});
