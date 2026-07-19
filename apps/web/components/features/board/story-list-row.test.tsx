import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoryListRow } from "./story-list-row";
import type { StoryCardData } from "./story-card";
import type { ProjectState } from "@/lib/types";
import stateTemplates from "../../../../../spec/fixtures/state-templates.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => new URLSearchParams(),
}));

const fibonacci = [0, 1, 2, 3, 5, 8, 13];

// Classic-template states, keyed by name (ids are runtime UUIDs; this test
// synthesizes stable ids by reusing the name).
const CLASSIC_STATES: ProjectState[] = stateTemplates.classic.states.map((s) => ({
  id: s.name,
  name: s.name,
  category: s.category as ProjectState["category"],
  action_label: s.actionLabel,
  position: s.position,
  project_id: "p1",
  created_at: "",
}));

const baseStory: StoryCardData & { state_id: string | null } = {
  id: "s1",
  number: 42,
  title: "Add login",
  description: null,
  story_type: "feature",
  isDone: false,
  state_id: "Unstarted",
  points: 3,
  assigneeName: null,
  labels: [],
  epic: null,
};

// TASK-41: epic membership must stay visible on the List row too, not just
// the Kanban/Focus card (spec/ux-principles.md principle 8).
describe("StoryListRow", () => {
  it("shows the epic badge when the story belongs to an epic", () => {
    render(
      <StoryListRow
        story={{ ...baseStory, epic: { id: "e1", name: "Checkout revamp", color: "#6366f1" } }}
        projectId="p1"
        states={CLASSIC_STATES}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByText("Checkout revamp")).toBeInTheDocument();
  });

  it("shows no epic badge when the story has no epic", () => {
    render(<StoryListRow story={baseStory} projectId="p1" states={CLASSIC_STATES} pointScale={fibonacci} />);
    expect(screen.queryByText("Checkout revamp")).not.toBeInTheDocument();
  });

  it("marks an agent assignee in the compact row", () => {
    render(
      <StoryListRow
        story={{ ...baseStory, assigneeName: "Claude", assigneeIsAgent: true }}
        projectId="p1"
        states={CLASSIC_STATES}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByTitle("Claude (agent)")).toHaveTextContent("CL");
    expect(screen.getByLabelText("Agent")).toBeInTheDocument();
  });

  it("shows the state badge with the state's own name", () => {
    render(<StoryListRow story={baseStory} projectId="p1" states={CLASSIC_STATES} pointScale={fibonacci} />);
    expect(screen.getByText("Unstarted")).toBeInTheDocument();
  });

  it("shows no state badge for an Icebox row (state_id null)", () => {
    render(
      <StoryListRow story={{ ...baseStory, state_id: null }} projectId="p1" states={CLASSIC_STATES} pointScale={fibonacci} />,
    );
    expect(screen.queryByText("Icebox")).not.toBeInTheDocument();
  });

  it("lets the title shrink and hides secondary chips below the small breakpoint", () => {
    render(
      <StoryListRow
        story={{
          ...baseStory,
          epic: { id: "e1", name: "Checkout revamp", color: "#6366f1" },
          labels: [{ id: "l1", name: "Urgent", color: "#ef4444" }],
        }}
        projectId="p1"
        states={CLASSIC_STATES}
        pointScale={fibonacci}
      />,
    );

    expect(screen.getByRole("button", { name: /Add login/ })).toHaveClass("min-w-0");
    expect(screen.getByText("Add login")).toHaveClass("min-w-0", "flex-1");
    expect(screen.getByText("Checkout revamp").parentElement?.parentElement).toHaveClass("hidden", "sm:inline-flex");
    expect(screen.getByText("•••")).toHaveClass("hidden", "sm:inline");
    expect(screen.getByText("Urgent")).toHaveClass("text-foreground");
    expect(screen.getByText("Urgent").style.color).toBe("");
  });

  it("does not horizontally overflow a worst-case unestimated row at 360px", () => {
    const { container } = render(
      <div style={{ width: 360 }}>
        <StoryListRow
          story={{
            ...baseStory,
            title: "A very long feature title that must truncate instead of widening the story row on a phone",
            points: null,
            state_id: "Rejected",
            assigneeName: "Mary Evans",
            epic: { id: "e1", name: "Checkout revamp", color: "#6366f1" },
            labels: [
              { id: "l1", name: "Urgent", color: "#ef4444" },
              { id: "l2", name: "Customer request", color: "#3b82f6" },
            ],
          }}
          projectId="p1"
          states={CLASSIC_STATES}
          pointScale={fibonacci}
          insertMenu={<button type="button">Insert</button>}
        />
      </div>,
    );

    const viewport = container.firstElementChild as HTMLElement;
    const row = screen.getByTestId("story-list-row");
    expect(viewport.style.width).toBe("360px");
    // jsdom does no layout, so scrollWidth/clientWidth are always 0 — assert
    // the overflow contract via classes instead (real-browser 360px check:
    // TASK-94). The row must not exceed its container, the title must be the
    // only flexible segment, and the point scale must be collapsed behind a
    // single Estimate trigger.
    expect(row).toHaveClass("w-full", "min-w-0", "max-w-full");
    expect(screen.getByText(/A very long feature title/)).toHaveClass("min-w-0", "flex-1", "truncate");
    expect(screen.getByRole("button", { name: "Estimate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Estimate: 1 point/ })).not.toBeInTheDocument();
  });
});
