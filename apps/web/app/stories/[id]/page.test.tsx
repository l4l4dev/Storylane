import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "./actions";
import StoryDetailPage from "./page";

// TASK-129: the personal (My Tasks) project has no reachable Board nav, so
// its story detail page's back-link must route to /my-work instead — this
// stubs getStoryDetail directly rather than the underlying Supabase client,
// following story-detail-panel.test.tsx's precedent for StoryDetail-shaped
// fixtures.
const getStoryDetailMock = vi.fn();
vi.mock("./actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions")>();
  return { ...actual, getStoryDetail: (...args: unknown[]) => getStoryDetailMock(...args) };
});

// StoryDetailPanel and StoryPeekMenu (both rendered by the page) need these
// stubbed — no App Router context or realtime channel in this environment.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/stories/s1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/realtime", () => ({
  useStoryRealtime: () => {},
}));

const baseDetail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  isPersonalProject: false,
  number: 42,
  title: "Add login",
  description: null,
  storyType: "feature",
  stateId: null,
  states: [],
  points: null,
  doneDefinition: null,
  parentId: null,
  isContainer: false,
  childCount: 0,
  epicColor: null,
  children: [],
  childRollup: { headline: "icebox", points: 0, breakdown: { unstarted: 0, in_progress: 0, done: 0, rejected: 0, icebox: 0 } },
  addChildCandidates: [],
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
  history: [],
  parentCandidates: [],
  viewerIsMember: true,
};

describe("StoryDetailPage", () => {
  it("links back to the project's Board for a non-personal project", async () => {
    getStoryDetailMock.mockResolvedValueOnce(baseDetail);

    render(await StoryDetailPage({ params: Promise.resolve({ id: "s1" }), searchParams: Promise.resolve({}) }));

    const link = screen.getByRole("link", { name: "← Board" });
    expect(link).toHaveAttribute("href", "/projects/p1/board");
  });

  it("links back to My Work for a personal project", async () => {
    getStoryDetailMock.mockResolvedValueOnce({ ...baseDetail, isPersonalProject: true });

    render(await StoryDetailPage({ params: Promise.resolve({ id: "s1" }), searchParams: Promise.resolve({}) }));

    const link = screen.getByRole("link", { name: "← My Work" });
    expect(link).toHaveAttribute("href", "/my-work");
  });

  // /code-review: a container's "Child stories" row opens its target via
  // ?story=<id> (the same useOpenPeek every other surface uses) — without a
  // StoryPeekHost reading that param here, the click was a dead no-op.
  it("opens a StoryPeek when ?story=<id> is present", async () => {
    getStoryDetailMock.mockResolvedValueOnce(baseDetail);
    getStoryDetailMock.mockResolvedValueOnce({ ...baseDetail, id: "s2", number: 7, title: "Child story" });

    render(
      await StoryDetailPage({
        params: Promise.resolve({ id: "s1" }),
        searchParams: Promise.resolve({ story: "s2" }),
      }),
    );

    expect(getStoryDetailMock).toHaveBeenCalledWith("s2");
    expect(screen.getByRole("heading", { name: /Child story/ })).toBeInTheDocument();
  });
});
