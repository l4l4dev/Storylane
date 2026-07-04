import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransitionButtons } from "./transition-buttons";

describe("TransitionButtons", () => {
  it("renders the next valid transition for the current state", () => {
    render(
      <TransitionButtons storyId="s1" projectId="p1" state="unstarted" storyType="feature" points={3} />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
  });

  it("offers both Accept and Reject for a delivered story", () => {
    render(
      <TransitionButtons storyId="s1" projectId="p1" state="delivered" storyType="feature" points={3} />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("renders nothing for a terminal state with no further transitions", () => {
    const { container } = render(
      <TransitionButtons storyId="s1" projectId="p1" state="accepted" storyType="feature" points={3} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("disables Start for an unestimated feature", () => {
    render(
      <TransitionButtons storyId="s1" projectId="p1" state="unstarted" storyType="feature" points={null} />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("does not disable Start for an unestimated chore (points don't apply)", () => {
    render(
      <TransitionButtons storyId="s1" projectId="p1" state="unstarted" storyType="chore" points={null} />,
    );
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });
});
