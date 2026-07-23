import { describe, expect, it, vi } from "vitest";

// TASK-167: the account settings page destructured only `data` from the
// profile read, so a failed read looked like a missing profile (404)
// instead of reaching error.tsx.
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

describe("SettingsPage", () => {
  it("throws instead of rendering a 404 when the profile read fails", async () => {
    const { default: SettingsPage } = await import("./page");
    await expect(SettingsPage()).rejects.toThrow("connection reset");
  });
});
