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
  // a marker of its own. remaining === ideal (the common day-one case, and
  // the case Codex's review caught as still broken) stacks both markers at
  // the same coordinate — two solid circles would have the larger fully
  // hide the smaller, so this asserts the two markers use genuinely
  // different treatments (a ring vs a filled dot), not just that 2 <circle>
  // elements exist in the DOM regardless of whether either is actually visible.
  it("keeps both markers visible for a coincident single-point series", () => {
    const { container } = render(
      <BurndownChart coverage="full" points={[{ date: "2026-07-01", remaining: 8, ideal: 8 }]} />,
    );
    const circles = [...container.querySelectorAll("circle")];
    expect(circles).toHaveLength(2);
    expect(circles.some((c) => c.getAttribute("fill") === "none")).toBe(true);
    expect(circles.some((c) => c.getAttribute("class")?.includes("fill-primary"))).toBe(true);
  });
});
