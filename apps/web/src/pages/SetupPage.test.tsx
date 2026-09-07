import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupPage } from "./SetupPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SetupPage", () => {
  it("creates the admin from the token in the container log", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "u1", isAdmin: true }));
    const onReady = vi.fn();
    render(<SetupPage onReady={onReady} />);

    await userEvent.type(screen.getByLabelText(/setup token/i), "token-from-the-log");
    await userEvent.type(screen.getByLabelText(/your name/i), "Admin");
    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /create admin/i }));

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      token: "token-from-the-log",
      displayName: "Admin",
      email: "admin@example.test",
      password: "correct horse battery",
    });
  });

  it("explains a wrong token and a short password in place", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(403, { error: "setup_token_invalid" }))
      .mockResolvedValueOnce(json(400, { error: "password_too_short" }));
    render(<SetupPage onReady={vi.fn()} />);
    const submit = () => userEvent.click(screen.getByRole("button", { name: /create admin/i }));

    await userEvent.type(screen.getByLabelText(/setup token/i), "wrong");
    await userEvent.type(screen.getByLabelText(/your name/i), "Admin");
    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/setup token/i);

    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/12/);
  });

  it("tells the operator where the token comes from", () => {
    render(<SetupPage onReady={vi.fn()} />);
    expect(screen.getByText(/docker logs/i)).toBeInTheDocument();
  });
});
