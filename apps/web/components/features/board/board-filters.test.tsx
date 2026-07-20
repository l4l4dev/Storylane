import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardFilters } from "./board-filters";

const { replaceMock, searchParamsMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  searchParamsMock: vi.fn<() => URLSearchParams>(() => new URLSearchParams()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/projects/p1/board",
  useSearchParams: () => searchParamsMock(),
}));

const assignees = [{ id: "u1", name: "Alice" }];
const labels = [{ id: "l1", name: "urgent" }];
const epics = [{ id: "e1", name: "Checkout revamp" }];

// TASK-45 follow-up (owner feedback 2026-07-13): three always-visible
// filter selects crowded the control row alongside the view switcher,
// Icebox toggle, and Finish iteration. Collapsed into one "Filters"
// trigger with a count badge.
describe("BoardFilters", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    searchParamsMock.mockReturnValue(new URLSearchParams());
  });

  it("shows no count badge and keeps the selects hidden until opened", () => {
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveTextContent("Filters");
    expect(screen.queryByRole("combobox", { name: "Filter by type" })).not.toBeInTheDocument();
  });

  it("opens on click and shows all four filters", async () => {
    const user = userEvent.setup();
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    expect(screen.getByRole("combobox", { name: "Filter by type" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by assignee" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by label" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by epic" })).toBeInTheDocument();
  });

  // TASK-41: board toolbar can filter stories by epic (AC #2).
  it("updates the URL when the epic filter changes", async () => {
    const user = userEvent.setup();
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);
    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    const epicSelect = screen.getByRole("combobox", { name: "Filter by epic" });
    expect(screen.getByRole("option", { name: "Checkout revamp" })).toBeInTheDocument();
    fireEvent.change(epicSelect, { target: { value: "e1" } });

    expect(replaceMock).toHaveBeenCalledWith("/projects/p1/board?epic=e1");
  });

  it("shows a count badge reflecting how many filters are active", () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("type=feature&assignee=u1"));
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveTextContent("· 2");
  });

  it("updates the URL when a filter changes, without closing the popover", async () => {
    const user = userEvent.setup();
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);
    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    const typeSelect = screen.getByRole("combobox", { name: "Filter by type" });
    fireEvent.change(typeSelect, { target: { value: "feature" } });

    expect(replaceMock).toHaveBeenCalledWith("/projects/p1/board?type=feature");
    // Still open — the select's own change must not dismiss the dropdown.
    expect(screen.getByRole("combobox", { name: "Filter by assignee" })).toBeInTheDocument();
  });

  it("clears the URL param when a filter is reset to 'All'", async () => {
    searchParamsMock.mockReturnValue(new URLSearchParams("type=feature"));
    const user = userEvent.setup();
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);
    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    const typeSelect = screen.getByRole("combobox", { name: "Filter by type" });
    fireEvent.change(typeSelect, { target: { value: "" } });

    expect(replaceMock).toHaveBeenCalledWith("/projects/p1/board");
  });

  it("clears all filters while preserving unrelated query params", async () => {
    searchParamsMock.mockReturnValue(
      new URLSearchParams("type=feature&assignee=u1&label=l1&epic=e1&story=s1"),
    );
    const user = userEvent.setup();
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(replaceMock).toHaveBeenCalledWith("/projects/p1/board?story=s1");
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveFocus();
  });

  it("does not show Clear all when no filters are active", async () => {
    const user = userEvent.setup();
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);

    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  // fable-advisor review: Radix DropdownMenu's Content unconditionally
  // preventDefaults the Tab key (built for arrow-key menuitem navigation,
  // not tabbing through form controls), which would have made Assignee and
  // Label unreachable by keyboard from Type. Popover (this component's
  // primitive since that review) has no such interception.
  it("lets a keyboard user Tab from Type through Assignee, Label, and Epic", async () => {
    const user = userEvent.setup();
    render(<BoardFilters assignees={assignees} labels={labels} epics={epics} />);
    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    const typeSelect = screen.getByRole("combobox", { name: "Filter by type" });
    typeSelect.focus();
    expect(typeSelect).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("combobox", { name: "Filter by assignee" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("combobox", { name: "Filter by label" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("combobox", { name: "Filter by epic" })).toHaveFocus();
  });
});
