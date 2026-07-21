import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOptimisticBoardOrder } from "./use-optimistic-board-order";

type Item = { id: string };

function deferred<Reason = void>() {
  let resolve!: () => void;
  let reject!: (reason: Reason) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(serverContainers: Record<string, Item[]>) {
  return renderHook((sc: Record<string, Item[]>) => useOptimisticBoardOrder(sc), {
    initialProps: serverContainers,
  });
}

describe("useOptimisticBoardOrder", () => {
  // TASK-113 finding #5: a realtime router.refresh() lands as a new server
  // value; while a drag is active it must be deferred, not reconciled (which
  // would pull dnd-kit's dragged node out from under it).
  it("defers reconcile while a drag is active, then applies it once the drag ends", () => {
    const v1 = { a: [{ id: "1" }] };
    const { result, rerender } = setup(v1);

    act(() => result.current.beginDrag("1"));
    const v2 = { a: [{ id: "1" }, { id: "2" }] };
    rerender(v2);

    expect(result.current.containers).toEqual(v1); // deferred, not reconciled

    act(() => result.current.endDrag());
    expect(result.current.containers).toEqual(v2); // reconciles after the drag
  });

  // TASK-113 finding #5 (second half): the render right after a drag ends must
  // NOT reconcile to a stale server value while this client's own drop is
  // still saving (isPending), or the just-made move visibly disappears.
  it("keeps the optimistic move while a drop is in flight, ignoring a stale server value", async () => {
    const { result, rerender } = setup({ a: [{ id: "1" }], b: [] as Item[] });

    act(() => result.current.beginDrag("1"));
    act(() => result.current.setContainers({ a: [], b: [{ id: "1" }] })); // optimistic move a→b

    const drop = deferred();
    act(() => {
      result.current.endDrag();
      result.current.runDrop("1", () => drop.promise, vi.fn());
    });

    // A co-user's refresh arrives mid-save; it lacks this client's move.
    rerender({ a: [{ id: "1" }], b: [] });
    expect(result.current.containers).toEqual({ a: [], b: [{ id: "1" }] }); // move survives

    await act(async () => {
      drop.resolve();
      await drop.promise;
    });
  });

  // The advisor's explicit worry: overlapping startTransition calls must keep
  // isPending true throughout, so a second drag started while the first is
  // still saving doesn't open a reconcile window.
  it("stays gated while two drops overlap, reconciling only after both settle", async () => {
    const { result, rerender } = setup({ a: [{ id: "1" }, { id: "2" }] });

    const dropA = deferred();
    act(() => result.current.runDrop("1", () => dropA.promise, vi.fn()));
    const dropB = deferred();
    act(() => result.current.runDrop("2", () => dropB.promise, vi.fn()));

    rerender({ a: [{ id: "9" }] });
    expect(result.current.containers).toEqual({ a: [{ id: "1" }, { id: "2" }] }); // gated

    await act(async () => {
      dropA.resolve();
      await dropA.promise;
    });
    rerender({ a: [{ id: "9" }] });
    expect(result.current.containers).toEqual({ a: [{ id: "1" }, { id: "2" }] }); // still gated (B pending)

    await act(async () => {
      dropB.resolve();
      await dropB.promise;
    });
    rerender({ a: [{ id: "9" }] });
    expect(result.current.containers).toEqual({ a: [{ id: "9" }] }); // both settled → reconciles
  });

  // TASK-113 finding #4: an async rejection reverts only the dragged item to
  // its pre-drag slot, leaving a sibling's already-applied move intact, and
  // surfaces the error message to the caller.
  it("runDrop reverts only the dragged item on failure, preserving a sibling's move", async () => {
    const { result } = setup({ a: [{ id: "x" }, { id: "y" }], b: [{ id: "z" }] });
    const onError = vi.fn();

    act(() => result.current.beginDrag("x")); // snapshot = pre-drag board
    // x optimistically moved a→b; meanwhile a sibling reordered b.
    act(() => result.current.setContainers({ a: [{ id: "y" }], b: [{ id: "z-moved" }, { id: "x" }] }));

    await act(async () => {
      result.current.endDrag();
      result.current.runDrop("x", () => Promise.reject(new Error("stale")), onError);
      await Promise.resolve();
    });

    expect(result.current.containers.a.map((i) => i.id)).toEqual(["x", "y"]); // x back
    expect(result.current.containers.b.map((i) => i.id)).toEqual(["z-moved"]); // sibling kept
    expect(onError).toHaveBeenCalledWith("stale");
  });

  // A late rejection from drag A must revert against A's own snapshot, even
  // after drag B started (which overwrote the shared pre-drag ref). runDrop
  // captures the snapshot synchronously at drop time, so a stale ref read in
  // the async catch can't revert wrongly.
  it("each overlapping drop reverts against its own captured snapshot", async () => {
    const { result } = setup({ a: [{ id: "x" }], b: [{ id: "y" }] });

    const dropA = deferred();
    act(() => result.current.beginDrag("x"));
    act(() => result.current.setContainers({ a: [], b: [{ id: "y" }, { id: "x" }] })); // x moved a→b
    act(() => {
      result.current.endDrag();
      result.current.runDrop("x", () => dropA.promise, vi.fn()); // captures A's snapshot now
    });

    // Drag B begins before A's rejection lands, overwriting the shared ref.
    act(() => result.current.beginDrag("y"));

    await act(async () => {
      dropA.reject();
      await dropA.promise.catch(() => {});
    });

    expect(result.current.containers.a.map((i) => i.id)).toEqual(["x"]); // x correctly back in a
    expect(result.current.containers.b.map((i) => i.id)).toEqual(["y"]);
  });

  it("revertToSnapshot restores the whole pre-drag board", () => {
    const original = { a: [{ id: "x" }], b: [] as Item[] };
    const { result } = setup(original);

    act(() => result.current.beginDrag("x"));
    act(() => result.current.setContainers({ a: [], b: [{ id: "x" }] }));

    act(() => result.current.revertToSnapshot());
    expect(result.current.containers).toEqual(original);
  });
});
