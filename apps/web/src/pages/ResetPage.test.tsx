import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResetPage } from "./ResetPage";
import { SessionProvider } from "../lib/session";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Anonymous by default: /api/me answers 401 unless a test overrides it. */
function mockApi(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    return handler();
  });
}

describe("ResetPage", () => {
  it("shows the token's email and, on success, refreshes the session and offers /login?reset=1", async () => {
    mockApi({
      "GET /api/auth/reset/tok1": () => json(200, { email: "user@example.test" }),
      "GET /api/me": () => json(401, { error: "unauthenticated" }),
      "POST /api/auth/reset/tok1": () => json(200, { ok: true }),
    });
    render(
      <SessionProvider>
        <ResetPage token="tok1" />
      </SessionProvider>,
    );

    expect(await screen.findByText(/for user@example\.test/i)).toBeInTheDocument();
    const meCallsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([u]) => u === "/api/me",
    ).length;

    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));

    const link = await screen.findByRole("link", { name: /go to sign in/i });
    expect(link).toHaveAttribute("href", "/login?reset=1");
    await waitFor(() => {
      const meCallsAfter = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([u]) => u === "/api/me",
      ).length;
      expect(meCallsAfter).toBeGreaterThan(meCallsBefore);
    });
  });

  it("shows an error and does not offer sign-in when the post-reset session reload fails", async () => {
    let meCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/me" && method === "GET") {
        meCalls += 1;
        // First call is the provider's mount load (unauthenticated); the second is the
        // post-reset refresh, which fails.
        return meCalls === 1 ? json(401, { error: "unauthenticated" }) : json(500, { error: "unexpected" });
      }
      if (url === "/api/auth/reset/tok1" && method === "GET") {
        return json(200, { email: "user@example.test" });
      }
      if (url === "/api/auth/reset/tok1" && method === "POST") {
        return json(200, { ok: true });
      }
      throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    });
    render(
      <SessionProvider>
        <ResetPage token="tok1" />
      </SessionProvider>,
    );

    await screen.findByText(/for user@example\.test/i);
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
    expect(screen.queryByRole("link", { name: /go to sign in/i })).not.toBeInTheDocument();
  });

  it("explains an invalid or expired token", async () => {
    mockApi({
      "GET /api/auth/reset/bad": () => json(404, { error: "not_found" }),
      "GET /api/me": () => json(401, { error: "unauthenticated" }),
    });
    render(
      <SessionProvider>
        <ResetPage token="bad" />
      </SessionProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid/i);
  });

  it("shows an inline error for a too-short password", async () => {
    mockApi({
      "GET /api/auth/reset/tok1": () => json(200, { email: "user@example.test" }),
      "GET /api/me": () => json(401, { error: "unauthenticated" }),
      "POST /api/auth/reset/tok1": () => json(400, { error: "password_too_short" }),
    });
    render(
      <SessionProvider>
        <ResetPage token="tok1" />
      </SessionProvider>,
    );
    await screen.findByText(/for user@example\.test/i);
    await userEvent.type(screen.getByLabelText(/password/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/12/);
  });
});
