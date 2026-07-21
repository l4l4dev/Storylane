import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineCreatePanel } from "./inline-create-panel";

const createProjectMock = vi.fn();
vi.mock("@/app/dashboard/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/dashboard/actions")>();
  return { ...actual, createProject: (...args: unknown[]) => createProjectMock(...args) };
});

describe("InlineCreatePanel", () => {
  it("panel is collapsed until 'New project' is clicked, with no dialog/overlay role", () => {
    render(<InlineCreatePanel />);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows Tracker fields (display term, length, point scale, velocity window) by default", () => {
    render(<InlineCreatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByLabelText("What you call an iteration")).toBeInTheDocument();
    expect(screen.getByLabelText("Length")).toBeInTheDocument();
    expect(screen.getByLabelText("Point scale")).toBeInTheDocument();
    expect(screen.getByLabelText("Velocity window")).toBeInTheDocument();
    expect(screen.queryByText("Column template")).not.toBeInTheDocument();
  });

  // TASK-104: My Work's "New project" entry links to /dashboard?new=1 rather
  // than duplicating this form — the dashboard page reads that param into
  // defaultOpen so the panel lands pre-expanded.
  it("renders pre-expanded when defaultOpen is true", () => {
    render(<InlineCreatePanel defaultOpen={true} />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  // TASK-118: a DB error must surface inline instead of propagating as an
  // uncaught exception, and the panel/form state must be preserved so the
  // user can retry rather than losing their input.
  it("shows an inline error and keeps the panel open when creation fails", async () => {
    createProjectMock.mockResolvedValueOnce({ ok: false, message: "duplicate key value" });
    render(<InlineCreatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My Project" } });
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("duplicate key value")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

});
