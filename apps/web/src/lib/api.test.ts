import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, errorMessage } from "./api";

afterEach(() => vi.restoreAllMocks());

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

describe("apiFetch", () => {
  it("GETs and parses JSON", async () => {
    const fetchSpy = respond(200, { id: "p1" });
    await expect(apiFetch<{ id: string }>("/api/projects/p1")).resolves.toEqual({ id: "p1" });
    expect(fetchSpy).toHaveBeenCalledWith("/api/projects/p1", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("sends a JSON content type on writes (the server's CSRF guard requires it)", async () => {
    const fetchSpy = respond(201, { id: "s1" });
    await apiFetch("/api/projects/p1/stories", { method: "POST", body: { title: "a" } });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ title: "a" }));
  });

  it("returns undefined for 204 instead of failing to parse", async () => {
    respond(204, undefined);
    await expect(apiFetch("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("throws an ApiError carrying status and code", async () => {
    respond(409, { error: "estimate_required" });
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 409, code: "estimate_required" });
  });

  it("falls back to a generic code when the body is not our error shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 502, code: "unexpected" });
  });
});

describe("errorMessage", () => {
  it("translates the codes the UI can hit", () => {
    expect(errorMessage(new ApiError(401, "invalid_credentials"))).toMatch(/email or password/i);
    expect(errorMessage(new ApiError(409, "estimate_required"))).toMatch(/estimate/i);
    expect(errorMessage(new ApiError(409, "project_archived"))).toMatch(/archived/i);
    expect(errorMessage(new ApiError(429, "too_many_requests"))).toMatch(/too many/i);
    expect(errorMessage(new ApiError(400, "password_too_short"))).toMatch(/12/);
    expect(errorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
