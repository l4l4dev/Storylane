import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewProjectInvitePicker } from "./new-project-invite-picker";
import type { NewProjectInviteResult } from "@/app/dashboard/actions";

const searchUserForNewProjectMock = vi.fn();
vi.mock("@/app/dashboard/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/dashboard/actions")>();
  return {
    ...actual,
    searchUserForNewProject: (...args: unknown[]) => searchUserForNewProjectMock(...args),
  };
});

describe("NewProjectInvitePicker", () => {
  beforeEach(() => {
    searchUserForNewProjectMock.mockReset();
  });

  // This component has no debounce (unlike InviteMemberForm) — it only
  // searches on Enter — so these tests use real timers throughout; fake
  // timers would fight `findByText`'s internal polling for no benefit here.
  it("does not search until Enter is pressed (no fuzzy dropdown for exact match)", () => {
    const onChange = vi.fn();
    render(<NewProjectInvitePicker selected={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Add member by exact username"), { target: { value: "jdoe" } });
    expect(searchUserForNewProjectMock).not.toHaveBeenCalled();
  });

  // NewProjectInvitePicker is a controlled component (the plan's own
  // Interfaces section: "InlineCreatePanel owns the `selected` state") —
  // it only ever renders chips from its `selected` prop. A plain vi.fn()
  // onChange records the call but never re-renders the tree, so the chip
  // this test expects to see would never appear. This tiny stateful
  // wrapper is what any real controlled-component consumer (InlineCreatePanel,
  // in Task 7) looks like, and lets the test assert both the DOM update
  // and the exact onChange payload via a spy.
  function ControlledPicker({ onChangeSpy }: { onChangeSpy: (users: NewProjectInviteResult[]) => void }) {
    const [selected, setSelected] = useState<NewProjectInviteResult[]>([]);
    return (
      <NewProjectInvitePicker
        selected={selected}
        onChange={(users) => {
          onChangeSpy(users);
          setSelected(users);
        }}
      />
    );
  }

  it("adds a matched user as a chip on Enter and clears the input", async () => {
    searchUserForNewProjectMock.mockResolvedValueOnce({
      id: "u1",
      username: "jdoe",
      displayName: "Jane Doe",
      avatarUrl: null,
    });
    const onChange = vi.fn();
    render(<ControlledPicker onChangeSpy={onChange} />);
    const input = screen.getByLabelText("Add member by exact username");
    fireEvent.change(input, { target: { value: "jdoe" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByText("Jane Doe");
    expect(onChange).toHaveBeenCalledWith([
      { id: "u1", username: "jdoe", displayName: "Jane Doe", avatarUrl: null },
    ]);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("shows a not-found message when no exact match exists", async () => {
    searchUserForNewProjectMock.mockResolvedValueOnce(null);
    render(<NewProjectInvitePicker selected={[]} onChange={vi.fn()} />);
    const input = screen.getByLabelText("Add member by exact username");
    fireEvent.change(input, { target: { value: "nobody" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/no user found/i)).toBeInTheDocument();
  });

  it("removing a chip calls onChange without that user", () => {
    const onChange = vi.fn();
    render(
      <NewProjectInvitePicker
        selected={[{ id: "u1", username: "jdoe", displayName: "Jane Doe", avatarUrl: null }]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Jane Doe" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
