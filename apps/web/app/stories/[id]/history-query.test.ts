import { describe, expect, it, vi } from "vitest";

// getStoryDetail issues eleven queries in one Promise.all, so the mock is a
// single chainable node that records what each table was asked for. Only the
// activity_logs chain is asserted; the rest just have to resolve.
const calls: { table: string; method: string; args: unknown[] }[] = [];

const STORY = {
  id: "s1",
  project_id: "p1",
  number: 7,
  title: "A story",
  description: null,
  story_type: "feature",
  state_id: null,
  points: null,
  parent_id: null,
  is_container: false,
  epic_color: null,
  assignee_id: null,
  iteration_id: null,
  position: 1,
  story_labels: [],
};

function chain(table: string) {
  const node: Record<string, unknown> = {
    single: async () => ({ data: table === "stories" ? STORY : {}, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: [], error: null }),
  };
  for (const method of ["select", "eq", "in", "is", "neq", "filter", "order", "limit"]) {
    node[method] = (...args: unknown[]) => {
      calls.push({ table, method, args });
      return node;
    };
  }
  return node;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => chain(table),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("getStoryDetail history query", () => {
  it("admits story.containerized and drops bookkeeping rows", async () => {
    const { getStoryDetail } = await import("./actions");
    await getStoryDetail("s1");

    const logCalls = calls.filter((c) => c.table === "activity_logs");

    // Without story.containerized in the whitelist the filter below would strip
    // the last trace of an epic-ing from this panel.
    const whitelist = logCalls.find((c) => c.method === "in")?.args[1] as string[];
    expect(whitelist).toContain("story.containerized");
    expect(whitelist).toContain("story.assignee_changed");

    expect(logCalls).toContainEqual(
      expect.objectContaining({ method: "filter", args: ["payload->>bookkeeping", "is", null] }),
    );
  });
});
