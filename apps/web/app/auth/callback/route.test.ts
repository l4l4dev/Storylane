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

  it("falls back to /my-work for an absolute URL next", async () => {
    const res = await callback("/auth/callback?code=abc&next=https://evil.example/phish");
    expect(res.headers.get("location")).toBe("https://storylane.example/my-work");
  });

  it("falls back to /my-work for a protocol-relative next", async () => {
    const res = await callback("/auth/callback?code=abc&next=//evil.example/phish");
    expect(res.headers.get("location")).toBe("https://storylane.example/my-work");
  });

  it("falls back to /my-work for a backslash next", async () => {
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
