import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MyWorkRow, type MyWorkRowData } from "./my-work-row";

const baseStory: MyWorkRowData = {
  id: "s1",
  number: 42,
  title: "Add login",
  storyType: "feature",
  points: 3,
  projectId: "p1",
  projectName: "Storylane",
  stateBadge: { label: "In progress", className: "bg-blue-100" },
};

describe("MyWorkRow", () => {
  it("links the title to the standalone story page", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.getByRole("link", { name: /Add login/ })).toHaveAttribute("href", "/stories/s1");
  });

  it("shows the project chip and state badge", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.getByText("Storylane")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("applies a per-project accent class (TASK-108) so each project reads apart", () => {
    render(<MyWorkRow story={baseStory} />);
    const row = screen.getByTestId("my-work-row");
    // Deterministic accent from the project id + the var-based border class.
    expect(row.className).toMatch(/project-accent-[1-8]/);
    expect(row).toHaveClass("border-l-[color:var(--project-accent)]");
  });

  // fable-advisor (TASK-132, ux-principles.md principle 9): Done is an
  // additive log, so the same story can render as a live Doing card AND a
  // Done log entry at once — completedAt is the only thing that
  // distinguishes them at the card level.
  it("shows no completion marker when completedAt is absent (a live card)", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.queryByLabelText("Completion log entry")).not.toBeInTheDocument();
  });

  it("shows a completion marker when completedAt is set (a Done log entry)", () => {
    render(<MyWorkRow story={baseStory} completedAt="2026-07-20T09:00:00Z" />);
    expect(screen.getByLabelText("Completion log entry")).toBeInTheDocument();
  });
});
