import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EpicChildRow } from "./epic-child-row";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/projects/p1/epics",
  useSearchParams: () => new URLSearchParams(),
}));

describe("EpicChildRow", () => {
  it("shows the location dot, number, title and points, and opens the peek on click", () => {
    pushMock.mockClear();
    render(<EpicChildRow child={{ id: "s2", number: 2, title: "Story two", points: 3, location: "backlog" }} />);

    const button = screen.getByRole("button", { name: /Story two/ });
    expect(button).toHaveAttribute("title", "Backlog #2");
    expect(screen.getByText("•••")).toBeInTheDocument();

    fireEvent.click(button);
    expect(pushMock).toHaveBeenCalledWith("/projects/p1/epics?story=s2", { scroll: false });
  });

  // ux-principles principle 9: rejected must not blend into done (both
  // terminal, but "bounced" and "finished" are not the same thing).
  it("gives rejected its own rose dot, distinct from done's green", () => {
    render(<EpicChildRow child={{ id: "s5", number: 5, title: "Bounced", points: null, location: "rejected" }} />);
    const dot = document.querySelector("span[aria-hidden]")!;
    expect(dot).toHaveClass("bg-rose-500");
    expect(dot).not.toHaveClass("bg-green-500");
    expect(screen.getByRole("button")).toHaveAttribute("title", "Rejected #5");
  });

  it("renders no drag handle (doc-20 §3 mirror-row model, ux-principles principle 1)", () => {
    render(<EpicChildRow child={{ id: "s3", number: 3, title: "Story three", points: null, location: "icebox" }} />);
    expect(screen.getByRole("button").closest("li")).not.toHaveClass("cursor-grab");
  });

  it("omits the points chip when the child has none", () => {
    render(<EpicChildRow child={{ id: "s4", number: 4, title: "Unestimated", points: null, location: "current" }} />);
    expect(screen.queryByText("•")).not.toBeInTheDocument();
  });
});
