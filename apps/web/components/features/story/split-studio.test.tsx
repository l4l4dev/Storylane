import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplitStudio } from "./split-studio";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const splitStoryMock = vi.fn();
vi.mock("@/app/stories/[id]/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/stories/[id]/actions")>();
  return { ...actual, splitStory: (...args: unknown[]) => splitStoryMock(...args) };
});

const baseProps = {
  storyId: "s1",
  projectId: "p1",
  title: "Big feature",
  description: "First do the setup. Then handle the edge case where the user is offline.",
  points: 8,
  tasks: [
    { id: "t1", title: "Write the migration", is_done: false },
    { id: "t2", title: "Wire up the UI", is_done: true },
  ],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
};

describe("SplitStudio", () => {
  beforeEach(() => {
    pushMock.mockClear();
    splitStoryMock.mockReset();
  });

  it("renders the source pane read-only with its title, description, and tasks", () => {
    render(<SplitStudio {...baseProps} />);
    expect(screen.getByText("Big feature")).toBeInTheDocument();
    expect(screen.getByText(/First do the setup/)).toBeInTheDocument();
    expect(screen.getByText("Write the migration")).toBeInTheDocument();
    expect(screen.getByText("Wire up the UI")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument(); // source has no editable Title field
  });

  it("starts with no child cards", () => {
    render(<SplitStudio {...baseProps} />);
    expect(screen.queryAllByRole("button", { name: "Remove this child story" })).toHaveLength(0);
  });

  it("adds a blank child card on '+ new story'", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    expect(screen.getAllByLabelText("Title")).toHaveLength(1);
  });

  it("removes a child card", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    await user.click(screen.getByRole("button", { name: "Remove this child story" }));
    expect(screen.queryAllByLabelText("Title")).toHaveLength(0);
  });

  it("shows the point total of child cards against the source's old points", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    await user.selectOptions(screen.getByLabelText("Points"), "5");

    expect(screen.getByText(/5.*of.*8/i)).toBeInTheDocument();
  });

  // fable-advisor: "of 0 pts" for an unestimated source reads as if it had a
  // real 0-point budget rather than none at all.
  it("shows an em dash, not '0 pts', when the source is unestimated", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} points={null} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));

    expect(screen.getByText(/0 of — pts/)).toBeInTheDocument();
    expect(screen.queryByText(/of 0 pts/)).not.toBeInTheDocument();
  });

  it("hints why Extract is disabled when nothing is selected", () => {
    render(<SplitStudio {...baseProps} />);
    expect(screen.getByText(/select text .* to extract it/i)).toBeInTheDocument();
  });

  it("hints that tasks can be dragged onto a new story card", () => {
    render(<SplitStudio {...baseProps} />);
    expect(screen.getByText(/drag a task onto a new story/i)).toBeInTheDocument();
  });

  it("disables commit with no child cards", () => {
    render(<SplitStudio {...baseProps} />);
    expect(screen.getByRole("button", { name: /split/i })).toBeDisabled();
  });

  // fable-advisor: an empty-title child must never reach split_story — the
  // RPC's raw "not-null violation" error is not a meaningful message (spec/
  // ux-principles.md principle 2).
  it("disables commit while any child card's title is blank", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));

    expect(screen.getByRole("button", { name: /split/i })).toBeDisabled();
  });

  it("disables commit when a child's title is whitespace-only", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    await user.type(screen.getByLabelText("Title"), "   ");

    expect(screen.getByRole("button", { name: /split/i })).toBeDisabled();
  });

  it("re-enables commit once every child card has a non-blank title", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    const titles = screen.getAllByLabelText("Title");
    await user.type(titles[0], "Child A");
    expect(screen.getByRole("button", { name: /split/i })).toBeDisabled(); // second still blank
    await user.type(titles[1], "Child B");

    expect(screen.getByRole("button", { name: /split/i })).toBeEnabled();
  });

  it("shows an inline hint on a blank-title card instead of a silent disable", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));

    expect(screen.getByText(/give.*title/i)).toBeInTheDocument();
  });

  it("extracts a text selection from the description as a new child card", () => {
    render(<SplitStudio {...baseProps} />);
    const descriptionNode = screen.getByTestId("split-source-description");

    // jsdom has no real text-selection layout, so Selection/Range are stubbed
    // directly rather than simulated via mouse events.
    const range = document.createRange();
    range.selectNodeContents(descriptionNode);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    vi.spyOn(selection, "toString").mockReturnValue("handle the edge case where the user is offline");

    fireEvent.mouseUp(descriptionNode);
    fireEvent.click(screen.getByRole("button", { name: /extract selection/i }));

    expect(screen.getByDisplayValue("handle the edge case where the user is offline")).toBeInTheDocument();
  });

  // fable-advisor: with several tasks, the left list must distinguish
  // already-assigned tasks from ones still needing a home, or the user loses
  // track of what's left to sort — no assignment yet, so nothing is marked.
  it("shows no assignment mark on any source task before anything is dragged", () => {
    render(<SplitStudio {...baseProps} />);
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });

  it("shows a pre-commit preview listing the child titles", async () => {
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    await user.type(screen.getByLabelText("Title"), "Child A");

    expect(screen.getByText("Child A")).toBeInTheDocument();
  });

  it("commits via splitStory and navigates to the board with the Icebox accordion open", async () => {
    splitStoryMock.mockResolvedValueOnce({ ok: true, parentId: "s1", childIds: ["c1"] });
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    await user.type(screen.getByLabelText("Title"), "Child A");
    await user.click(screen.getByRole("button", { name: /split/i }));

    await waitFor(() => expect(splitStoryMock).toHaveBeenCalledTimes(1));
    expect(splitStoryMock).toHaveBeenCalledWith(
      "s1",
      expect.arrayContaining([expect.objectContaining({ title: "Child A" })]),
    );
    expect(pushMock).toHaveBeenCalledWith("/projects/p1/board?view=list&icebox=1");
  });

  it("shows an inline error and keeps the cards on a failed commit", async () => {
    splitStoryMock.mockResolvedValueOnce({ ok: false, message: "Split requires at least one child story" });
    const user = userEvent.setup();
    render(<SplitStudio {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "+ new story" }));
    await user.type(screen.getByLabelText("Title"), "Child A");
    await user.click(screen.getByRole("button", { name: /split/i }));

    expect(await screen.findByText("Split requires at least one child story")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Child A");
  });
});
