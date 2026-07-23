import { describe, expect, it, vi } from "vitest";

// TASK-167: same silent-swallow bug as the other project pages — the
// project read's `error` was discarded, so a failed read looked like a
// missing project (404) instead of reaching error.tsx.
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

describe("ProjectSettingsPage", () => {
  it("throws instead of rendering a 404 when the project read fails", async () => {
    const { default: ProjectSettingsPage } = await import("./page");
    await expect(ProjectSettingsPage({ params: Promise.resolve({ id: "p1" }) })).rejects.toThrow("connection reset");
  });
});
