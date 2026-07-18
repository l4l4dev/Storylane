import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemberList } from "./member-list";

vi.mock("@/app/projects/[id]/settings/actions", () => ({
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
}));

describe("MemberList", () => {
  it("badges agent members without changing their project role", () => {
    render(
      <MemberList
        projectId="p1"
        currentUserId="human"
        canManage={false}
        members={[
          { userId: "agent", role: "member", displayName: "Claude", isAgent: true },
          { userId: "human", role: "owner", displayName: "Mary", isAgent: false },
        ]}
      />,
    );

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
    expect(screen.getByText("Mary")).toBeInTheDocument();
  });
});
