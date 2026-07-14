import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryPeekMenu } from "./story-peek-menu";

// TASK-13 AC #1/#4: wording variations for the promote confirmation dialog
// (task count / empty-epic / comment-deletion warning). Routing and the RPC
// action itself are stubbed — the RPC's own correctness is covered by
// lib/utils/promote.integration.test.ts.
const { pushMock, pathnameMock, searchParamsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  pathnameMock: vi.fn<() => string>(() => "/projects/p1/board"),
  searchParamsMock: vi.fn<() => URLSearchParams>(() => new URLSearchParams()),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameMock(),
  useSearchParams: () => searchParamsMock(),
}));
const getMoveTargetProjectsMock = vi.fn();
const promoteStoryToEpicMock = vi.fn();
vi.mock("@/app/stories/[id]/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/stories/[id]/actions")>();
  return {
    ...actual,
    promoteStoryToEpic: (...args: unknown[]) => promoteStoryToEpicMock(...args),
    getMoveTargetProjects: (...args: unknown[]) => getMoveTargetProjectsMock(...args),
  };
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
  beforeEach(() => {
    pushMock.mockClear();
    pathnameMock.mockReturnValue("/projects/p1/board");
    searchParamsMock.mockReturnValue(new URLSearchParams());
    promoteStoryToEpicMock.mockReset();
    promoteStoryToEpicMock.mockResolvedValue({ ok: true, epicId: "e1" });
  });

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

  // fable-advisor review: redirecting to a bare board URL after promoting
  // used to silently drop any active Type/Assignee/Label/Epic filter when
  // promoting from the board's own peek — the same "preserve other params"
  // convention BoardFilters.setParam and StoryCard.openPeek already follow.
  it("preserves the board's active filters when promoting from the board peek", async () => {
    pathnameMock.mockReturnValue("/projects/p1/board");
    searchParamsMock.mockReturnValue(new URLSearchParams("type=feature&story=s1"));
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await openPromoteDialog();
    await user.click(screen.getByRole("button", { name: "Promote to epic" }));

    expect(pushMock).toHaveBeenCalledWith(
      "/projects/p1/board?type=feature&promoted_epic=e1&promoted_epic_name=Big+story+to+split",
    );
  });

  it("redirects to a bare board URL when promoting from the standalone story page", async () => {
    pathnameMock.mockReturnValue("/stories/s1");
    searchParamsMock.mockReturnValue(new URLSearchParams());
    const user = userEvent.setup();
    render(<StoryPeekMenu detail={baseDetail} />);
    await openPromoteDialog();
    await user.click(screen.getByRole("button", { name: "Promote to epic" }));

    expect(pushMock).toHaveBeenCalledWith(
      "/projects/p1/board?promoted_epic=e1&promoted_epic_name=Big+story+to+split",
    );
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
});
