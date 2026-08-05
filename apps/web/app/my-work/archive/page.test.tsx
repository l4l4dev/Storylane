import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            table === "profiles"
              ? Promise.resolve({ data: null, error: { message: "connection reset" } })
              : Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

describe("MyWorkArchivePage", () => {
  it("throws instead of rendering an empty archive when the profile read fails", async () => {
    const { default: MyWorkArchivePage } = await import("./page");
    await expect(MyWorkArchivePage()).rejects.toThrow("connection reset");
  });
});
