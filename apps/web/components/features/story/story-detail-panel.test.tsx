import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryDetailPanel } from "./story-detail-panel";

// These tests stub routing/realtime (no App Router context or real Supabase
// client/env vars in this environment) and the `updateStory` action itself
// (Task 12 autosave) so each test controls exactly when/how a save resolves.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
let latestOnFieldsChanged: ((row: Record<string, unknown>) => void) | null = null;
vi.mock("@/lib/supabase/realtime", () => ({
  useStoryRealtime: (
    _storyId: string,
    onFieldsChanged: (row: Record<string, unknown>) => void,
  ) => {
    latestOnFieldsChanged = onFieldsChanged;
  },
}));
const updateStoryMock = vi.fn();
vi.mock("@/app/stories/[id]/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/stories/[id]/actions")>();
  return { ...actual, updateStory: (...args: unknown[]) => updateStoryMock(...args) };
});

const baseDetail: StoryDetail = {
  id: "s1",
  projectId: "p1",
  number: 42,
  title: "Add login",
  description: "Let users sign in",
  storyType: "feature",
  state: "unstarted",
  points: 3,
  epicId: null,
  assigneeId: null,
  labelIds: [],
  pointScale: [0, 1, 2, 3, 5, 8, 13],
  workflowMode: "tracker",
  customStatusId: null,
  customStatuses: [],
  epics: [],
  labels: [],
  members: [],
  comments: [],
  tasks: [],
  history: [],
};

describe("StoryDetailPanel", () => {
  it("renders the editable fields with their current values", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Add login");
    expect(screen.getByLabelText("Description")).toHaveValue("Let users sign in");
  });

  it("renders the next valid transition button instead of a free state select", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "State" })).not.toBeInTheDocument();
  });

  it("renders a chronological status/column history with actor and timestamp", () => {
    render(
      <StoryDetailPanel
        detail={{
          ...baseDetail,
          history: [
            {
              id: "h1",
              action: "story.state_changed",
              payload: { from: "unstarted", to: "started" },
              actorName: "Dev User",
              createdAt: "2026-07-17T09:00:00Z",
            },
            {
              id: "h2",
              action: "story.column_changed",
              payload: { from: "To do", to: "Doing" },
              actorName: "Dev User",
              createdAt: "2026-07-17T10:00:00Z",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText(/moved "Add login" from unstarted to started/)).toBeInTheDocument();
    expect(screen.getByText(/moved "Add login" from "To do" to "Doing"/)).toBeInTheDocument();
  });

  it("omits the History section when there is no history", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("renders the task checklist and comment thread sections", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Comments")).toBeInTheDocument();
  });

  it("renders a status select instead of transition buttons for free-mode projects", () => {
    const freeDetail: StoryDetail = {
      ...baseDetail,
      workflowMode: "free",
      customStatusId: "cs1",
      customStatuses: [
        { id: "cs1", name: "To do" },
        { id: "cs2", name: "Done" },
      ],
    };
    render(<StoryDetailPanel detail={freeDetail} />);
    expect(screen.getByLabelText("Status")).toHaveValue("cs1");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });
});

// Task 12 (spec/screens.md "Story detail editing — autosave" + "Conflict &
// failure rules"). No Save button exists any more (AC#1) — these exercise
// the debounce/blur/Esc/retry behavior that replaces it (AC#5).
describe("StoryDetailPanel autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateStoryMock.mockReset();
    updateStoryMock.mockResolvedValue({ ok: true, story: { ...baseDetail } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has no Save button", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("autosaves a text field ~800ms after the user stops typing", async () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Add SSO login" } });
    expect(updateStoryMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(updateStoryMock).toHaveBeenCalledTimes(1);
    expect(updateStoryMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Add SSO login" }));
    expect(screen.getByText("Saved ✓")).toBeInTheDocument();
  });

  it("flushes an edit on blur instead of waiting out the debounce", async () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Add SSO login" } });
    fireEvent.blur(title);

    await act(async () => {
      await Promise.resolve();
    });
    expect(updateStoryMock).toHaveBeenCalledTimes(1);
    expect(updateStoryMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Add SSO login" }));
  });

  it("Esc reverts the field to its last saved value without saving", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Something else entirely" } });
    fireEvent.keyDown(title, { key: "Escape" });

    expect(title).toHaveValue("Add login");
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it("ignores Escape while an IME composition is in progress", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "変換中" } });
    fireEvent.keyDown(title, { key: "Escape", isComposing: true });

    expect(title).toHaveValue("変換中");
  });

  it("on save failure, keeps the local value and shows an error with retry", async () => {
    updateStoryMock.mockResolvedValueOnce({ ok: false, reason: "error", message: "Network error" });
    render(<StoryDetailPanel detail={baseDetail} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Add SSO login" } });
    fireEvent.blur(title);

    await act(async () => {
      await Promise.resolve();
    });
    expect(title).toHaveValue("Add SSO login");
    expect(screen.getByText("Network error")).toBeInTheDocument();

    updateStoryMock.mockResolvedValueOnce({
      ok: true,
      story: { ...baseDetail, title: "Add SSO login" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(updateStoryMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved ✓")).toBeInTheDocument();
  });

  it("collapses edits made while a save is in flight into one trailing save", async () => {
    let resolveFirst!: (value: { ok: true; story: typeof baseDetail }) => void;
    updateStoryMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    render(<StoryDetailPanel detail={baseDetail} />);
    const title = screen.getByLabelText("Title");

    fireEvent.change(title, { target: { value: "First edit" } });
    fireEvent.blur(title);
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateStoryMock).toHaveBeenCalledTimes(1);

    // A second edit arrives while the first save is still in flight.
    fireEvent.change(title, { target: { value: "Second edit" } });
    fireEvent.blur(title);
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateStoryMock).toHaveBeenCalledTimes(1); // not fired again yet — queued as trailing

    updateStoryMock.mockResolvedValueOnce({ ok: true, story: { ...baseDetail, title: "Second edit" } });
    await act(async () => {
      resolveFirst({ ok: true, story: { ...baseDetail, title: "First edit" } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateStoryMock).toHaveBeenCalledTimes(2);
    expect(updateStoryMock).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Second edit" }));
  });

  it("switches to the deleted-story state when the save reports not_found, keeping the unsaved text", async () => {
    updateStoryMock.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    render(<StoryDetailPanel detail={baseDetail} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Orphaned edit" } });
    fireEvent.blur(title);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/story was deleted/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Orphaned edit");
  });

  it("does not autosave a discrete field change without needing a blur", async () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "chore" } });

    await act(async () => {
      await Promise.resolve();
    });
    expect(updateStoryMock).toHaveBeenCalledWith(expect.objectContaining({ storyType: "chore" }));
  });

  // AC#4: a Realtime update must not clobber a field the user is actively
  // editing (locked = focused or dirty), but should apply immediately to
  // any other, unlocked field.
  it("ignores a Realtime update for a field the user is actively editing, but applies it to an unlocked field", () => {
    render(<StoryDetailPanel detail={baseDetail} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "My in-progress edit" } });

    act(() => {
      latestOnFieldsChanged?.({
        title: "Someone else's title",
        description: "Someone else's description",
        story_type: "bug",
        points: 8,
        epic_id: null,
        assignee_id: null,
        custom_status_id: null,
      });
    });

    // Locked (dirty): the in-progress title edit is preserved.
    expect(title).toHaveValue("My in-progress edit");
    // Unlocked: description picked up the remote value immediately.
    expect(screen.getByLabelText("Description")).toHaveValue("Someone else's description");
  });
});
