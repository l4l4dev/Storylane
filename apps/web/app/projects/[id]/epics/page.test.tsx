import { describe, expect, it, vi } from "vitest";

const { getStoryDetailMock, state } = vi.hoisted(() => {
  let resolveOwnQueries!: () => void;
  const ownQueriesPending = new Promise<void>((resolve) => {
    resolveOwnQueries = resolve;
  });
  return {
    getStoryDetailMock: vi.fn(),
    state: {
      // TASK-167 case: null makes the projects read succeed; set per-test.
      projectReadError: null as string | null,
      resolveOwnQueries,
      ownQueriesPending,
    },
  };
});

vi.mock("@/app/stories/[id]/actions", () => ({
  getStoryDetail: (...args: unknown[]) => getStoryDetailMock(...args),
}));

vi.mock("@/app/projects/[id]/board/actions", () => ({
  ensureCurrentIteration: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                state.projectReadError
                  ? Promise.resolve({ data: null, error: { message: state.projectReadError } })
                  : Promise.resolve({ data: { id: "p1", name: "Proj" }, error: null }),
            }),
          }),
        };
      }
      // Every other table (stories x2, project_states, iterations) only
      // resolves once a test explicitly unblocks it via
      // state.resolveOwnQueries() — simulating slow queries so a
      // getStoryDetail call that's (incorrectly) waiting on them first can
      // never satisfy vi.waitFor below in time.
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        order: () => builder,
        then: (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
          state.ownQueriesPending.then(() => onFulfilled({ data: [], error: null })),
      };
      return builder;
    },
  }),
}));

describe("EpicsPage", () => {
  // TASK-167: the project read's `error` used to be discarded, so a failed
  // read looked like a missing project (404) instead of reaching error.tsx.
  it("throws instead of rendering a 404 when the project read fails", async () => {
    state.projectReadError = "connection reset";
    const { default: EpicsPage } = await import("./page");
    await expect(
      EpicsPage({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("connection reset");
    state.projectReadError = null;
  });

  // TASK-199: getStoryDetail(peekStoryId) used to be awaited only after the
  // page's own 4-query Promise.all resolved, serializing two independent
  // round-trips. This proves it's launched alongside them instead.
  it("calls getStoryDetail while the page's own queries are still pending", async () => {
    getStoryDetailMock.mockClear();
    getStoryDetailMock.mockResolvedValue(null);
    const { default: EpicsPage } = await import("./page");

    const pagePromise = EpicsPage({
      params: Promise.resolve({ id: "p1" }),
      searchParams: Promise.resolve({ story: "s1" }),
    });

    await vi.waitFor(() => expect(getStoryDetailMock).toHaveBeenCalledWith("s1"));

    state.resolveOwnQueries();
    await pagePromise;
  });
});
