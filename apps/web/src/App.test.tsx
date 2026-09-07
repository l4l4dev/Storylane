import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("App shell", () => {
  it("shows the setup page when the API says the instance is new", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(409, { error: "setup_required" }));
    render(<App />);
    expect(await screen.findByRole("button", { name: /create admin/i })).toBeInTheDocument();
  });

  it("shows the login page when there is no session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { error: "unauthenticated" }));
    render(<App />);
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("greets a signed-in user", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, { id: "u1", email: "owner@example.test", displayName: "Owner", isAdmin: false }),
    );
    render(<App />);
    expect(await screen.findByText(/signed in as owner/i)).toBeInTheDocument();
  });

  it("never renders nothing for a signed-in user on an unmatched path (e.g. /login after reset)", async () => {
    window.history.pushState({}, "", "/login");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, { id: "u1", email: "owner@example.test", displayName: "Owner", isAdmin: false }),
    );
    const { container } = render(<App />);
    expect(await screen.findByText(/signed in as owner/i)).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });
});
