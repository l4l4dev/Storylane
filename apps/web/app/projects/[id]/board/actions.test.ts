import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertMock = vi.fn();
const updateMock = vi.fn();
// Per-table canned `.single()` results for `estimateStory`'s two lookups
// (stories, projects) — set by each test before calling the action.
const fixtures: Record<string, { data: unknown; error: unknown }> = {};

function chainable(table: string): { eq: () => ReturnType<typeof chainable>; single: () => Promise<{ data: unknown; error: unknown }> } {
  return {
    eq: () => chainable(table),
    single: () => Promise.resolve(fixtures[table] ?? { data: null, error: null }),
  };
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
      update: (payload: unknown) => {
        updateMock(table, payload);
        return {
          eq: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      },
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
    fixtures.stories = { data: { story_type: "feature", points: null }, error: null };
    fixtures.projects = { data: { point_scale: "fibonacci", custom_points: null }, error: null };
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
    fixtures.stories = { data: { story_type: "feature", points: 3 }, error: null };
    const { estimateStory } = await import("./actions");

    await expect(estimateStory(baseFormData())).resolves.toBeUndefined();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a story type that doesn't use points", async () => {
    fixtures.stories = { data: { story_type: "chore", points: null }, error: null };
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

    expect(updateMock).toHaveBeenCalledWith("stories", { points: 5 });
  });
});
