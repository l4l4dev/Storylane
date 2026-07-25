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

const baseStory: StoryCardData & {
  state_id: string | null;
  parentId: string | null;
  parentEpicTitle: string | null;
  parentEpicColor: string | null;
} = {
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
  parentId: null,
  parentEpicTitle: null,
  parentEpicColor: null,
};

describe("StoryListRow", () => {
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
    expect(screen.getByText("Unstarted")).toHaveAttribute("data-slot", "badge");
  });

  it("shows no state badge for an Icebox row (state_id null)", () => {
    render(
      <StoryListRow story={{ ...baseStory, state_id: null }} projectId="p1" states={CLASSIC_STATES} pointScale={fibonacci} />,
    );
    expect(screen.queryByText("Icebox")).not.toBeInTheDocument();
  });

  it("truncates a long custom state name without widening the row", () => {
    const states = CLASSIC_STATES.map((state) =>
      state.id === "Unstarted"
        ? { ...state, name: "Ready for a very long cross-team verification phase" }
        : state,
    );
    render(<StoryListRow story={baseStory} projectId="p1" states={states} pointScale={fibonacci} />);

    expect(screen.getByTitle("Ready for a very long cross-team verification phase")).toHaveClass(
      "max-w-24",
      "truncate",
      "sm:max-w-32",
    );
  });

  // doc-20 §4: line 2 (points/labels/epic) never hides behind a width
  // breakpoint anymore — the two-line layout gives it room, so a viewer no
  // longer loses metadata just because the panel is narrow.
  it("lets the title shrink on line 1 and always shows points/labels on line 2", () => {
    render(
      <StoryListRow
        story={{
          ...baseStory,
          labels: [{ id: "l1", name: "Urgent", color: "#ef4444" }],
        }}
        projectId="p1"
        states={CLASSIC_STATES}
        pointScale={fibonacci}
      />,
    );

    expect(screen.getByRole("button", { name: /Add login/ })).toHaveClass("min-w-0");
    expect(screen.getByText("Add login")).toHaveClass("min-w-0", "flex-1");
    expect(screen.getByText("•••")).not.toHaveClass("hidden");
    expect(screen.getByText("•••")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByLabelText("3 points")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).not.toHaveClass("hidden");
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

  // ux-principles principle 8: a child still renders in its own zone (the
  // Epics band shows a separate, lighter mirror row, doc-20 §3) — this badge
  // is how its epic membership stays visible without teleporting the user
  // out of the zone they're working in. Never hidden by width (doc-20 §4,
  // AC#3) — no more `hidden`/`sm:` classes on it.
  it("shows a link back to the parent epic when the story has one, never hidden by width", () => {
    render(
      <StoryListRow
        story={{ ...baseStory, parentId: "e1", parentEpicTitle: "Big epic", parentEpicColor: "#ff0000" }}
        projectId="p1"
        states={CLASSIC_STATES}
        pointScale={fibonacci}
      />,
    );
    const link = screen.getByRole("link", { name: "Big epic" });
    expect(link).toHaveAttribute("href", "/stories/e1");
    expect(link).not.toHaveClass("hidden");
  });

  // doc-20 §4: a left rule in the epic's colour so a run of siblings reads
  // as one group while scrolling.
  it("shows a left rule in the epic's colour when the story belongs to one", () => {
    render(
      <StoryListRow
        story={{ ...baseStory, parentId: "e1", parentEpicTitle: "Big epic", parentEpicColor: "#ff0000" }}
        projectId="p1"
        states={CLASSIC_STATES}
        pointScale={fibonacci}
      />,
    );
    const row = screen.getByTestId("story-list-row");
    expect(row).toHaveClass("border-l-2");
    expect(row.style.borderLeftColor).toBe("rgb(255, 0, 0)");
  });

  it("falls back to the default epic colour for the rule when epic_color is null", () => {
    render(
      <StoryListRow
        story={{ ...baseStory, parentId: "e1", parentEpicTitle: "Big epic", parentEpicColor: null }}
        projectId="p1"
        states={CLASSIC_STATES}
        pointScale={fibonacci}
      />,
    );
    expect(screen.getByTestId("story-list-row").style.borderLeftColor).toBe("rgb(99, 102, 241)");
  });

  it("omits the epic link and left rule for a story with no parent", () => {
    render(<StoryListRow story={baseStory} projectId="p1" states={CLASSIC_STATES} pointScale={fibonacci} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const row = screen.getByTestId("story-list-row");
    expect(row).not.toHaveClass("border-l-2");
    expect(row.style.borderLeftColor).toBe("");
  });
});
