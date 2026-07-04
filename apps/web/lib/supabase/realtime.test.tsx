import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectStoriesRealtime, useStoryRealtime } from "./realtime";

const onFn = vi.fn().mockReturnThis();
const subscribeFn = vi.fn().mockReturnValue({ channel: true });
const channelFn = vi.fn().mockReturnValue({ on: onFn, subscribe: subscribeFn });
const removeChannelFn = vi.fn();
const getSessionFn = vi.fn().mockResolvedValue({ data: { session: { access_token: "t" } } });

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionFn },
    channel: channelFn,
    removeChannel: removeChannelFn,
  }),
}));

// The hook only opens a channel after `auth.getSession()` resolves (a real
// session must be loaded before subscribing, or Realtime silently drops rows
// under RLS) — flush that microtask before asserting.
async function flushSessionCheck() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useProjectStoriesRealtime", () => {
  it("subscribes to stories filtered by project_id and cleans up on unmount", async () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useProjectStoriesRealtime("proj-1", onChange));
    await flushSessionCheck();

    expect(channelFn).toHaveBeenCalledWith("stories-project-proj-1");
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "stories", filter: "project_id=eq.proj-1" },
      expect.any(Function),
    );
    expect(subscribeFn).toHaveBeenCalled();

    unmount();
    expect(removeChannelFn).toHaveBeenCalled();
  });

  it("debounces bursts of changes into a single onChange call", async () => {
    const onChange = vi.fn();
    renderHook(() => useProjectStoriesRealtime("proj-1", onChange));
    await flushSessionCheck();
    vi.useFakeTimers();

    const handler = onFn.mock.calls[0][2] as () => void;
    handler();
    handler();
    handler();
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("useStoryRealtime", () => {
  it("subscribes to both the story row and its comments on one channel", async () => {
    const onChange = vi.fn();
    renderHook(() => useStoryRealtime("story-1", onChange));
    await flushSessionCheck();

    expect(channelFn).toHaveBeenCalledWith("story-detail-story-1");
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "stories", filter: "id=eq.story-1" },
      expect.any(Function),
    );
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "comments", filter: "story_id=eq.story-1" },
      expect.any(Function),
    );
  });
});
