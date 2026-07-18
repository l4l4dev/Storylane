import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryListRow } from "./story-list-row";
import type { StoryCardData } from "./story-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => new URLSearchParams(),
}));

const fibonacci = [0, 1, 2, 3, 5, 8, 13];

const baseStory: StoryCardData = {
  id: "s1",
  number: 42,
  title: "Add login",
  description: null,
  story_type: "feature",
  state: "unstarted",
  points: 3,
  assigneeName: null,
  labels: [],
  epic: null,
};

// TASK-41: epic membership must stay visible on the List row too, not just
// the Kanban/Focus card (spec/ux-principles.md principle 8).
describe("StoryListRow", () => {
  it("shows the epic badge when the story belongs to an epic", () => {
    render(
      <StoryListRow
        story={{ ...baseStory, epic: { id: "e1", name: "Checkout revamp", color: "#6366f1" } }}
        projectId="p1"
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByText("Checkout revamp")).toBeInTheDocument();
  });

  it("shows no epic badge when the story has no epic", () => {
    render(<StoryListRow story={baseStory} projectId="p1" pointScale={fibonacci} />);
    expect(screen.queryByText("Checkout revamp")).not.toBeInTheDocument();
  });

  it("reserves readable title width and hides secondary chips below the small breakpoint", () => {
    render(
      <StoryListRow
        story={{
          ...baseStory,
          epic: { id: "e1", name: "Checkout revamp", color: "#6366f1" },
          labels: [{ id: "l1", name: "Urgent", color: "#ef4444" }],
        }}
        projectId="p1"
        pointScale={fibonacci}
      />,
    );

    expect(screen.getByRole("button", { name: /Add login/ })).toHaveClass("min-w-28");
    expect(screen.getByText("Add login")).toHaveClass("min-w-20");
    expect(screen.getByText("Checkout revamp").parentElement?.parentElement).toHaveClass("hidden", "sm:inline-flex");
    expect(screen.getByText("•••")).toHaveClass("hidden", "sm:inline");
    expect(screen.getByText("Urgent")).toHaveClass("text-foreground");
    expect(screen.getByText("Urgent").style.color).toBe("");
  });
});
