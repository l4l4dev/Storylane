import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContainerRollup } from "@storylane/core";
import { EpicProgressBar } from "./epic-progress-bar";

const rollup = (breakdown: Partial<ContainerRollup["breakdown"]>, points = 0): ContainerRollup => ({
  headline: "in_progress",
  points,
  breakdown: { unstarted: 0, in_progress: 0, done: 0, rejected: 0, icebox: 0, ...breakdown },
});

describe("EpicProgressBar", () => {
  it("renders the done count against the total child count", () => {
    render(<EpicProgressBar rollup={rollup({ done: 2, unstarted: 2 })} color="#6366f1" />);
    expect(screen.getByText("2 / 4 done")).toBeInTheDocument();
  });

  it("exposes the done percentage as the progressbar value", () => {
    render(<EpicProgressBar rollup={rollup({ done: 1, unstarted: 3 })} color="#6366f1" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it("renders 0 for a container with no children", () => {
    render(<EpicProgressBar rollup={rollup({})} color="#6366f1" />);
    expect(screen.getByText("0 / 0 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  // doc-18 §5: rejected children show in their own color but never roll the
  // headline to rejected — the breakdown surfaces the count regardless.
  it("shows the rejected count separately without counting it as done", () => {
    render(<EpicProgressBar rollup={rollup({ done: 1, rejected: 2, unstarted: 1 })} color="#6366f1" />);
    expect(screen.getByText("2 rejected")).toBeInTheDocument();
    expect(screen.getByText("1 / 4 done")).toBeInTheDocument();
  });

  it("shows the point total", () => {
    render(<EpicProgressBar rollup={rollup({ done: 1 }, 8)} color="#6366f1" />);
    expect(screen.getByText("8 pts")).toBeInTheDocument();
  });
});
