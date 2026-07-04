import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommentBody } from "./comment-body";

describe("CommentBody", () => {
  it("renders plain text with no mentions", () => {
    render(<CommentBody body="looks good to me" />);
    expect(screen.getByText("looks good to me")).toBeInTheDocument();
  });

  it("renders a mention as a distinct, styled segment", () => {
    render(<CommentBody body="hey @dev_user can you check this?" />);
    const mention = screen.getByText("@dev_user");
    expect(mention).toBeInTheDocument();
    expect(mention).toHaveClass("text-primary");
  });
});
