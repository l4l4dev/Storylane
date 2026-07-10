import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryPeekMenu } from "./story-peek-menu";

// TASK-13 AC #1/#4: wording variations for the promote confirmation dialog
// (task count / empty-epic / comment-deletion warning). Routing and the RPC
// action itself are stubbed — the RPC's own correctness is covered by
// lib/utils/promote.integration.test.ts.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/app/stories/[id]/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/stories/[id]/actions")>();
  return { ...actual, promoteStoryToEpic: vi.fn() };
});

const baseDetail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  number: 42,
  title: "Big story to split",
  description: null,
  storyType: "feature",
  state: "unstarted",
  points: 3,
  epicId: null,
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  workflowMode: "tracker",
  customStatusId: null,
  customStatuses: [],
  epics: [],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
};

async function openPromoteDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Story actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Promote to Epic" }));
}

describe("StoryPeekMenu", () => {
  it("warns the epic starts empty when the story has no tasks", async () => {
    render(<StoryPeekMenu detail={baseDetail} />);
    await openPromoteDialog();

    expect(screen.getByText(/it has no tasks, so the epic starts empty/i)).toBeInTheDocument();
  });

  it("mentions the task count and that task completion isn't carried over", async () => {
    render(
      <StoryPeekMenu
        detail={{
          ...baseDetail,
          tasks: [
            { id: "t1", title: "a", is_done: false },
            { id: "t2", title: "b", is_done: true },
          ],
        }}
      />,
    );
    await openPromoteDialog();

    expect(screen.getByText(/its 2 tasks become unestimated feature stories/i)).toBeInTheDocument();
    expect(screen.getByText(/task completion state isn't carried over/i)).toBeInTheDocument();
  });

  it("warns comments will be deleted when the story has comments", async () => {
    render(
      <StoryPeekMenu
        detail={{
          ...baseDetail,
          comments: [{ id: "c1", body: "hi", createdAt: "2026-07-10", authorName: "Dev" }],
        }}
      />,
    );
    await openPromoteDialog();

    expect(screen.getByText(/including its 1 comment, which cannot be recovered/i)).toBeInTheDocument();
  });

  it("does not mention comments when the story has none", async () => {
    render(<StoryPeekMenu detail={baseDetail} />);
    await openPromoteDialog();

    expect(screen.queryByText(/comment/i)).not.toBeInTheDocument();
  });

  it("shows a delete confirmation naming the story and its comment count", async () => {
    const user = userEvent.setup();
    render(
      <StoryPeekMenu
        detail={{
          ...baseDetail,
          comments: [{ id: "c1", body: "hi", createdAt: "2026-07-10", authorName: "Dev" }],
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete story" }));

    expect(screen.getByText(/including its 1 comment/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete story" })).toBeInTheDocument();
  });
});
