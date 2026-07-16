import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
const rpcMock = vi.fn();
// Per-table canned results, set by each test before calling the action:
// - `single`/`maybeSingle`: `.select().eq()...single()`/`.maybeSingle()` lookups
// - `list`: `.select().eq()...` (no `.single()`) queries, incl. `.order().limit()`
// - `insertResult`: what `.insert(...).select().single()` resolves to
const fixtures: Record<
  string,
  { single?: { data: unknown; error: unknown }; list?: { data: unknown; error: unknown }; insertResult?: { data: unknown; error: unknown } }
> = {};
// Per-RPC-name canned results (TASK-56: the drop actions call move_story_board;
// persistBacklogOrder calls resequence_backlog_order). Default: success.
const rpcResults: Record<string, { data: unknown; error: unknown }> = {};

function chainable(table: string): {
  eq: () => ReturnType<typeof chainable>;
  neq: () => ReturnType<typeof chainable>;
  is: () => ReturnType<typeof chainable>;
  order: () => ReturnType<typeof chainable>;
  limit: () => ReturnType<typeof chainable>;
  single: () => Promise<{ data: unknown; error: unknown }>;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: Promise<{ data: unknown; error: unknown }>["then"];
} {
  const node = {
    eq: () => chainable(table),
    neq: () => chainable(table),
    is: () => chainable(table),
    order: () => chainable(table),
    limit: () => chainable(table),
    single: () => Promise.resolve(fixtures[table]?.single ?? { data: null, error: null }),
    maybeSingle: () => Promise.resolve(fixtures[table]?.single ?? { data: null, error: null }),
    then: (
      onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(fixtures[table]?.list ?? { data: [], error: null }).then(onFulfilled, onRejected),
  };
  return node as unknown as ReturnType<typeof chainable>;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (fn: string, args: unknown) => {
      rpcMock(fn, args);
      return Promise.resolve(rpcResults[fn] ?? { data: null, error: null });
    },
    from: (table: string) => ({
      upsert: (payload: unknown) => {
        upsertMock(payload);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      }),
      select: () => chainable(table),
      insert: (payload: unknown) => {
        insertMock(table, payload);
        return {
          select: () => ({
            single: () => Promise.resolve(fixtures[table]?.insertResult ?? { data: null, error: null }),
          }),
        };
      },
      update: (payload: unknown) => ({
        eq: (_col: string, id: string) => {
          updateMock(table, payload, id);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      }),
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/integrations/slack", () => ({ notifySlack: vi.fn() }));

describe("upsertIterationGoal", () => {
  beforeEach(() => {
    upsertMock.mockReset();
  });

  it.each(["0", "-1", "1.5", "abc", ""])(
    "rejects a non-positive/non-integer iteration number (%s)",
    async (number) => {
      const { upsertIterationGoal } = await import("./actions");

      const formData = new FormData();
      formData.set("project_id", "project-1");
      formData.set("number", number);
      formData.set("goal", "Ship the thing");

      await expect(upsertIterationGoal(formData)).rejects.toThrow();
      expect(upsertMock).not.toHaveBeenCalled();
    },
  );

  it("accepts a positive integer iteration number", async () => {
    const { upsertIterationGoal } = await import("./actions");

    const formData = new FormData();
    formData.set("project_id", "project-1");
    formData.set("number", "3");
    formData.set("goal", "Ship the thing");

    await upsertIterationGoal(formData);

    expect(upsertMock).toHaveBeenCalledWith({ project_id: "project-1", number: 3, goal: "Ship the thing" });
  });
});

describe("estimateStory", () => {
  beforeEach(() => {
    updateMock.mockReset();
    fixtures.stories = { single: { data: { story_type: "feature", points: null }, error: null } };
    fixtures.projects = { single: { data: { point_scale: "fibonacci", custom_points: null }, error: null } };
  });

  function baseFormData() {
    const formData = new FormData();
    formData.set("project_id", "project-1");
    formData.set("story_id", "story-1");
    formData.set("points", "5");
    return formData;
  }

  it("no-ops (doesn't throw or write) for a story that's already estimated", async () => {
    // A benign race (another tab/user estimated first, or a resubmit after
    // the first click landed) — not a user error, so this must not surface
    // as a crash (spec/ux-principles.md principle 2).
    fixtures.stories = { single: { data: { story_type: "feature", points: 3 }, error: null } };
    const { estimateStory } = await import("./actions");

    await expect(estimateStory(baseFormData())).resolves.toBeUndefined();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a story type that doesn't use points", async () => {
    fixtures.stories = { single: { data: { story_type: "chore", points: null }, error: null } };
    const { estimateStory } = await import("./actions");

    await expect(estimateStory(baseFormData())).rejects.toThrow("This story is not awaiting estimation");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a point value outside the project's point scale", async () => {
    const { estimateStory } = await import("./actions");
    const formData = baseFormData();
    formData.set("points", "4");

    await expect(estimateStory(formData)).rejects.toThrow("Invalid point value");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("sets points for a valid estimate, without touching state", async () => {
    const { estimateStory } = await import("./actions");

    await estimateStory(baseFormData());

    expect(updateMock).toHaveBeenCalledWith("stories", { points: 5 }, "story-1");
  });
});

describe("quickCreateStory (backlog target, per-group insertion — TASK-36)", () => {
  beforeEach(() => {
    insertMock.mockReset();
    updateMock.mockReset();
    rpcMock.mockReset();
    fixtures.stories = {
      list: {
        data: [
          { id: "s1", position: 0 },
          { id: "s2", position: 2 },
        ],
        error: null,
      },
      insertResult: { data: { id: "new-story" }, error: null },
    };
    fixtures.backlog_dividers = {
      list: { data: [{ id: "d1", position: 1 }], error: null },
    };
  });

  function formData(beforeItemId?: string) {
    const data = new FormData();
    data.set("project_id", "project-1");
    data.set("title", "New backlog story");
    data.set("target", "backlog");
    if (beforeItemId) {
      data.set("before_item_id", beforeItemId);
    }
    return data;
  }

  // Reconstructs id -> position from the resequence_backlog_order RPC call
  // persistBacklogOrder now makes: p_kinds interleaves both tables, and each
  // item's position is its index in that dense order (see _resequence_backlog).
  function persistedPositions(): Record<string, number> {
    const call = rpcMock.mock.calls.find(([fn]) => fn === "resequence_backlog_order");
    if (!call) {
      return {};
    }
    const { p_kinds, p_story_ids, p_divider_ids } = call[1] as {
      p_kinds: string[];
      p_story_ids: string[];
      p_divider_ids: string[];
    };
    const positions: Record<string, number> = {};
    let storyIndex = 0;
    let dividerIndex = 0;
    p_kinds.forEach((kind, index) => {
      positions[kind === "divider" ? p_divider_ids[dividerIndex++] : p_story_ids[storyIndex++]] = index;
    });
    return positions;
  }

  it("creates the story as an unstarted, unscheduled feature", async () => {
    const { quickCreateStory } = await import("./actions");

    await quickCreateStory(formData());

    expect(insertMock).toHaveBeenCalledWith(
      "stories",
      expect.objectContaining({
        project_id: "project-1",
        title: "New backlog story",
        story_type: "feature",
        state: "unstarted",
        iteration_id: null,
      }),
    );
  });

  it("appends at the end of the backlog when no before_item_id is given", async () => {
    const { quickCreateStory } = await import("./actions");

    await quickCreateStory(formData());

    const positions = persistedPositions();
    // Merged order was s1(0), d1(1), s2(2) — appended puts it last.
    expect(positions["new-story"]).toBe(3);
    expect(positions.s1).toBe(0);
    expect(positions.d1).toBe(1);
    expect(positions.s2).toBe(2);
  });

  it("inserts before a specific item, so it lands at that group's bottom instead of the whole backlog's", async () => {
    const { quickCreateStory } = await import("./actions");

    await quickCreateStory(formData("divider:d1"));

    const positions = persistedPositions();
    // New story slots in between s1 and d1; d1 and s2 shift down by one.
    expect(positions.s1).toBe(0);
    expect(positions["new-story"]).toBe(1);
    expect(positions.d1).toBe(2);
    expect(positions.s2).toBe(3);
  });
});

// TASK-56 AC#4: the four drop paths are thin callers of move_story_board.
// These assert the action computes the right intent (view / deltas / expected
// snapshot / anchor) from a trusted read and maps the RPC's failure modes to
// the correct surfaced error. True mid-flight-failure / competing-drag
// concurrency is proven against the real DB in move-story-board.integration.test.ts.
describe("board drop actions -> move_story_board", () => {
  const CURRENT_ITERATION = "iter-cur";

  beforeEach(() => {
    rpcMock.mockReset();
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
    fixtures.iterations = { list: { data: [{ id: CURRENT_ITERATION }], error: null } };
  });

  // The single move_story_board call an action made, as [fnName, args].
  function moveCall() {
    const call = rpcMock.mock.calls.find(([fn]) => fn === "move_story_board");
    if (!call) {
      throw new Error("move_story_board was not called");
    }
    return call[1] as {
      p_project_id: string;
      p_item: { kind: string; id: string };
      p_view: string;
      p_expected: Record<string, unknown>;
      p_deltas: Record<string, unknown>;
      p_anchor: Record<string, unknown>;
    };
  }

  describe("dropStory (tracker)", () => {
    beforeEach(() => {
      fixtures.stories = {
        single: {
          data: {
            number: 1,
            title: "A story",
            state: "unstarted",
            story_type: "feature",
            points: 3,
            iteration_id: CURRENT_ITERATION,
            custom_status_id: null,
            swimlane_id: null,
            focus: null,
          },
          error: null,
        },
      };
    });

    function formData(beforeItemId?: string) {
      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("story_id", "story-1");
      data.set("target_column", "started");
      if (beforeItemId) {
        data.set("before_item_id", beforeItemId);
      }
      return data;
    }

    it("calls the RPC with the tracker view, state delta, full expected snapshot and anchor", async () => {
      const { dropStory } = await import("./actions");

      await dropStory(formData("story:neighbour"));

      expect(moveCall()).toEqual({
        p_project_id: "project-1",
        p_item: { kind: "story", id: "story-1" },
        p_view: "tracker",
        p_expected: {
          state: "unstarted",
          iteration_id: CURRENT_ITERATION,
          custom_status_id: null,
          swimlane_id: null,
          focus: null,
        },
        p_deltas: { state: "started" },
        p_anchor: { before: { kind: "story", id: "neighbour" } },
      });
    });

    it("sends an empty anchor (append) when no before_item_id is given", async () => {
      const { dropStory } = await import("./actions");

      await dropStory(formData());

      expect(moveCall().p_anchor).toEqual({});
    });

    it("maps a stale-snapshot rejection (P0001 + 'stale') to a refresh cue", async () => {
      rpcResults.move_story_board = {
        data: null,
        error: { code: "P0001", message: "stale story state; refresh and retry" },
      };
      const { dropStory } = await import("./actions");

      await expect(dropStory(formData())).rejects.toThrow("This story changed on the board. Refresh and try again.");
    });

    it("surfaces a non-stale P0001 (e.g. no active iteration) as its own message", async () => {
      // Same errcode as stale, different meaning — must NOT be masked by the
      // refresh cue (the RPC raises both as P0001, discriminated by message).
      rpcResults.move_story_board = { data: null, error: { code: "P0001", message: "no active iteration" } };
      const { dropStory } = await import("./actions");

      await expect(dropStory(formData())).rejects.toThrow("no active iteration");
    });
  });

  describe("dropStoryFree", () => {
    beforeEach(() => {
      fixtures.stories = {
        single: {
          data: {
            number: 2,
            title: "Free story",
            state: "unstarted",
            iteration_id: null,
            custom_status_id: "status-old",
            swimlane_id: null,
            focus: null,
          },
          error: null,
        },
      };
      fixtures.custom_statuses = { single: { data: { id: "status-new", name: "Doing" }, error: null } };
      fixtures.swimlanes = { single: { data: { id: "lane-1" }, error: null } };
    });

    it("sends the custom_status delta and free view (no lane field on a laneless board)", async () => {
      const { dropStoryFree } = await import("./actions");

      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("story_id", "story-2");
      data.set("status_id", "status-new");
      data.set("before_item_id", "story:neighbour");

      await dropStoryFree(data);

      const call = moveCall();
      expect(call.p_view).toBe("free");
      expect(call.p_deltas).toEqual({ custom_status_id: "status-new" });
      expect(call.p_expected).toEqual({
        state: "unstarted",
        iteration_id: null,
        custom_status_id: "status-old",
        swimlane_id: null,
        focus: null,
      });
    });

    it("includes swimlane_id in the delta when the board has lanes (null = No lane)", async () => {
      const { dropStoryFree } = await import("./actions");

      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("story_id", "story-2");
      data.set("status_id", "status-new");
      data.set("swimlane_id", ""); // present but empty = explicit move into No lane

      await dropStoryFree(data);

      expect(moveCall().p_deltas).toEqual({ custom_status_id: "status-new", swimlane_id: null });
    });
  });

  describe("setStoryFocus", () => {
    beforeEach(() => {
      fixtures.stories = {
        single: {
          data: {
            state: "unstarted",
            iteration_id: CURRENT_ITERATION,
            custom_status_id: null,
            swimlane_id: null,
            focus: null,
          },
          error: null,
        },
      };
    });

    it("sends only the focus delta with the focus view", async () => {
      const { setStoryFocus } = await import("./actions");

      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("story_id", "story-3");
      data.set("target", "today");
      data.set("before_item_id", "story:neighbour");

      await setStoryFocus(data);

      const call = moveCall();
      expect(call.p_view).toBe("focus");
      expect(call.p_deltas).toEqual({ focus: "today" });
      expect(call.p_anchor).toEqual({ before: { kind: "story", id: "neighbour" } });
    });

    it("clears focus (null delta) when dropped on Todo", async () => {
      const { setStoryFocus } = await import("./actions");

      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("story_id", "story-3");
      data.set("target", "todo");

      await setStoryFocus(data);

      expect(moveCall().p_deltas).toEqual({ focus: null });
    });
  });

  describe("dropStoryInList", () => {
    it("reorders a divider with empty deltas/expected and the list view", async () => {
      const { dropStoryInList } = await import("./actions");

      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("item_kind", "divider");
      data.set("item_id", "divider-1");
      data.set("target_zone", "backlog");
      data.set("before_item_id", "story:neighbour");

      await dropStoryInList(data);

      expect(moveCall()).toEqual({
        p_project_id: "project-1",
        p_item: { kind: "divider", id: "divider-1" },
        p_view: "list",
        p_expected: {},
        p_deltas: {},
        p_anchor: { before: { kind: "story", id: "neighbour" } },
      });
    });

    it("rejects a divider dropped outside the backlog without calling the RPC", async () => {
      const { dropStoryInList } = await import("./actions");

      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("item_kind", "divider");
      data.set("item_id", "divider-1");
      data.set("target_zone", "current");

      await expect(dropStoryInList(data)).rejects.toThrow("Dividers can only be reordered within the backlog");
      expect(rpcMock).not.toHaveBeenCalled();
    });

    it("reorders a backlog story with the list view and its expected snapshot", async () => {
      fixtures.stories = {
        single: {
          data: {
            number: 4,
            title: "Backlog story",
            state: "unstarted",
            story_type: "feature",
            points: 1,
            iteration_id: null,
            custom_status_id: null,
            swimlane_id: null,
            focus: null,
          },
          error: null,
        },
      };
      const { dropStoryInList } = await import("./actions");

      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("item_kind", "story");
      data.set("item_id", "story-4");
      data.set("target_zone", "backlog");
      data.set("before_item_id", "divider:d1");

      await dropStoryInList(data);

      const call = moveCall();
      expect(call.p_item).toEqual({ kind: "story", id: "story-4" });
      expect(call.p_view).toBe("list");
      expect(call.p_deltas).toEqual({});
      expect(call.p_anchor).toEqual({ before: { kind: "divider", id: "d1" } });
    });
  });
});
