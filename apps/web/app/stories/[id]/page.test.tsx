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
  epicId: null,
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  epics: [],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
  history: [],
};

describe("StoryDetailPage", () => {
  it("links back to the project's Board for a non-personal project", async () => {
    getStoryDetailMock.mockResolvedValueOnce(baseDetail);

    render(await StoryDetailPage({ params: Promise.resolve({ id: "s1" }) }));

    const link = screen.getByRole("link", { name: "← Board" });
    expect(link).toHaveAttribute("href", "/projects/p1/board");
  });

  it("links back to My Work for a personal project", async () => {
    getStoryDetailMock.mockResolvedValueOnce({ ...baseDetail, isPersonalProject: true });

    render(await StoryDetailPage({ params: Promise.resolve({ id: "s1" }) }));

    const link = screen.getByRole("link", { name: "← My Work" });
    expect(link).toHaveAttribute("href", "/my-work");
  });
});
