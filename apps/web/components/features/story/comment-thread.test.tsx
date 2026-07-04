import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommentThread } from "./comment-thread";

describe("CommentThread", () => {
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
});
