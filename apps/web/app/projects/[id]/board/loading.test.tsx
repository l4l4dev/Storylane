import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BoardLoading from "./loading";

describe("BoardLoading", () => {
  it("announces loading and renders compact list rows instead of Kanban columns", () => {
    const { container } = render(<BoardLoading />);

    expect(screen.getByText("Loading board")).toBeInTheDocument();
    expect(container.querySelector("main")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("section")).toHaveLength(2);
    expect(container.querySelector(".overflow-x-auto")).not.toBeInTheDocument();
  });
});
