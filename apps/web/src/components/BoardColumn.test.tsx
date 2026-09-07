import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { BoardColumn } from "./BoardColumn";
import type { StoryView } from "./StoryCard";

afterEach(() => vi.restoreAllMocks());

const story: StoryView = {
  id: "s1",
  number: 1,
  title: "First story",
  storyType: "feature",
  stateId: null,
  points: null,
  completedAt: null,
};

function renderColumn() {
  return render(
    <DndContext>
      <BoardColumn
        projectId="p1"
        state={null}
        storyIds={["s1"]}
        storiesById={new Map([["s1", story]])}
        gateStates={[]}
        scaleValues={[0, 1, 2, 3]}
        showQuickAdd
        onAdvance={vi.fn()}
        onAdded={vi.fn()}
      />
    </DndContext>,
  );
}

describe("BoardColumn quick-add overlay", () => {
  it("does not move the card list when the quick-add form opens (ux-principles #3)", async () => {
    renderColumn();
    const listBefore = screen.getByRole("list");
    const cardTopBefore = screen.getByText("First story").closest("li")!.getBoundingClientRect().top;

    await userEvent.click(screen.getByRole("button", { name: /add a story/i }));

    // The form is an overlay, not a slot pushing the list down: the same list element is still
    // there, still holding the same card, and the overlay wrapper is positioned absolutely so it
    // never participates in the column's normal flow layout.
    expect(screen.getByRole("list")).toBe(listBefore);
    const cardTopAfter = screen.getByText("First story").closest("li")!.getBoundingClientRect().top;
    expect(cardTopAfter).toBe(cardTopBefore);

    const overlay = screen.getByLabelText(/title/i).closest("form")!.parentElement!;
    expect(overlay.style.position).toBe("absolute");
  });

  it("closes on Cancel without moving anything", async () => {
    renderColumn();
    await userEvent.click(screen.getByRole("button", { name: /add a story/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByLabelText(/title/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add a story/i })).toBeInTheDocument();
  });
});
