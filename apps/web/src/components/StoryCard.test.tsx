import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoryCard, type StoryView } from "./StoryCard";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const states = [
  { id: "todo", category: "unstarted" as const, actionLabel: "Start", position: 0 },
  { id: "doing", category: "in_progress" as const, actionLabel: "Finish", position: 1 },
];

const feature = (overrides: Partial<StoryView> = {}): StoryView => ({
  id: "s1",
  number: 1,
  title: "A story",
  storyType: "feature",
  stateId: "todo",
  points: null,
  completedAt: null,
  ...overrides,
});

describe("StoryCard estimate control", () => {
  it("shows point buttons instead of Start for an unestimated feature blocked by the gate", () => {
    render(
      <StoryCard
        projectId="p1"
        story={feature()}
        states={states}
        scaleValues={[0, 1, 2, 3, 5, 8]}
        canWrite
        onAdvance={vi.fn()}
        onEstimated={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^start$/i })).not.toBeInTheDocument();
    for (const points of [0, 1, 2, 3, 5, 8]) {
      expect(screen.getByRole("button", { name: String(points) })).toBeInTheDocument();
    }
  });

  it("PATCHes the chosen points and calls onEstimated", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "s1", points: 3 }));
    const onEstimated = vi.fn();
    render(
      <StoryCard
        projectId="p1"
        story={feature()}
        states={states}
        scaleValues={[0, 1, 2, 3, 5, 8]}
        canWrite
        onAdvance={vi.fn()}
        onEstimated={onEstimated}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "3" }));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/p1/stories/s1",
      expect.objectContaining({ method: "PATCH" }),
    );
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ points: 3 });
    expect(onEstimated).toHaveBeenCalledTimes(1);
  });

  it("shows Start (not point buttons) once the feature is estimated", () => {
    render(
      <StoryCard
        projectId="p1"
        story={feature({ points: 3 })}
        states={states}
        scaleValues={[0, 1, 2, 3, 5, 8]}
        canWrite
        onAdvance={vi.fn()}
        onEstimated={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^start$/i })).toBeInTheDocument();
  });

  it("never shows a points control for a non-feature story", () => {
    render(
      <StoryCard
        projectId="p1"
        story={feature({ storyType: "chore", points: null })}
        states={states}
        scaleValues={[0, 1, 2, 3, 5, 8]}
        canWrite
        onAdvance={vi.fn()}
        onEstimated={vi.fn()}
      />,
    );
    expect(screen.queryByRole("group", { name: /points/i })).not.toBeInTheDocument();
  });

  it("renders no control at all for a viewer", () => {
    render(
      <StoryCard
        projectId="p1"
        story={feature({ points: 3 })}
        states={states}
        scaleValues={[0, 1, 2, 3, 5, 8]}
        canWrite={false}
        onAdvance={vi.fn()}
        onEstimated={vi.fn()}
      />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // The estimate is still shown — as text, not as a control that would 403.
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
