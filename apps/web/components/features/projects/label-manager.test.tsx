import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LabelManager } from "./label-manager";

const labels = [
  { id: "l1", name: "urgent", color: "#ef4444" },
  { id: "l2", name: "design", color: "#6366f1" },
];

describe("LabelManager", () => {
  it("renders existing labels", () => {
    render(<LabelManager projectId="p1" labels={labels} canCreate={false} canDelete={false} />);

    expect(screen.getByText("urgent")).toBeInTheDocument();
    expect(screen.getByText("design")).toBeInTheDocument();
  });

  it("shows an empty state when there are no labels", () => {
    render(<LabelManager projectId="p1" labels={[]} canCreate={false} canDelete={false} />);

    expect(screen.getByText("No labels yet.")).toBeInTheDocument();
  });

  it("hides delete buttons and the create form for a viewer", () => {
    render(<LabelManager projectId="p1" labels={labels} canCreate={false} canDelete={false} />);

    expect(screen.queryByLabelText("Delete label urgent")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "New label" })).not.toBeInTheDocument();
  });

  it("shows the create form for a member but not delete buttons", () => {
    render(<LabelManager projectId="p1" labels={labels} canCreate={true} canDelete={false} />);

    expect(screen.getByRole("textbox", { name: "New label" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Delete label urgent")).not.toBeInTheDocument();
  });

  it("shows delete buttons for an owner", () => {
    render(<LabelManager projectId="p1" labels={labels} canCreate={true} canDelete={true} />);

    expect(screen.getByLabelText("Delete label urgent")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete label design")).toBeInTheDocument();
  });
});
