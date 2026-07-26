import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryPeekMenu } from "./story-peek-menu";

// The overflow menu hosts Split/Move/Copy/Delete. split_story's own
// correctness is covered by lib/utils/split.integration.test.ts.
const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));
const getMoveTargetProjectsMock = vi.fn();
const turnIntoEpicMock = vi.fn();
vi.mock("@/app/stories/[id]/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/stories/[id]/actions")>();
  return {
    ...actual,
    getMoveTargetProjects: (...args: unknown[]) => getMoveTargetProjectsMock(...args),
    turnIntoEpic: (...args: unknown[]) => turnIntoEpicMock(...args),
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
  epicColor: null,
  children: [],
  childRollup: { headline: "icebox", points: 0, breakdown: { unstarted: 0, in_progress: 0, done: 0, rejected: 0, icebox: 0 } },
  addChildCandidates: [],
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
  history: [],
  parentCandidates: [],
  viewerIsMember: true,
};

describe("StoryPeekMenu", () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    turnIntoEpicMock.mockClear();
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

  // doc-18 §7: Split navigates to the Split Studio.
  it("navigates to the Split Studio from the Split menu item", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Split…" }));

    expect(pushMock).toHaveBeenCalledWith("/stories/s1/split");
  });

  // A container is already split; a child can't be split (single-level
  // nesting, doc-18 §3) — split_story rejects both server-side too.
  it("hides Split for a container story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, isContainer: true }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Split…" })).not.toBeInTheDocument();
  });

  it("hides Split for a child story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, parentId: "parent-1" }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Split…" })).not.toBeInTheDocument();
  });

  // Owner decision (TASK-181/184 notes): splitting a personal task would
  // containerize it — dropping it out of My Work with unassigned children
  // also invisible there — so Split is never offered in a personal project.
  it("hides Split for a personal-project story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, isPersonalProject: true }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Split…" })).not.toBeInTheDocument();
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

  // doc-20 §2/TASK-196: the pre-existing set_epic_pinned path had no UI
  // caller — this confirms it, mirroring the Parent picker's own
  // "Make an epic?" confirmation copy.
  it("confirms and calls set_epic_pinned via turnIntoEpic", async () => {
    turnIntoEpicMock.mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Turn into epic…" }));

    expect(screen.getByText(/leave the board; its points and state are cleared/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn into epic" }));

    expect(turnIntoEpicMock).toHaveBeenCalledWith("s1", "p1");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("hides Turn into epic for a container story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, isContainer: true }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Turn into epic…" })).not.toBeInTheDocument();
  });

  it("hides Turn into epic for a viewer who isn't an owner/member", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, viewerIsMember: false }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Turn into epic…" })).not.toBeInTheDocument();
  });

  // set_epic_pinned rejects a personal-project story outright (My Tasks has
  // no epic grouping) — hidden rather than offered and left to fail.
  it("hides Turn into epic for a personal-project story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, isPersonalProject: true }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Turn into epic…" })).not.toBeInTheDocument();
  });

  // set_epic_pinned rejects a child story outright (single-level nesting,
  // doc-18 §3) — hidden rather than offered and left to fail.
  it("hides Turn into epic for a child story", async () => {
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={{ ...baseDetail, parentId: "parent-1" }} />);
    await user.click(screen.getByRole("button", { name: "Story actions" }));

    expect(screen.queryByRole("menuitem", { name: "Turn into epic…" })).not.toBeInTheDocument();
  });
});
