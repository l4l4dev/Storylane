import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectBoardRealtime, useStoryRealtime } from "./realtime";

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

describe("useProjectBoardRealtime", () => {
  it("subscribes to stories and dividers filtered by project_id and cleans up on unmount", async () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useProjectBoardRealtime("proj-1", onChange));
    await flushSessionCheck();

    expect(channelFn).toHaveBeenCalledWith("board-project-proj-1");
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "stories", filter: "project_id=eq.proj-1" },
      expect.any(Function),
    );
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "backlog_dividers", filter: "project_id=eq.proj-1" },
      expect.any(Function),
    );
    expect(subscribeFn).toHaveBeenCalled();

    unmount();
    expect(removeChannelFn).toHaveBeenCalled();
  });

  it("debounces bursts of changes into a single onChange call", async () => {
    const onChange = vi.fn();
    renderHook(() => useProjectBoardRealtime("proj-1", onChange));
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
  it("subscribes to the story row's UPDATE/DELETE and the comments thread on one channel", async () => {
    const onFieldsChanged = vi.fn();
    const onDeleted = vi.fn();
    const onCommentsChanged = vi.fn();
    renderHook(() => useStoryRealtime("story-1", onFieldsChanged, onDeleted, onCommentsChanged));
    await flushSessionCheck();

    expect(channelFn).toHaveBeenCalledWith("story-detail-story-1");
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "stories", filter: "id=eq.story-1" },
      expect.any(Function),
    );
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "stories", filter: "id=eq.story-1" },
      expect.any(Function),
    );
    expect(onFn).toHaveBeenCalledWith(
      "postgres_changes",
      { event: "*", schema: "public", table: "comments", filter: "story_id=eq.story-1" },
      expect.any(Function),
    );
  });

  it("debounces a burst of UPDATE payloads into one merge call carrying the latest row", async () => {
    const onFieldsChanged = vi.fn();
    renderHook(() => useStoryRealtime("story-1", onFieldsChanged, vi.fn(), vi.fn()));
    await flushSessionCheck();
    vi.useFakeTimers();

    const updateHandler = onFn.mock.calls.find(
      (call) => call[1].event === "UPDATE",
    )?.[2] as (payload: { new: { title: string } }) => void;
    updateHandler({ new: { title: "first" } });
    updateHandler({ new: { title: "second" } });
    expect(onFieldsChanged).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);
    expect(onFieldsChanged).toHaveBeenCalledTimes(1);
    expect(onFieldsChanged).toHaveBeenCalledWith({ title: "second" });
  });

  it("fires onDeleted immediately (not debounced) on a DELETE event", async () => {
    const onDeleted = vi.fn();
    renderHook(() => useStoryRealtime("story-1", vi.fn(), onDeleted, vi.fn()));
    await flushSessionCheck();

    const deleteHandler = onFn.mock.calls.find((call) => call[1].event === "DELETE")?.[2] as () => void;
    deleteHandler();
    expect(onDeleted).toHaveBeenCalledTimes(1);
  });
});
