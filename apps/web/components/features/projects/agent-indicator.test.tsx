import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentIndicator } from "./agent-indicator";

describe("AgentIndicator", () => {
  it("renders a labelled badge", () => {
    render(<AgentIndicator />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });

  it("keeps the compact icon accessible", () => {
    render(<AgentIndicator compact />);
    expect(screen.getByLabelText("Agent")).toBeInTheDocument();
  });
});
