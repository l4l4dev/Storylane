import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryDetailPanel } from "./story-detail-panel";

// These tests only exercise rendering, not the Task 11 realtime wiring or
// routing — stub both so `useRouter()` doesn't need an App Router context
// and `useStoryRealtime` doesn't need a real Supabase client/env vars.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/realtime", () => ({
  useStoryRealtime: () => {},
}));

const baseDetail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  number: 42,
  title: "Add login",
  description: "Let users sign in",
  storyType: "feature",
  state: "unstarted",
  points: 3,
  epicId: null,
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  workflowMode: "pivotal",
  customStatusId: null,
  customStatuses: [],
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

  it("renders a status select instead of transition buttons for free-mode projects", () => {
    const freeDetail: StoryDetail = {
      ...baseDetail,
      workflowMode: "free",
      customStatusId: "cs1",
      customStatuses: [
        { id: "cs1", name: "To do" },
        { id: "cs2", name: "Done" },
      ],
    };
    render(<StoryDetailPanel detail={freeDetail} />);
    expect(screen.getByLabelText("Status")).toHaveValue("cs1");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
});
