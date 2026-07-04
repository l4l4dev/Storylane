import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoryCard, type StoryCardData } from "./story-card";

const baseStory: StoryCardData = {
  id: "s1",
  title: "Add login",
  story_type: "feature",
  state: "unstarted",
  points: 3,
  assigneeName: null,
  labels: [],
};

describe("StoryCard", () => {
  it("renders a release story as a milestone marker row, not a card", () => {
    render(<StoryCard story={{ ...baseStory, story_type: "release", title: "v1.0" }} projectId="p1" />);
    expect(screen.getByText("v1.0")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders as a link (not an expand toggle) when no projectId is given", () => {
    render(<StoryCard story={baseStory} />);
    expect(screen.getByRole("link", { name: /Add login/ })).toHaveAttribute("href", "/stories/s1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders as a clickable toggle with transition buttons when projectId is given", () => {
    render(<StoryCard story={baseStory} projectId="p1" />);
    expect(screen.getByRole("button", { name: /Add login/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("shows the points dot notation on the collapsed card", () => {
    render(<StoryCard story={baseStory} projectId="p1" />);
    expect(screen.getByText("•••")).toBeInTheDocument();
  });
});
