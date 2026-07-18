import { fireEvent, render, screen } from "@testing-library/react";
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

  it("shows Tracker fields (iteration length, point scale, velocity window) by default", () => {
    render(<InlineCreatePanel />);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByLabelText("Iteration length (days)")).toBeInTheDocument();
    expect(screen.getByLabelText("Point scale")).toBeInTheDocument();
    expect(screen.getByLabelText("Velocity window")).toBeInTheDocument();
    expect(screen.queryByText("Column template")).not.toBeInTheDocument();
  });

});
