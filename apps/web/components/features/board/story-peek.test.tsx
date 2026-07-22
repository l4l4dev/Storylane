import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryPeek } from "./story-peek";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => new URLSearchParams("type=feature&story=s1"),
}));

vi.mock("@/components/features/story/story-detail-panel", () => ({
  StoryDetailPanel: () => <div>Story fields</div>,
}));

vi.mock("@/components/features/story/story-peek-menu", () => ({
  StoryPeekMenu: () => <button type="button">Story actions</button>,
}));

const detail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  isPersonalProject: false,
  number: 42,
  title: "Add login",
  description: null,
  storyType: "feature",
  stateId: null,
  states: [],
  points: null,
  epicId: null,
  assigneeId: null,
  labelIds: [],
  pointScale: [],
  epics: [],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
  history: [],
};

describe("StoryPeek", () => {
  it("moves focus to the non-modal panel when it opens", () => {
    render(<StoryPeek detail={detail} />);

    expect(screen.getByRole("complementary")).toHaveFocus();
    expect(screen.getByRole("heading", { name: /#42.*Add login/ })).toBeInTheDocument();
  });

  it("moves focus to the panel again when the opened story changes", () => {
    const { rerender } = render(<StoryPeek detail={detail} />);
    screen.getByRole("button", { name: "Story actions" }).focus();

    rerender(<StoryPeek detail={{ ...detail, id: "s2", number: 43, title: "Add logout" }} />);

    expect(screen.getByRole("complementary")).toHaveFocus();
    expect(screen.getByRole("heading", { name: /#43.*Add logout/ })).toBeInTheDocument();
  });

  it("closes by removing only the story query param", () => {
    render(<StoryPeek detail={detail} />);

    fireEvent.click(screen.getByRole("button", { name: "Close story detail" }));

    expect(pushMock).toHaveBeenCalledWith("/projects/p1/board?type=feature", { scroll: false });
  });

  it("returns focus to the opener when the focused panel closes", () => {
    function Surface({ open }: { open: boolean }) {
      return (
        <>
          <button type="button">Open story</button>
          {open && <StoryPeek detail={detail} />}
        </>
      );
    }

    const { rerender } = render(<Surface open={false} />);
    const opener = screen.getByRole("button", { name: "Open story" });
    opener.focus();

    rerender(<Surface open />);
    expect(screen.getByRole("complementary")).toHaveFocus();

    rerender(<Surface open={false} />);

    expect(screen.getByRole("button", { name: "Open story" })).toHaveFocus();
  });
});
