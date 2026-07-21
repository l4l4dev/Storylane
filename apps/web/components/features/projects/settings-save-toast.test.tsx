import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsSaveToast } from "./settings-save-toast";
import { dismissToast, getToasts } from "@/lib/utils/toast-store";

const { replaceMock, searchParamsMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  searchParamsMock: vi.fn<() => URLSearchParams>(() => new URLSearchParams()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/projects/p1/settings",
  useSearchParams: () => searchParamsMock(),
}));

describe("SettingsSaveToast", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    searchParamsMock.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("does nothing when ?updated is absent", () => {
    render(<SettingsSaveToast />);
    expect(getToasts()).toEqual([]);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("fires a plain success toast and strips the param for a bare ?updated=1", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("updated=1"));
    render(<SettingsSaveToast />);
    expect(getToasts().map((t) => t.message)).toEqual(["Project updated"]);
    expect(replaceMock).toHaveBeenCalledWith("/projects/p1/settings", { scroll: false });
  });

  // TASK-105 follow-up: surface why the "apply to current" checkbox had no
  // effect, instead of a generic "Project updated" that reads as a no-op.
  it("fires the already_finished reshape message", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("updated=1&reshape_note=already_finished"));
    render(<SettingsSaveToast />);
    expect(getToasts()[0]?.message).toBe(
      "Project updated — the current iteration had already finished, so its length wasn't changed.",
    );
  });

  it("fires the would_end_in_past reshape message", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("updated=1&reshape_note=would_end_in_past"));
    render(<SettingsSaveToast />);
    expect(getToasts()[0]?.message).toBe(
      "Project updated — the current iteration wasn't reshaped (it would have ended in the past).",
    );
  });

  it("fires the too_long reshape message", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("updated=1&reshape_note=too_long"));
    render(<SettingsSaveToast />);
    expect(getToasts()[0]?.message).toBe(
      "Project updated — the current iteration wasn't reshaped (the new length would run longer than 90 days).",
    );
  });
});
