import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts, subscribeToasts, toast } from "./toast-store";

describe("toast store", () => {
  beforeEach(() => {
    // Drain any toasts left by a previous test.
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("queues a toast and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);

    toast("Project updated");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getToasts()).toEqual([{ id: expect.any(Number), message: "Project updated" }]);
    unsubscribe();
  });

  it("assigns increasing ids so multiple toasts render distinctly", () => {
    toast("first");
    toast("second");
    const [a, b] = getToasts();
    expect(a.message).toBe("first");
    expect(b.message).toBe("second");
    expect(b.id).toBeGreaterThan(a.id);
  });

  it("dismissToast removes only the targeted toast and notifies", () => {
    toast("keep");
    toast("remove me");
    const [, second] = getToasts();
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);

    dismissToast(second.id);

    expect(getToasts().map((t) => t.message)).toEqual(["keep"]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("unsubscribe stops further notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);
    unsubscribe();

    toast("after unsubscribe");

    expect(listener).not.toHaveBeenCalled();
  });
});
