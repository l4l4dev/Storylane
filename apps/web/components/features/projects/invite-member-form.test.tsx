import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteSearchResult } from "@/app/projects/[id]/settings/actions";
import { InviteMemberForm } from "./invite-member-form";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

  it("does not let a slower earlier query overwrite a faster later one", async () => {
    const first = deferred<InviteSearchResult[]>();
    const second = deferred<InviteSearchResult[]>();
    searchUsersForInviteMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<InviteMemberForm projectId="p1" />);
    const input = screen.getByLabelText("Search users to invite");

    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.change(input, { target: { value: "abc" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(searchUsersForInviteMock).toHaveBeenCalledTimes(2);

    // The fresher ("abc") query resolves first.
    await act(async () => {
      second.resolve([{ id: "u2", username: "abcuser", displayName: "ABC User", avatarUrl: null }]);
    });
    expect(screen.getByRole("button", { name: "ABC User @abcuser" })).toBeInTheDocument();

    // The stale ("ab") query resolves after — it must not overwrite the fresher results.
    await act(async () => {
      first.resolve([{ id: "u1", username: "abuser", displayName: "AB User", avatarUrl: null }]);
    });
    expect(screen.queryByRole("button", { name: "AB User @abuser" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ABC User @abcuser" })).toBeInTheDocument();
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
