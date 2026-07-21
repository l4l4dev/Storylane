import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Toaster } from "./toast";
import { dismissToast, getToasts, toast } from "@/lib/utils/toast-store";

describe("Toaster", () => {
  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("renders nothing when the store is empty", () => {
    render(<Toaster />);
    expect(screen.queryByText(/./)).not.toBeInTheDocument();
  });

  it("renders a toast queued via toast() and updates on subsequent calls", () => {
    render(<Toaster />);
    act(() => {
      toast("Project updated");
    });
    expect(screen.getByText("Project updated")).toBeInTheDocument();

    act(() => {
      toast("Second message");
    });
    expect(screen.getByText("Project updated")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("dismissing a toast removes only that one from the DOM", () => {
    render(<Toaster />);
    act(() => {
      toast("keep");
      toast("remove me");
    });
    const [, second] = getToasts();
    act(() => {
      dismissToast(second.id);
    });
    expect(screen.getByText("keep")).toBeInTheDocument();
    expect(screen.queryByText("remove me")).not.toBeInTheDocument();
  });
});
