import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryDetailPanel } from "./story-detail-panel";

const baseDetail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  title: "Add login",
  description: "Let users sign in",
  storyType: "feature",
  state: "unstarted",
  points: 3,
  epicId: null,
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  epics: [],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
};

describe("StoryDetailPanel", () => {
  it("renders the editable fields with their current values", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Add login");
    expect(screen.getByLabelText("Description")).toHaveValue("Let users sign in");
  });

  it("renders the next valid transition button instead of a free state select", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "State" })).not.toBeInTheDocument();
  });

  it("renders the task checklist and comment thread sections", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Comments")).toBeInTheDocument();
  });
});
