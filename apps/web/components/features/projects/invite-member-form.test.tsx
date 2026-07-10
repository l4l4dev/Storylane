import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteMemberForm } from "./invite-member-form";

// TASK-6 AC #5: covers the search-debounce, selecting a result, and
// submitting the invite. The RPC-backed actions are stubbed — their own
// correctness (2-char minimum, cap, exclusion) is covered by
// lib/utils/invite-search.integration.test.ts.
const searchUsersForInviteMock = vi.fn();
const inviteMemberMock = vi.fn();
vi.mock("@/app/projects/[id]/settings/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/projects/[id]/settings/actions")>();
  return {
    ...actual,
    searchUsersForInvite: (...args: unknown[]) => searchUsersForInviteMock(...args),
    inviteMember: (...args: unknown[]) => inviteMemberMock(...args),
  };
});

describe("InviteMemberForm", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchUsersForInviteMock.mockReset();
    inviteMemberMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not search until the query reaches 2 characters", async () => {
    render(<InviteMemberForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("Search users to invite"), { target: { value: "a" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(searchUsersForInviteMock).not.toHaveBeenCalled();
  });

  it("searches (debounced) and lists results once the query is long enough", async () => {
    searchUsersForInviteMock.mockResolvedValueOnce([
      { id: "u1", username: "jdoe", displayName: "Jane Doe", avatarUrl: null },
    ]);
    render(<InviteMemberForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("Search users to invite"), { target: { value: "jane" } });

    expect(searchUsersForInviteMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(searchUsersForInviteMock).toHaveBeenCalledWith("p1", "jane");
    expect(screen.getByRole("button", { name: "Jane Doe @jdoe" })).toBeInTheDocument();
  });

  it("selecting a result replaces the search box with a chip and enables Invite", async () => {
    searchUsersForInviteMock.mockResolvedValueOnce([
      { id: "u1", username: "jdoe", displayName: "Jane Doe", avatarUrl: null },
    ]);
    render(<InviteMemberForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("Search users to invite"), { target: { value: "jane" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Jane Doe @jdoe" }));

    expect(screen.queryByLabelText("Search users to invite")).not.toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("@jdoe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeEnabled();
  });

  it("removing the selected chip brings back the search box", async () => {
    searchUsersForInviteMock.mockResolvedValueOnce([
      { id: "u1", username: "jdoe", displayName: "Jane Doe", avatarUrl: null },
    ]);
    render(<InviteMemberForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("Search users to invite"), { target: { value: "jane" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole("button", { name: "Jane Doe @jdoe" }));

    fireEvent.click(screen.getByRole("button", { name: "Remove Jane Doe" }));

    expect(screen.getByLabelText("Search users to invite")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
  });
});
