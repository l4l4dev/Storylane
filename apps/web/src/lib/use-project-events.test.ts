import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectEvents } from "./use-project-events";

/** Minimal stand-in for the browser's EventSource, driven by `dispatch` in the tests. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Set<(event: Event) => void>>();
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

describe("useProjectEvents", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls onChange when the server sends project.changed", () => {
    const onChange = vi.fn();
    renderHook(() => useProjectEvents("p1", onChange));
    const [source] = FakeEventSource.instances;
    source!.dispatch("project.changed");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("removes the listener and closes the source on unmount", () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useProjectEvents("p1", onChange));
    const [source] = FakeEventSource.instances;
    unmount();
    expect(source!.closed).toBe(true);
    source!.dispatch("project.changed");
    expect(onChange).not.toHaveBeenCalled();
  });
});
