import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
// Per-table canned results, set by each test before calling the action:
// - `single`: `estimateStory`'s two `.select().eq()...single()` lookups
// - `list`: `fetchBacklogOrder`'s two `.select().eq()...` (no `.single()`) queries
// - `insertResult`: what `.insert(...).select().single()` resolves to
const fixtures: Record<
  string,
  { single?: { data: unknown; error: unknown }; list?: { data: unknown; error: unknown }; insertResult?: { data: unknown; error: unknown } }
> = {};

function chainable(table: string): {
  eq: () => ReturnType<typeof chainable>;
  neq: () => ReturnType<typeof chainable>;
  is: () => ReturnType<typeof chainable>;
  single: () => Promise<{ data: unknown; error: unknown }>;
  then: Promise<{ data: unknown; error: unknown }>["then"];
} {
  const node = {
    eq: () => chainable(table),
    neq: () => chainable(table),
    is: () => chainable(table),
    single: () => Promise.resolve(fixtures[table]?.single ?? { data: null, error: null }),
    then: (
      onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(fixtures[table]?.list ?? { data: [], error: null }).then(onFulfilled, onRejected),
  };
  return node as unknown as ReturnType<typeof chainable>;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
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

  // Reconstructs id -> position from every recorded `.update(...).eq("id",
  // id)` call, the same shape `persistBacklogOrder` writes.
  function persistedPositions(): Record<string, number> {
    const positions: Record<string, number> = {};
    for (const [table, payload, id] of updateMock.mock.calls as [string, { position: number }, string][]) {
      if (table === "stories" || table === "backlog_dividers") {
        positions[id] = payload.position;
      }
    }
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
