import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "./Header";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Header", () => {
  it("renders a link back to the project list", () => {
    render(<Header onSignedOut={vi.fn()} />);
    expect(screen.getByRole("link", { name: /projects/i })).toHaveAttribute("href", "/");
  });

  it("signs out via POST /api/auth/logout and refreshes the session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { ok: true }));
    const onSignedOut = vi.fn();
    render(<Header onSignedOut={onSignedOut} />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(fetchSpy).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });
});
