import { describe, expect, it, vi } from "vitest";

// TASK-167: the page used to destructure only `data` from each Supabase
// read, so a failed read (transient DB error, RLS misconfiguration, etc.)
// silently proceeded as if the project didn't exist (a 404) instead of
// throwing to error.tsx. This proves the project read now surfaces the
// error instead of being swallowed.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: "connection reset" } }),
        }),
      }),
    }),
  }),
}));

describe("BoardPage", () => {
  it("throws instead of rendering a 404 when the project read fails", async () => {
    const { default: BoardPage } = await import("./page");
    await expect(
      BoardPage({
        params: Promise.resolve({ id: "p1" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("connection reset");
  });
});
