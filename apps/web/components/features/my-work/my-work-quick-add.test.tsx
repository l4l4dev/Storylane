import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MyWorkQuickAdd } from "./my-work-quick-add";
import type { ActionResult } from "@/lib/types";

vi.mock("@/app/projects/[id]/board/actions", () => ({
  createDraftStory: vi.fn<() => Promise<ActionResult>>(async () => ({ ok: true })),
}));

// TASK-171: opening the quick-add must not grow the trigger's own block in
// normal flow — the page pushed the whole board down when it did. The open
// card renders as an absolute overlay instead, so its parent (the relative
// wrapper) stays sized to the trigger button alone.
describe("MyWorkQuickAdd", () => {
  it("renders the open draft card as an absolute overlay, not in normal flow", () => {
    render(
      <MyWorkQuickAdd
        projectId="project-1"
        currentUserId="user-1"
        pointScale={[1, 2, 3]}
        epics={[]}
        members={[]}
        labels={[]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Add a personal task"));

    const titleInput = screen.getByLabelText(/title/i);
    const overlay = titleInput.closest(".absolute");
    expect(overlay).not.toBeNull();
    expect(overlay).toHaveClass("top-full");
  });
});
