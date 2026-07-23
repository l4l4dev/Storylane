import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyWorkRow, type MyWorkRowData } from "./my-work-row";

const baseStory: MyWorkRowData = {
  id: "s1",
  number: 42,
  title: "Add login",
  storyType: "feature",
  points: 3,
  projectId: "p1",
  projectName: "Storylane",
  isPersonal: false,
  stateBadge: { label: "In progress", className: "bg-blue-100" },
};

describe("MyWorkRow", () => {
  it("links the title to the standalone story page when onOpen is unset (the archive page)", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.getByRole("link", { name: /Add login/ })).toHaveAttribute("href", "/stories/s1");
  });

  // TASK-172: the main My Work board passes onOpen to open a side peek
  // instead of navigating away, matching the project board's StoryCard.
  it("calls onOpen instead of linking away when the caller supplies it", () => {
    const onOpen = vi.fn();
    render(<MyWorkRow story={baseStory} onOpen={onOpen} />);
    expect(screen.queryByRole("link", { name: /Add login/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add login/ }));
    expect(onOpen).toHaveBeenCalledOnce();
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
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });

  // doc-17 #12 (owner-chosen Norman/Krug strengthen direction) + #41: visible
  // "Completed" text at rest, not just an icon a hover title explains. The
  // full date lives in the title only (fable-advisor review) — every Done/
  // archive row already sits under a date-group heading, so repeating it
  // inline would be redundant and crowd out the title in Done's narrow column.
  it("shows a visible 'Completed' marker (full date in its title) when completedAt is set", () => {
    render(<MyWorkRow story={baseStory} completedAt="2026-07-20T09:00:00Z" />);
    expect(screen.getByText("Completed")).toHaveAttribute("title", expect.stringContaining("Completed"));
  });

  // doc-17 #3: personal-vs-team governs drag-to-Done behavior, so it must be
  // visible on the card, not just discoverable by dragging it.
  it("shows a persistent 'Personal' signifier for a personal-project story", () => {
    render(<MyWorkRow story={{ ...baseStory, isPersonal: true }} />);
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });

  it("shows no 'Personal' signifier for a team story", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.queryByText("Personal")).not.toBeInTheDocument();
  });

  // doc-17 #2: identity must survive even where the full name badge hides
  // below sm — a compact initials marker carries it instead.
  it("always renders a compact project-initials marker carrying the full name", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.getByText("ST")).toHaveAttribute("title", "Storylane");
  });
});
