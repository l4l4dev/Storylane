import { describe, expect, it, vi } from "vitest";

// TASK-167: My Work destructured only `data` from each Supabase read, so a
// failed read silently rendered as an empty board instead of reaching
// error.tsx. This proves the first read (the viewer's project list) now
// surfaces the error instead of being swallowed.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    from: () => ({
      select: () => ({
        is: () => Promise.resolve({ data: null, error: { message: "connection reset" } }),
      }),
    }),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

describe("MyWorkPage", () => {
  it("throws instead of rendering an empty board when the projects read fails", async () => {
    const { default: MyWorkPage } = await import("./page");
    await expect(MyWorkPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("connection reset");
  });
});
