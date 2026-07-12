import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InviteFailedBanner, parseInviteFailedCount } from "./invite-failed-banner";

describe("InviteFailedBanner", () => {
  it("pluralizes correctly for a single failed invite", () => {
    render(<InviteFailedBanner count={1} />);
    expect(screen.getByText(/1 invite could not be sent/)).toBeInTheDocument();
  });

  it("pluralizes correctly for multiple failed invites", () => {
    render(<InviteFailedBanner count={3} />);
    expect(screen.getByText(/3 invites could not be sent/)).toBeInTheDocument();
  });

  it("renders 'Project settings' as plain text when no settingsHref is given", () => {
    render(<InviteFailedBanner count={1} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/Project settings/)).toBeInTheDocument();
  });

  it("links 'Project settings' to settingsHref when given", () => {
    render(<InviteFailedBanner count={1} settingsHref="/projects/p1/settings" />);
    const link = screen.getByRole("link", { name: "Project settings" });
    expect(link).toHaveAttribute("href", "/projects/p1/settings");
  });
});

describe("parseInviteFailedCount", () => {
  it("returns the parsed count for a positive integer string", () => {
    expect(parseInviteFailedCount("3")).toBe(3);
  });

  it("returns null for undefined, zero, negative, or garbled input", () => {
    expect(parseInviteFailedCount(undefined)).toBeNull();
    expect(parseInviteFailedCount("0")).toBeNull();
    expect(parseInviteFailedCount("-1")).toBeNull();
    expect(parseInviteFailedCount("abc")).toBeNull();
  });
});
