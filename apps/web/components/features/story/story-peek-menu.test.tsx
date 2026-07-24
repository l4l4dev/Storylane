import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryPeekMenu } from "./story-peek-menu";

// The overflow menu hosts Move/Copy/Delete. (The Split entry lands with the
// Split Studio in TASK-183/184.) split_story's own correctness is covered by
// lib/utils/split.integration.test.ts.
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
const getMoveTargetProjectsMock = vi.fn();
vi.mock("@/app/stories/[id]/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/stories/[id]/actions")>();
  return {
    ...actual,
    getMoveTargetProjects: (...args: unknown[]) => getMoveTargetProjectsMock(...args),
  };
});

const baseDetail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  isPersonalProject: false,
  number: 42,
  title: "Big story to split",
  description: null,
  storyType: "feature",
  stateId: "unstarted-id",
  states: [],
  points: 3,
  parentId: null,
  isContainer: false,
  childCount: 0,
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
  history: [],
  parentCandidates: [],
};

describe("StoryPeekMenu", () => {
  beforeEach(() => {
    pushMock.mockClear();
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

  it("Move dialog lists target projects and explains the carry-over rules", async () => {
    getMoveTargetProjectsMock.mockResolvedValueOnce([
      { id: "p2", name: "Other project" },
      { id: "p3", name: "Third project" },
    ]);
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to project…" }));

    expect(getMoveTargetProjectsMock).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("option", { name: "Other project" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Third project" })).toBeInTheDocument();
    expect(screen.getByText(/labels are\s+recreated there by name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move story" })).toBeInTheDocument();
  });

  it("Copy dialog explains that no comments/history are duplicated", async () => {
    getMoveTargetProjectsMock.mockResolvedValueOnce([{ id: "p2", name: "Other project" }]);
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy to project…" }));

    expect(await screen.findByRole("option", { name: "Other project" })).toBeInTheDocument();
    expect(screen.getByText(/no comments or history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy story" })).toBeInTheDocument();
  });

  it("shows an empty state and disables the button when there's no other project to target", async () => {
    getMoveTargetProjectsMock.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to project…" }));

    expect(await screen.findByText(/not an owner or member of any other project/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move story" })).toBeDisabled();
  });

  // doc-18 §8: move_story_to_project/copy_story_to_project reject a container
  // server-side (deleting the source would orphan its children) — the menu
  // hides the dead actions instead of offering them.
  it("hides Move/Copy for a container story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, isContainer: true }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Move to project…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Copy to project…" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete story" })).toBeInTheDocument();
  });

  // doc-18 §8: deleting a container SET NULLs its children's parent_id
  // (ungrouped, not deleted) — the confirmation must say so, since the
  // existing wording only ever mentioned comments.
  it("warns that child stories will be ungrouped when deleting a container", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, isContainer: true, childCount: 3 }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete story" }));

    expect(screen.getByText(/its 3 child stories will be ungrouped/i)).toBeInTheDocument();
  });

  it("does not mention ungrouping when deleting a non-container story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete story" }));

    expect(screen.queryByText(/ungrouped/i)).not.toBeInTheDocument();
  });
});
