import { DndContext } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { SortableItem } from "./sortable-item";

// doc-17 #43: dnd-kit's `attributes` (role="button", tabIndex) used to be
// spread onto this <li>, nesting a link (every card wraps its own <Link> to
// the story) inside a button role and giving each card two tab stops.
describe("SortableItem", () => {
  it("does not apply a button role or tabIndex to the wrapper, leaving its own link as the single tab stop", () => {
    render(
      <DndContext>
        <SortableContext items={["s1"]} strategy={verticalListSortingStrategy}>
          <ul>
            <SortableItem id="s1">
              <Link href="/stories/s1">Story title</Link>
            </SortableItem>
          </ul>
        </SortableContext>
      </DndContext>,
    );

    const item = screen.getByRole("listitem");
    expect(item).not.toHaveAttribute("role", "button");
    expect(item).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("link", { name: "Story title" })).toBeInTheDocument();
  });
});
