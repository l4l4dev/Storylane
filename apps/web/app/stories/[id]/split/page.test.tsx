import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "../actions";
import SplitStudioPage from "./page";

// Split only applies to a normal, top-level, non-personal story (doc-18 §3/§7,
// owner decision on personal projects) — stubs getStoryDetail directly,
// following page.test.tsx's precedent for StoryDetail-shaped fixtures.
const getStoryDetailMock = vi.fn();
vi.mock("../actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../actions")>();
  return { ...actual, getStoryDetail: (...args: unknown[]) => getStoryDetailMock(...args) };
});

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn() }),
}));

const baseDetail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  isPersonalProject: false,
  number: 42,
  title: "Big feature",
  description: "Some description",
  storyType: "feature",
  stateId: null,
  states: [],
  points: 8,
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
  tasks: [{ id: "t1", title: "A task", is_done: false }],
  history: [],
  parentCandidates: [],
};

async function renderPage(detail: StoryDetail | null) {
  getStoryDetailMock.mockResolvedValueOnce(detail);
  try {
    render(await SplitStudioPage({ params: Promise.resolve({ id: "s1" }) }));
    return true;
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_NOT_FOUND") {
      return false;
    }
    throw err;
  }
}

describe("SplitStudioPage", () => {
  it("renders the Split Studio for a normal top-level story", async () => {
    const rendered = await renderPage(baseDetail);
    expect(rendered).toBe(true);
    expect(screen.getByText("Big feature")).toBeInTheDocument();
    expect(screen.getByText("A task")).toBeInTheDocument();
  });

  it("404s for a story that does not exist", async () => {
    expect(await renderPage(null)).toBe(false);
  });

  it("404s for a container (already split, has no board state to split from)", async () => {
    expect(await renderPage({ ...baseDetail, isContainer: true })).toBe(false);
  });

  it("404s for a child story (single-level nesting, doc-18 §3)", async () => {
    expect(await renderPage({ ...baseDetail, parentId: "parent-1" })).toBe(false);
  });

  it("404s for a personal-project story (owner decision — splitting would vanish it from My Work)", async () => {
    expect(await renderPage({ ...baseDetail, isPersonalProject: true })).toBe(false);
  });
});
