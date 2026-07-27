import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BurndownChart } from "./burndown-chart";

describe("BurndownChart", () => {
  it("exposes the actual and ideal series without requiring visual perception", () => {
    render(
      <BurndownChart
        coverage="full"
        points={[
          { date: "2026-07-01", remaining: 8, ideal: 10 },
          { date: "2026-07-02", remaining: 3, ideal: 0 },
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: /remaining 3 points; ideal pace 0 points/i })).toBeInTheDocument();
    expect(screen.getAllByText("Remaining")).toHaveLength(2);
    expect(screen.getByText("Ideal pace")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2026/7/1" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "2026/7/2 3 0" })).toBeInTheDocument();
  });

  it("explains missing activity history instead of throwing", () => {
    render(<BurndownChart coverage="none" points={[]} />);
    expect(screen.getByText(/cannot be reconstructed/)).toBeInTheDocument();
  });

  // A single point (day one of a current iteration, or any one-day iteration)
  // gives <polyline> nothing to connect — it paints no visible pixel without
  // a marker of its own.
  it("renders a visible marker for a single-point series", () => {
    const { container } = render(
      <BurndownChart coverage="full" points={[{ date: "2026-07-01", remaining: 8, ideal: 8 }]} />,
    );
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });
});
