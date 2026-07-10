import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModeComparisonCard } from "./mode-comparison-card";

describe("ModeComparisonCard", () => {
  it("renders title, description, and reflects selected state via aria-pressed", () => {
    render(
      <ModeComparisonCard
        mode="tracker"
        title="Tracker"
        description="Fixed story states, iterations, and velocity"
        selected
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Tracker/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Fixed story states, iterations, and velocity")).toBeInTheDocument();
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    render(
      <ModeComparisonCard mode="free" title="Free" description="Trello-style board" selected={false} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Free/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
