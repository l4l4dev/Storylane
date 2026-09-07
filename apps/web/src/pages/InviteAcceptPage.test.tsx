import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InviteAcceptPage } from "./InviteAcceptPage";
import { SessionProvider } from "../lib/session";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function mockApi(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    return handler();
  });
}

function callsTo(fetchSpy: ReturnType<typeof vi.fn>, method: string, url: string) {
  return fetchSpy.mock.calls.filter(
    ([u, init]) => u === url && ((init as RequestInit | undefined)?.method ?? "GET") === method,
  ).length;
}

describe("InviteAcceptPage", () => {
  it("logged-in join: accepts with an empty body and refreshes the session", async () => {
    const fetchSpy = mockApi({
      "GET /api/me": () => json(200, { id: "u1", email: "owner@example.test", displayName: "Owner", isAdmin: false }),
      "GET /api/invites/tok1": () => json(200, { projectId: "p1", projectName: "Demo Project", role: "member" }),
      "POST /api/invites/tok1/accept": () => json(200, { projectId: "p1", projectName: "Demo Project", role: "member" }),
    });
    const onJoined = vi.fn();
    render(
      <SessionProvider>
        <InviteAcceptPage token="tok1" onJoined={onJoined} />
      </SessionProvider>,
    );

    const button = await screen.findByRole("button", { name: /join as owner/i });
    const meCallsBefore = callsTo(fetchSpy, "GET", "/api/me");
    await userEvent.click(button);

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith("p1"));
    const acceptCall = fetchSpy.mock.calls.find(([u]) => u === "/api/invites/tok1/accept")!;
    expect(JSON.parse((acceptCall[1] as RequestInit).body as string)).toEqual({});
    await waitFor(() => expect(callsTo(fetchSpy, "GET", "/api/me")).toBeGreaterThan(meCallsBefore));
  });

  it("logged-out register+join: sends the typed fields and accessible autocomplete hints", async () => {
    const fetchSpy = mockApi({
      "GET /api/me": () => json(401, { error: "unauthenticated" }),
      "GET /api/invites/tok2": () => json(200, { projectId: "p2", projectName: "Demo Project", role: "viewer" }),
      "POST /api/invites/tok2/accept": () => json(200, { projectId: "p2", projectName: "Demo Project", role: "viewer" }),
    });
    const onJoined = vi.fn();
    render(
      <SessionProvider>
        <InviteAcceptPage token="tok2" onJoined={onJoined} />
      </SessionProvider>,
    );

    const nameInput = await screen.findByLabelText(/your name/i);
    expect(nameInput).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/^email$/i)).toHaveAttribute("autocomplete", "email");

    await userEvent.type(nameInput, "New Person");
    await userEvent.type(screen.getByLabelText(/^email$/i), "new@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /create account and join/i }));

    await waitFor(() => expect(onJoined).toHaveBeenCalledWith("p2"));
    const acceptCall = fetchSpy.mock.calls.find(([u]) => u === "/api/invites/tok2/accept")!;
    expect(JSON.parse((acceptCall[1] as RequestInit).body as string)).toEqual({
      email: "new@example.test",
      displayName: "New Person",
      password: "correct horse battery",
    });
  });

  it("explains an invalid token", async () => {
    mockApi({
      "GET /api/me": () => json(401, { error: "unauthenticated" }),
      "GET /api/invites/bad": () => json(404, { error: "not_found" }),
    });
    render(
      <SessionProvider>
        <InviteAcceptPage token="bad" onJoined={vi.fn()} />
      </SessionProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid/i);
  });
});
