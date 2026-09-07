import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./LoginPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("LoginPage", () => {
  it("submits the credentials and reports success to the caller", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "u1" }));
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    await userEvent.type(screen.getByLabelText(/email/i), "owner@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    const [path, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/auth/login");
    expect(JSON.parse(init.body as string)).toEqual({ email: "owner@example.test", password: "correct horse battery" });
  });

  it("shows the server's reason and keeps the typed email", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { error: "invalid_credentials" }));
    render(<LoginPage onSignedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email/i), "owner@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong password here");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/email or password/i);
    expect(screen.getByLabelText(/email/i)).toHaveValue("owner@example.test");
  });

  it("never renders a disabled submit button (ux principle 1)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "u1" }));
    render(<LoginPage onSignedIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled();
  });
});
