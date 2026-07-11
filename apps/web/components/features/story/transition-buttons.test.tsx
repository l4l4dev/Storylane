import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransitionButtons } from "./transition-buttons";

const fibonacci = [0, 1, 2, 3, 5, 8, 13];

describe("TransitionButtons", () => {
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
});
