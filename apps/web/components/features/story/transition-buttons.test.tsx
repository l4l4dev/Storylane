import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/types";
import type { ProjectState } from "@/lib/types";
import { TransitionButtons } from "./transition-buttons";
import stateTemplates from "../../../../../spec/fixtures/state-templates.json";

const { setStoryStateMock, estimateStoryMock } = vi.hoisted(() => ({
  setStoryStateMock: vi.fn<(formData: FormData) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
  estimateStoryMock: vi.fn<(formData: FormData) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  setStoryState: setStoryStateMock,
  estimateStory: estimateStoryMock,
}));

const fibonacci = [0, 1, 2, 3, 5, 8, 13];

// Classic-template states, keyed by name (ids are runtime UUIDs; this test
// synthesizes stable ids by reusing the name — same pattern as
// packages/core/src/story-state.test.ts).
const CLASSIC_STATES: ProjectState[] = stateTemplates.classic.states.map((s) => ({
  id: s.name,
  name: s.name,
  category: s.category as ProjectState["category"],
  action_label: s.actionLabel,
  position: s.position,
  project_id: "p1",
  created_at: "",
}));

describe("TransitionButtons", () => {
  beforeEach(() => {
    setStoryStateMock.mockReset();
    setStoryStateMock.mockResolvedValue({ ok: true });
    estimateStoryMock.mockReset();
    estimateStoryMock.mockResolvedValue({ ok: true });
  });

  it("renders the next valid transition for the current state", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
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
        stateId="Delivered"
        states={CLASSIC_STATES}
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
        stateId="Accepted"
        states={CLASSIC_STATES}
        storyType="feature"
        points={3}
        pointScale={fibonacci}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one Estimate trigger and opens the point scale in a popover for an unestimated feature", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    // formatPoints renders 1-3 as dots ("•"), so the accessible name comes
    // from an explicit aria-label instead — a screen reader must never hear
    // just "bullet bullet".
    for (const value of fibonacci) {
      expect(
        screen.getByRole("button", { name: `Estimate: ${value} point${value === 1 ? "" : "s"}` }),
      ).toBeInTheDocument();
    }
  });

  // TASK-147: set_story_state already skips the estimation gate server-side
  // for the hidden personal project (TASK-139) — the client gate must match,
  // or a personal task (always unpointed feature by default) would show a
  // needless Estimate popover blocking a one-click Start the server allows.
  it("skips the Estimate gate for a personal project's unestimated feature", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="feature"
        points={null}
        pointScale={fibonacci}
        isPersonal
      />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Estimate" })).not.toBeInTheDocument();
  });

  it("shows estimation buttons instead of Restart for an unestimated rejected feature", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Rejected"
        states={CLASSIC_STATES}
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    expect(screen.queryByRole("button", { name: "Restart" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("does not block Start for an unestimated chore (points don't apply)", () => {
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="chore"
        points={null}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("does not require an estimate to advance between two unstarted-category states (custom triage steps)", () => {
    const customStates: ProjectState[] = [
      { id: "todo", name: "Todo", category: "unstarted", action_label: "Triage", position: 0, project_id: "p1", created_at: "" },
      { id: "triaged", name: "Triaged", category: "unstarted", action_label: "Start", position: 1, project_id: "p1", created_at: "" },
      { id: "doing", name: "Doing", category: "in_progress", action_label: "Done", position: 2, project_id: "p1", created_at: "" },
    ];
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="todo"
        states={customStates}
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByRole("button", { name: "Triage" })).toBeEnabled();
  });

  // TASK-74: a bare <form action> had no pending state, so a double-click
  // fired the transition twice — the button must disable itself as soon as
  // the first click starts the request.
  it("disables the button while pending so a double-click only submits once", async () => {
    let resolveTransition!: (result: ActionResult) => void;
    setStoryStateMock.mockReturnValueOnce(
      new Promise<ActionResult>((resolve) => {
        resolveTransition = resolve;
      }),
    );
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="chore"
        points={null}
        pointScale={fibonacci}
      />,
    );
    const button = screen.getByRole("button", { name: "Start" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(setStoryStateMock).toHaveBeenCalledTimes(1);

    resolveTransition({ ok: true });
    await waitFor(() => expect(button).toBeEnabled());
  });

  // fable-advisor review 2026-07-17 (post-TASK-74 fix): set_story_state has
  // no FOR UPDATE lock yet, so a concurrent Accept + Reject click here could
  // race the same lost-update bug at the UI layer — the whole group
  // disables while any one transition is in flight, not just the clicked
  // button, and shows which one is running.
  it("disables the whole group while one transition is pending, and labels the pending one", async () => {
    let resolveAccept!: (result: ActionResult) => void;
    setStoryStateMock.mockReturnValueOnce(
      new Promise<ActionResult>((resolve) => {
        resolveAccept = resolve;
      }),
    );
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Delivered"
        states={CLASSIC_STATES}
        storyType="feature"
        points={3}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    expect(screen.getByRole("button", { name: "Accept…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(setStoryStateMock).toHaveBeenCalledTimes(1);

    resolveAccept({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  // TASK-74: a rejected transition (e.g. someone else already transitioned
  // the story — the everyday race) used to throw into the route error
  // boundary, replacing the whole board. It must surface inline instead.
  it("shows a failed transition result inline instead of throwing", async () => {
    setStoryStateMock.mockResolvedValueOnce({ ok: false, message: "Story already delivered" });
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="chore"
        points={null}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Story already delivered");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
  });

  it("shows a generic inline error when the action request itself rejects", async () => {
    setStoryStateMock.mockRejectedValueOnce(new Error("Framework-masked failure"));
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="chore"
        points={null}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update the story");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start" })).toBeEnabled());
  });

  it("estimating disables the whole estimate group and reports a failure inline", async () => {
    estimateStoryMock.mockResolvedValueOnce({ ok: false, message: "Invalid point value" });
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    fireEvent.click(screen.getByRole("button", { name: "Estimate: 3 points" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid point value");
    const formData = estimateStoryMock.mock.calls[0]?.[0];
    expect(formData?.get("points")).toBe("3");
    await waitFor(() => expect(screen.getByRole("button", { name: "Estimate: 3 points" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Estimate: 5 points" })).toBeEnabled();
  });

  it("disables the whole estimate group while one estimate is pending", async () => {
    let resolveEstimate!: (result: ActionResult) => void;
    estimateStoryMock.mockReturnValueOnce(
      new Promise<ActionResult>((resolve) => {
        resolveEstimate = resolve;
      }),
    );
    render(
      <TransitionButtons
        storyId="s1"
        projectId="p1"
        stateId="Unstarted"
        states={CLASSIC_STATES}
        storyType="feature"
        points={null}
        pointScale={fibonacci}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    fireEvent.click(screen.getByRole("button", { name: "Estimate: 3 points" }));

    expect(screen.getByRole("button", { name: "Estimate: 3 points" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Estimate: 5 points" })).toBeDisabled();

    resolveEstimate({ ok: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Estimate: 3 points" })).toBeEnabled());
  });
});
