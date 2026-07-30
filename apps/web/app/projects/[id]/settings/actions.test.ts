import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcResults: Record<
  string,
  { data: unknown; error: { code?: string; message: string } | null }
> = {};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string) => rpcResults[fn] ?? { data: null, error: null },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("removeMember", () => {
  beforeEach(() => {
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
  });

  function formData() {
    const data = new FormData();
    data.set("project_id", "project-1");
    data.set("user_id", "user-2");
    return data;
  }

  it("returns the retry message when remove_member is the deadlock victim", async () => {
    // remove_member is one half of the ABBA pair the assignee FK creates
    // (spec/rls.md), so raw error.message would surface "deadlock detected".
    rpcResults.remove_member = { data: null, error: { code: "40P01", message: "deadlock detected" } };
    const { removeMember } = await import("./actions");

    await expect(removeMember({}, formData())).resolves.toEqual({
      error: expect.stringMatching(/try again/i),
    });
  });

  it("returns the owner-only message when the RPC refuses the caller", async () => {
    rpcResults.remove_member = {
      data: null,
      error: { code: "42501", message: 'new row violates row-level security policy for table "project_members"' },
    };
    const { removeMember } = await import("./actions");

    await expect(removeMember({}, formData())).resolves.toEqual({
      error: "Only project owners can remove other members.",
    });
  });

  it("returns no error on success", async () => {
    const { removeMember } = await import("./actions");

    await expect(removeMember({}, formData())).resolves.toEqual({});
  });
});
