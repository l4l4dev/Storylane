import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EpicProgressBar } from "./epic-progress-bar";

describe("EpicProgressBar", () => {
  it("renders the accepted/total count and progressbar value", () => {
    render(<EpicProgressBar progress={{ accepted: 2, total: 4, percent: 50 }} color="#6366f1" />);

    expect(screen.getByText("2 / 4 accepted")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders 0 percent for an epic with no stories", () => {
    render(<EpicProgressBar progress={{ accepted: 0, total: 0, percent: 0 }} color="#6366f1" />);

    expect(screen.getByText("0 / 0 accepted")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
