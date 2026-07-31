import { describe, expect, it, vi } from "vitest";

let exchangeError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: exchangeError }),
    },
  }),
}));

describe("GET /auth/callback", () => {
  async function callback(query: string) {
    exchangeError = null;
    const { GET } = await import("./route");
    return GET(new Request(`https://storylane.example${query}`));
  }

  it("redirects to /my-work when no next is given", async () => {
    const res = await callback("/auth/callback?code=abc");
    expect(res.headers.get("location")).toBe("https://storylane.example/my-work");
  });

  it("redirects to a same-origin next path", async () => {
    const res = await callback("/auth/callback?code=abc&next=/projects/123");
    expect(res.headers.get("location")).toBe("https://storylane.example/projects/123");
  });

  // The real vector: next is appended straight onto origin, so a value with
  // no leading `/` can put a userinfo `@` in front of the first `/` — this
  // exact input turns the redirect into https://storylane.example@evil.example/phish,
  // which browsers parse with evil.example as the host.
  it("falls back to /my-work for a next that would smuggle a userinfo host", async () => {
    const res = await callback("/auth/callback?code=abc&next=@evil.example/phish");
    expect(res.headers.get("location")).toBe("https://storylane.example/my-work");
  });

  it("falls back to /my-work for a next with no leading slash at all", async () => {
    const res = await callback("/auth/callback?code=abc&next=evil.example/phish");
    expect(res.headers.get("location")).toBe("https://storylane.example/my-work");
  });

  // Not exploitable in this route (appending onto an already-absolute origin
  // keeps the origin fixed regardless), but rejected anyway: the AC requires
  // a single leading `/`, and neither shape is a legitimate app path.
  it("falls back to /my-work for a double-slash next", async () => {
    const res = await callback("/auth/callback?code=abc&next=//evil.example/phish");
    expect(res.headers.get("location")).toBe("https://storylane.example/my-work");
  });

  it("falls back to /my-work for a backslash-prefixed next", async () => {
    const res = await callback("/auth/callback?code=abc&next=/%5Cevil.example/phish");
    expect(res.headers.get("location")).toBe("https://storylane.example/my-work");
  });

  it("redirects to the login error page when the code exchange fails", async () => {
    exchangeError = { message: "invalid code" };
    const { GET } = await import("./route");
    const res = await GET(new Request("https://storylane.example/auth/callback?code=abc"));
    expect(res.headers.get("location")).toBe("https://storylane.example/auth/login?error=auth");
  });
});
