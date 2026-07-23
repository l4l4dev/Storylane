import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/types";
import { CommentThread } from "./comment-thread";

const { addCommentMock } = vi.hoisted(() => ({
  addCommentMock: vi.fn<(formData: FormData) => Promise<ActionResult>>(() => Promise.resolve({ ok: true })),
}));

vi.mock("@/app/stories/[id]/actions", () => ({
  addComment: addCommentMock,
}));

describe("CommentThread", () => {
  beforeEach(() => {
    addCommentMock.mockReset();
    addCommentMock.mockResolvedValue({ ok: true });
  });

  it("shows an empty state when there are no comments", () => {
    render(<CommentThread storyId="s1" projectId="p1" comments={[]} />);
    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });

  it("renders each comment's author and body", () => {
    render(
      <CommentThread
        storyId="s1"
        projectId="p1"
        comments={[
          { id: "c1", body: "looks good", createdAt: "2026-07-01T00:00:00.000Z", authorName: "Ada" },
        ]}
      />,
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("looks good")).toBeInTheDocument();
  });

  it("renders the add-comment form", () => {
    render(<CommentThread storyId="s1" projectId="p1" comments={[]} />);
    expect(screen.getByPlaceholderText(/Add a comment/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
  });

  // TASK-74: a bare <form action> had no pending state, so a double-click
  // fired the submit twice — the button must disable itself immediately.
  it("disables the submit while pending so a double-click only submits once", async () => {
    let resolveAdd!: (result: ActionResult) => void;
    addCommentMock.mockReturnValueOnce(
      new Promise<ActionResult>((resolve) => {
        resolveAdd = resolve;
      }),
    );
    render(<CommentThread storyId="s1" projectId="p1" comments={[]} />);
    fireEvent.change(screen.getByPlaceholderText(/Add a comment/), { target: { value: "Looks good" } });
    const button = screen.getByRole("button", { name: "Comment" });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(addCommentMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAdd({ ok: true });
      await Promise.resolve();
    });
  });

  it("shows a failed submit result inline and keeps the typed draft", async () => {
    addCommentMock.mockResolvedValueOnce({ ok: false, message: "Story not found" });
    render(<CommentThread storyId="s1" projectId="p1" comments={[]} />);
    const textarea = screen.getByPlaceholderText(/Add a comment/);
    fireEvent.change(textarea, { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Story not found");
    expect(textarea).toHaveValue("Looks good");
    // The alert (from setError) and the transition's pending flag flipping
    // back to false aren't guaranteed to land in the same render tick —
    // waitFor instead of asserting immediately avoided an intermittent
    // failure here (TASK-169).
    await waitFor(() => expect(screen.getByRole("button", { name: "Comment" })).toBeEnabled());
  });

  it("clears the draft once the comment is added", async () => {
    render(<CommentThread storyId="s1" projectId="p1" comments={[]} />);
    const textarea = screen.getByPlaceholderText(/Add a comment/);
    fireEvent.change(textarea, { target: { value: "Looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(textarea).toHaveValue("");
  });
});
