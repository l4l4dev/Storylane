import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyWorkRow, type MyWorkRowData } from "./my-work-row";

const togglePinMock = vi.fn();
vi.mock("@/app/stories/[id]/actions", () => ({
  togglePin: (...args: unknown[]) => togglePinMock(...args),
}));

const baseStory: MyWorkRowData = {
  id: "s1",
  number: 42,
  title: "Add login",
  storyType: "feature",
  points: 3,
  projectId: "p1",
  projectName: "Storylane",
  isPersonal: false,
  stateBadge: { label: "In progress", className: "bg-blue-100" },
  pinned: false,
};

describe("MyWorkRow", () => {
  beforeEach(() => {
    togglePinMock.mockReset();
    togglePinMock.mockResolvedValue({ ok: true });
  });

  it("links the title to the standalone story page", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.getByRole("link", { name: /Add login/ })).toHaveAttribute("href", "/stories/s1");
  });

  it("shows the project chip and state badge", () => {
    render(<MyWorkRow story={baseStory} />);
    expect(screen.getByText("Storylane")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("applies the personal-project accent border only when isPersonal", () => {
    const { rerender } = render(<MyWorkRow story={baseStory} />);
    expect(screen.getByTestId("my-work-row")).not.toHaveClass("border-l-primary");

    rerender(<MyWorkRow story={{ ...baseStory, isPersonal: true }} />);
    expect(screen.getByTestId("my-work-row")).toHaveClass("border-l-primary");
  });

  it("pins an unpinned story and calls togglePin with the target state", async () => {
    render(<MyWorkRow story={{ ...baseStory, pinned: false }} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Pin to My Work" }));

    expect(togglePinMock).toHaveBeenCalledWith("s1", true);
    expect(await screen.findByRole("button", { name: "Unpin from My Work" })).toBeInTheDocument();
  });

  it("unpins a pinned story", async () => {
    render(<MyWorkRow story={{ ...baseStory, pinned: true }} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Unpin from My Work" }));

    expect(togglePinMock).toHaveBeenCalledWith("s1", false);
  });

  it("reverts the optimistic pin toggle when the server call fails", async () => {
    togglePinMock.mockResolvedValueOnce({ ok: false, message: "nope" });
    render(<MyWorkRow story={{ ...baseStory, pinned: false }} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Pin to My Work" }));

    expect(await screen.findByRole("button", { name: "Pin to My Work" })).toBeInTheDocument();
  });

  it("shows a visible error instead of silently reverting on failure", async () => {
    togglePinMock.mockResolvedValueOnce({ ok: false, message: "Not signed in" });
    render(<MyWorkRow story={{ ...baseStory, pinned: false }} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Pin to My Work" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not signed in");
  });

  it("clears a previous error on the next toggle attempt", async () => {
    togglePinMock.mockResolvedValueOnce({ ok: false, message: "Not signed in" });
    togglePinMock.mockResolvedValueOnce({ ok: true });
    render(<MyWorkRow story={{ ...baseStory, pinned: false }} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Pin to My Work" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "Pin to My Work" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
