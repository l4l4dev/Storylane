import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransitionButtons } from "./transition-buttons";

const { transitionStoryMock, estimateStoryMock } = vi.hoisted(() => ({
  transitionStoryMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
  estimateStoryMock: vi.fn<(formData: FormData) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  transitionStory: transitionStoryMock,
  estimateStory: estimateStoryMock,
}));

const fibonacci = [0, 1, 2, 3, 5, 8, 13];

describe("TransitionButtons", () => {
  beforeEach(() => {
    transitionStoryMock.mockReset();
    transitionStoryMock.mockResolvedValue(undefined);
    estimateStoryMock.mockReset();
    estimateStoryMock.mockResolvedValue(undefined);
  });

  it("renders the next valid transition for the current state", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="unstarted"
        storyType="feature"
        points={3}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
  });

  it("offers both Accept and Reject for a delivered story", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="delivered"
        storyType="feature"
        points={3}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("renders nothing for a terminal state with no further transitions", () => {
    const { container } = render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="accepted"
        storyType="feature"
        points={3}
        pointScale={fibonacci}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the point-scale estimation buttons instead of a disabled Start for an unestimated feature", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="unstarted"
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    // formatPoints renders 1-3 as dots ("•"), so the accessible name comes
    // from an explicit aria-label instead — a screen reader must never hear
    // just "bullet bullet".
    for (const value of fibonacci) {
      expect(
        screen.getByRole("button", { name: `Estimate: ${value} point${value === 1 ? "" : "s"}` }),
      ).toBeInTheDocument();
    }
  });

  it("shows estimation buttons instead of Restart for an unestimated rejected feature", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="rejected"
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(fibonacci.length);
  });

  it("does not block Start for an unestimated chore (points don't apply)", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="unstarted"
        storyType="chore"
        points={null}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  // TASK-74: a bare <form action> had no pending state, so a double-click
  // fired the transition twice — the button must disable itself as soon as
  // the first click starts the request.
  it("disables the button while pending so a double-click only submits once", async () => {
    let resolveTransition!: () => void;
    transitionStoryMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveTransition = resolve;
      }),
    );
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="unstarted"
        storyType="chore"
        points={null}
        pointScale={fibonacci}
      />,
    );
    const button = screen.getByRole("button", { name: "Start" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(transitionStoryMock).toHaveBeenCalledTimes(1);

    resolveTransition();
    await waitFor(() => expect(button).toBeEnabled());
  });

  // fable-advisor review 2026-07-17 (post-TASK-74 fix): transition_story has
  // no FOR UPDATE lock yet (TASK-48 AC#5), so a concurrent Accept + Reject
  // click here could race the same lost-update bug at the UI layer — the
  // whole group disables while any one transition is in flight, not just
  // the clicked button, and shows which one is running.
  it("disables the whole group while one transition is pending, and labels the pending one", async () => {
    let resolveAccept!: () => void;
    transitionStoryMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveAccept = resolve;
      }),
    );
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="delivered"
        storyType="feature"
        points={3}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(screen.getByRole("button", { name: "Accept…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(transitionStoryMock).toHaveBeenCalledTimes(1);

    resolveAccept();
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  // TASK-74: a rejected transition (e.g. someone else already transitioned
  // the story — the everyday race) used to throw into the route error
  // boundary, replacing the whole board. It must surface inline instead.
  it("shows a rejected transition inline instead of throwing", async () => {
    transitionStoryMock.mockRejectedValueOnce(new Error("Story already delivered"));
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="unstarted"
        storyType="chore"
        points={null}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Story already delivered");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
  });

  it("estimating disables the whole estimate group and reports a failure inline", async () => {
    estimateStoryMock.mockRejectedValueOnce(new Error("Invalid point value"));
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="unstarted"
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Estimate: 3 points" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid point value");
    const formData = estimateStoryMock.mock.calls[0]?.[0];
    expect(formData?.get("points")).toBe("3");
    await waitFor(() => expect(screen.getByRole("button", { name: "Estimate: 3 points" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Estimate: 5 points" })).toBeEnabled();
  });

  it("disables the whole estimate group while one estimate is pending", async () => {
    let resolveEstimate!: () => void;
    estimateStoryMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveEstimate = resolve;
      }),
    );
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        state="unstarted"
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Estimate: 3 points" }));

    expect(screen.getByRole("button", { name: "Estimate: 3 points" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Estimate: 5 points" })).toBeDisabled();

    resolveEstimate();
    await waitFor(() => expect(screen.getByRole("button", { name: "Estimate: 3 points" })).toBeEnabled());
  });
});
