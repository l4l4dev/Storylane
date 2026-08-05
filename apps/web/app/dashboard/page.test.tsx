import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    from: () => ({
      select: () => ({
        or: () => ({
          order: () => Promise.resolve({ data: null, error: { message: "connection reset" } }),
        }),
      }),
    }),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

describe("DashboardPage", () => {
  it("throws instead of rendering an empty project list when the projects read fails", async () => {
    const { default: DashboardPage } = await import("./page");
    await expect(
      DashboardPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("connection reset");
  });
});
