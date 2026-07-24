import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoryCard, type StoryCardData } from "./story-card";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => new URLSearchParams("type=feature"),
}));

const baseStory: StoryCardData = {
  id: "s1",
  number: 42,
  title: "Add login",
  description: null,
  story_type: "feature",
  isDone: false,
  points: 3,
  assigneeName: null,
  labels: [],
};

describe("StoryCard", () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it("renders a release story as a milestone marker row that opens the peek", () => {
    render(<StoryCard story={{ ...baseStory, story_type: "release", title: "v1.0" }} projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /v1.0/ }));
    expect(pushMock).toHaveBeenCalledWith("/projects/p1/board?type=feature&story=s1", {
      scroll: false,
    });
  });

  it("renders as a link (not a peek trigger) when no projectId is given", () => {
    render(<StoryCard story={baseStory} />);
    expect(screen.getByRole("link", { name: /Add login/ })).toHaveAttribute("href", "/stories/s1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("opens the side peek via ?story= (preserving other params) on the board", () => {
    render(<StoryCard story={baseStory} projectId="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /Add login/ }));
    expect(pushMock).toHaveBeenCalledWith("/projects/p1/board?type=feature&story=s1", {
      scroll: false,
    });
    // State transitions happen by dragging between columns (spec/screens.md
    // "Story card UX") — the card no longer offers a Start button.
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("shows a one-line description under the title when present", () => {
    render(<StoryCard story={{ ...baseStory, description: "Support OAuth login" }} projectId="p1" />);
    expect(screen.getByText("Support OAuth login")).toBeInTheDocument();
  });

  it("shows the points dot notation on the card", () => {
    render(<StoryCard story={baseStory} projectId="p1" />);
    expect(screen.getByText("•••")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByLabelText("3 points")).toBeInTheDocument();
  });

  it("shows the per-project story number on the card", () => {
    render(<StoryCard story={baseStory} projectId="p1" />);
    expect(screen.getByText("#42")).toBeInTheDocument();
  });

  it("shows assignee initials in the meta row", () => {
    render(<StoryCard story={{ ...baseStory, assigneeName: "Mary Evans" }} projectId="p1" />);
    expect(screen.getByTitle("Mary Evans")).toHaveTextContent("ME");
  });

  it("marks an agent assignee without changing the displayed identity", () => {
    render(
      <StoryCard
        story={{ ...baseStory, assigneeName: "Claude", assigneeIsAgent: true }}
        projectId="p1"
      />,
    );
    expect(screen.getByTitle("Claude (agent)")).toHaveTextContent("CL");
    expect(screen.getByLabelText("Agent")).toBeInTheDocument();
  });

  it("uses theme foreground text while keeping user colors in chip tints and dots", () => {
    render(
      <StoryCard
        story={{
          ...baseStory,
          labels: [{ id: "l1", name: "Dark label", color: "#111111" }],
        }}
        projectId="p1"
      />,
    );

    const labelChip = screen.getByText("Dark label");
    expect(labelChip).toHaveClass("text-foreground");
    expect(labelChip).toHaveStyle({ backgroundColor: "#11111122" });
    expect(labelChip.style.color).toBe("");
  });
});
