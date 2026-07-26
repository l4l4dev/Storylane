import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddChildPicker } from "./add-child-picker";

const { refreshMock, setStoryParentMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  setStoryParentMock: vi.fn<(input: unknown) => Promise<{ ok: boolean; message?: string }>>(() =>
    Promise.resolve({ ok: true }),
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  setStoryParent: setStoryParentMock,
}));

const candidates = [
  { id: "s2", number: 2, title: "Candidate two" },
  { id: "s3", number: 3, title: "Candidate three" },
];

describe("AddChildPicker", () => {
  it("attaches the selected candidate and refreshes on success", async () => {
    refreshMock.mockClear();
    setStoryParentMock.mockClear();
    setStoryParentMock.mockResolvedValue({ ok: true });
    render(<AddChildPicker containerId="epic1" projectId="p1" candidates={candidates} />);

    fireEvent.change(screen.getByLabelText("Add a child"), { target: { value: "s3" } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(setStoryParentMock).toHaveBeenCalledWith({ storyId: "s3", projectId: "p1", parentId: "epic1" });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // Resets to the placeholder rather than staying on the just-picked option.
    expect(screen.getByLabelText("Add a child")).toHaveValue("");
  });

  it("shows the RPC's message and does not refresh when it refuses", async () => {
    refreshMock.mockClear();
    setStoryParentMock.mockResolvedValue({ ok: false, message: "That epic no longer exists." });
    render(<AddChildPicker containerId="epic1" projectId="p1" candidates={candidates} />);

    fireEvent.change(screen.getByLabelText("Add a child"), { target: { value: "s2" } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("That epic no longer exists.")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // /code-review: a bare .then() with no .catch left `pending` stuck true
  // forever when the call rejected instead of resolving to {ok:false}.
  it("clears pending and shows an error when setStoryParent rejects outright", async () => {
    refreshMock.mockClear();
    setStoryParentMock.mockRejectedValueOnce(new Error("Network error"));
    render(<AddChildPicker containerId="epic1" projectId="p1" candidates={candidates} />);

    const select = screen.getByLabelText("Add a child");
    fireEvent.change(select, { target: { value: "s2" } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Network error")).toBeInTheDocument();
    expect(select).not.toBeDisabled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("renders nothing when there are no candidates", () => {
    const { container } = render(<AddChildPicker containerId="epic1" projectId="p1" candidates={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
