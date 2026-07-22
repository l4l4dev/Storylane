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
  {
    single?: { data: unknown; error: unknown };
    list?: { data: unknown; error: unknown };
    insertResult?: { data: unknown; error: unknown };
    writeResult?: { data: unknown; error: unknown };
  }
> = {};
// Per-RPC-name canned results (TASK-56: the drop actions call move_story_board;
// TASK-51: the backlog insert actions call insert_board_item). Default: success.
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

// update()/delete() write chains: chainable `.eq()`, awaitable directly (for
// callers that don't read rows), and terminable with `.select("id")` returning
// a row so `assertRowAffected` (TASK-58) sees an affected row. `writeResult`
// per table overrides the default single-row success. For update(), the first
// `.eq()` value is captured into updateMock like the old mock did.
function writeChain(table: string, payload?: unknown) {
  let captured = false;
  const result = () => fixtures[table]?.writeResult ?? { data: [{ id: "mock-id" }], error: null };
  const node = {
    eq: (_col: string, val: string) => {
      if (payload !== undefined && !captured) {
        captured = true;
        updateMock(table, payload, val);
      }
      return node;
    },
    select: () => Promise.resolve(result()),
    then: (
      onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => Promise.resolve(result()).then(onFulfilled, onRejected),
  };
  return node as unknown as {
    eq: (col: string, val: string) => typeof node;
    select: () => Promise<{ data: unknown; error: unknown }>;
    then: Promise<{ data: unknown; error: unknown }>["then"];
  };
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
      delete: () => writeChain(table),
      select: () => chainable(table),
      insert: (payload: unknown) => {
        insertMock(table, payload);
        return {
          select: () => ({
            single: () => Promise.resolve(fixtures[table]?.insertResult ?? { data: null, error: null }),
          }),
        };
      },
      update: (payload: unknown) => writeChain(table, payload),
    }),
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Slack notifications moved to a DB trigger -> slack-notify Edge Function
// (TASK-24), so finishIteration/setStoryState no longer call notifySlack;
// that path is covered by supabase/functions/slack-notify/index.test.ts and
// lib/utils/slack-notifications-outbox.integration.test.ts.

// project_states rows, keyed by name-as-id like the rest of this file's
// literal state strings — the classic template, matching the DB seed
// (20260719000006_stories_state_id.sql).
const CLASSIC_STATE_ROWS = [
  { id: "unstarted", project_id: "project-1", name: "Unstarted", category: "unstarted", action_label: "Start", position: 0, created_at: "" },
  { id: "started", project_id: "project-1", name: "Started", category: "in_progress", action_label: "Finish", position: 1, created_at: "" },
  { id: "finished", project_id: "project-1", name: "Finished", category: "in_progress", action_label: "Deliver", position: 2, created_at: "" },
  { id: "delivered", project_id: "project-1", name: "Delivered", category: "in_progress", action_label: "Accept", position: 3, created_at: "" },
  { id: "accepted", project_id: "project-1", name: "Accepted", category: "done", action_label: null, position: 4, created_at: "" },
  { id: "rejected", project_id: "project-1", name: "Rejected", category: "rejected", action_label: null, position: 5, created_at: "" },
];

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

  it("returns success without writing for a story that's already estimated", async () => {
    // A benign race (another tab/user estimated first, or a resubmit after
    // the first click landed) — not a user error, so this must not surface
    // as a crash (spec/ux-principles.md principle 2).
    fixtures.stories = { single: { data: { story_type: "feature", points: 3 }, error: null } };
    const { estimateStory } = await import("./actions");

    await expect(estimateStory(baseFormData())).resolves.toEqual({ ok: true });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns the failure for a story type that doesn't use points", async () => {
    fixtures.stories = { single: { data: { story_type: "chore", points: null }, error: null } };
    const { estimateStory } = await import("./actions");

    await expect(estimateStory(baseFormData())).resolves.toEqual({
      ok: false,
      message: "This story is not awaiting estimation",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns the failure for a point value outside the project's point scale", async () => {
    const { estimateStory } = await import("./actions");
    const formData = baseFormData();
    formData.set("points", "4");

    await expect(estimateStory(formData)).resolves.toEqual({ ok: false, message: "Invalid point value" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("sets points for a valid estimate, without touching state", async () => {
    const { estimateStory } = await import("./actions");

    await expect(estimateStory(baseFormData())).resolves.toEqual({ ok: true });

    expect(updateMock).toHaveBeenCalledWith("stories", { points: 5 }, "story-1");
  });

  it("returns the failure when the points update matches no row", async () => {
    // The story was fetched successfully but the update hit zero rows (deleted
    // or RLS-filtered between the read and the write) — must surface, not no-op.
    fixtures.stories = {
      single: { data: { story_type: "feature", points: null }, error: null },
      writeResult: { data: [], error: null },
    };
    const { estimateStory } = await import("./actions");

    await expect(estimateStory(baseFormData())).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/no matching row/i),
    });
  });
});

// TASK-91: setStoryState is a thin caller of the set_story_state RPC — the
// estimation gate, done-iteration guard, and start-from-backlog
// current-iteration assignment all now live server-side in the RPC, proven
// directly against the real DB in apps/mcp/src/handlers.integration.test.ts.
// The target state_id is resolved client-side (computeStateGate,
// packages/core) before this action is ever called — these assert the
// action forwards it verbatim and surfaces the RPC's errors verbatim.
describe("setStoryState", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
    fixtures.stories = { single: { data: { number: 7, title: "A story" }, error: null } };
    fixtures.project_states = { list: { data: CLASSIC_STATE_ROWS, error: null } };
  });

  function formData(stateId = "started") {
    const data = new FormData();
    data.set("project_id", "project-1");
    data.set("story_id", "story-1");
    data.set("state_id", stateId);
    return data;
  }

  it("calls set_story_state with the story id and target state_id", async () => {
    rpcResults.set_story_state = { data: { story_id: "story-1", state_id: "started" }, error: null };
    const { setStoryState } = await import("./actions");

    await expect(setStoryState(formData("started"))).resolves.toEqual({ ok: true });

    expect(rpcMock).toHaveBeenCalledWith("set_story_state", { p_story_id: "story-1", p_state_id: "started" });
  });

  it("surfaces the RPC's unestimated-feature guard verbatim", async () => {
    rpcResults.set_story_state = { data: null, error: { message: "An unestimated feature can only be in the Icebox or an unstarted state" } };
    const { setStoryState } = await import("./actions");

    await expect(setStoryState(formData("started"))).resolves.toEqual({
      ok: false,
      message: "An unestimated feature can only be in the Icebox or an unstarted state",
    });
  });

  it("surfaces the RPC's no-active-iteration error verbatim", async () => {
    rpcResults.set_story_state = { data: null, error: { message: "No active iteration" } };
    const { setStoryState } = await import("./actions");

    await expect(setStoryState(formData("started"))).resolves.toEqual({
      ok: false,
      message: "No active iteration",
    });
  });

  it("surfaces the RPC's permission denial verbatim", async () => {
    rpcResults.set_story_state = {
      data: null,
      error: { code: "42501", message: "Not allowed to change this story's state" },
    };
    const { setStoryState } = await import("./actions");

    await expect(setStoryState(formData("started"))).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/not allowed to change/i),
    });
  });

  it("returns the fetch error when the story can't be read (not found / not a member)", async () => {
    fixtures.stories = { single: { data: null, error: { message: "Story not found" } } };
    const { setStoryState } = await import("./actions");

    await expect(setStoryState(formData("started"))).resolves.toEqual({
      ok: false,
      message: "Story not found",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// TASK-51: the backlog insert paths are thin callers of insert_board_item —
// the insert + reposition is one transaction in the RPC. These assert the
// action forwards the right kind/payload/anchor; the actual splice + dense
// resequence is proven against the real DB in insert-board-item.integration.test.ts.
describe("backlog insert actions -> insert_board_item", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
  });

  // The single insert_board_item call an action made, as its args object.
  function insertCall() {
    const call = rpcMock.mock.calls.find(([fn]) => fn === "insert_board_item");
    if (!call) {
      throw new Error("insert_board_item was not called");
    }
    return call[1] as {
      p_project_id: string;
      p_kind: string;
      p_payload: Record<string, unknown>;
      p_anchor: Record<string, unknown>;
    };
  }

  describe("createBacklogDivider", () => {
    function formData(kind: string, opts?: { label?: string; beforeItemId?: string }) {
      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("kind", kind);
      if (opts?.label !== undefined) {
        data.set("label", opts.label);
      }
      if (opts?.beforeItemId) {
        data.set("before_item_id", opts.beforeItemId);
      }
      return data;
    }

    it("forwards a divider insert with the label + kind payload and the anchor", async () => {
      const { createBacklogDivider } = await import("./actions");

      await createBacklogDivider(formData("note", { label: "Planning", beforeItemId: "story:s1" }));

      expect(insertCall()).toEqual({
        p_project_id: "project-1",
        p_kind: "divider",
        p_payload: { label: "Planning", kind: "note" },
        p_anchor: { before: { kind: "story", id: "s1" } },
      });
    });

    it("does not call the RPC for a note with a blank label", async () => {
      const { createBacklogDivider } = await import("./actions");

      await createBacklogDivider(formData("note", { label: "" }));

      expect(rpcMock).not.toHaveBeenCalled();
    });
  });
});

// TASK-82: the Pivotal-parity draft card's full-field create. These assert
// the action's call sequence per target and that failures surface the right
// message; the underlying RPCs' own correctness (splice/reorder/update
// atomicity) is proven in insert-board-item/move-story-board/update-story's
// own integration tests.
describe("createDraftStory", () => {
  const CURRENT_ITERATION = "iter-cur";

  beforeEach(() => {
    rpcMock.mockReset();
    insertMock.mockReset();
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
    fixtures.iterations = { list: { data: [{ id: CURRENT_ITERATION }], error: null } };
    fixtures.project_states = { list: { data: CLASSIC_STATE_ROWS, error: null } };
    fixtures.stories = { insertResult: { data: { id: "new-story-id" }, error: null } };
    rpcResults.update_story = {
      data: [
        {
          title: "Draft title",
          description: null,
          story_type: "feature",
          points: null,
          epic_id: null,
          assignee_id: null,
          label_ids: [],
        },
      ],
      error: null,
    };
  });

  function baseInput(overrides: Partial<Parameters<typeof import("./actions")["createDraftStory"]>[0]> = {}) {
    return {
      projectId: "project-1",
      target: "unstarted" as const,
      beforeItemId: null,
      title: "Draft title",
      description: null,
      storyType: "feature",
      points: null,
      epicId: null,
      assigneeId: null,
      labelIds: [],
      ...overrides,
    };
  }

  it("returns an error for a blank title without creating anything", async () => {
    const { createDraftStory } = await import("./actions");

    const result = await createDraftStory(baseInput({ title: "   " }));

    expect(result).toEqual({ ok: false, message: "Title is required" });
    expect(insertMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("errors for target unstarted with no active iteration, without inserting", async () => {
    fixtures.iterations = { list: { data: [], error: null } };
    const { createDraftStory } = await import("./actions");

    const result = await createDraftStory(baseInput({ target: "unstarted" }));

    expect(result).toEqual({ ok: false, message: "No active iteration" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts into the current iteration's unstarted state for target unstarted", async () => {
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ target: "unstarted" }));

    expect(insertMock).toHaveBeenCalledWith("stories", {
      project_id: "project-1",
      title: "Draft title",
      story_type: "feature",
      state_id: "unstarted",
      iteration_id: CURRENT_ITERATION,
    });
  });

  it("repositions to the given anchor for target unstarted when the zone isn't empty", async () => {
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ target: "unstarted", beforeItemId: "story:top", view: "tracker" }));

    const call = rpcMock.mock.calls.find(([fn]) => fn === "move_story_board");
    expect(call?.[1]).toEqual({
      p_project_id: "project-1",
      p_item: { kind: "story", id: "new-story-id" },
      p_view: "tracker",
      p_expected: { state_id: "unstarted", iteration_id: CURRENT_ITERATION },
      p_deltas: {},
      p_anchor: { before: { kind: "story", id: "top" } },
    });
  });

  it("skips the reposition call when the zone is empty (no anchor)", async () => {
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ target: "unstarted", beforeItemId: null }));

    expect(rpcMock.mock.calls.some(([fn]) => fn === "move_story_board")).toBe(false);
  });

  it("inserts with no state/iteration for target icebox", async () => {
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ target: "icebox" }));

    expect(insertMock).toHaveBeenCalledWith("stories", {
      project_id: "project-1",
      title: "Draft title",
      story_type: "feature",
      state_id: null,
      iteration_id: null,
    });
  });

  it("always uses list view to reposition an icebox draft, ignoring any view override", async () => {
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ target: "icebox", beforeItemId: "story:top", view: "tracker" }));

    const call = rpcMock.mock.calls.find(([fn]) => fn === "move_story_board");
    expect((call?.[1] as { p_view: string }).p_view).toBe("list");
  });

  it("calls insert_board_item (not a plain insert) for target backlog", async () => {
    rpcResults.insert_board_item = { data: "new-story-id", error: null };
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ target: "backlog", beforeItemId: "divider:d1" }));

    const call = rpcMock.mock.calls.find(([fn]) => fn === "insert_board_item");
    expect(call?.[1]).toEqual({
      p_project_id: "project-1",
      p_kind: "story",
      p_payload: { title: "Draft title" },
      p_anchor: { before: { kind: "divider", id: "d1" } },
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("applies the full field set via update_story after creating the story", async () => {
    const { createDraftStory } = await import("./actions");

    await createDraftStory(
      baseInput({
        target: "unstarted",
        description: "Details",
        points: 3,
        epicId: "epic-1",
        assigneeId: "user-1",
        labelIds: ["label-1"],
      }),
    );

    const call = rpcMock.mock.calls.find(([fn]) => fn === "update_story");
    expect(call?.[1]).toEqual({
      p_story_id: "new-story-id",
      p_title: "Draft title",
      p_description: "Details",
      p_story_type: "feature",
      p_points: 3,
      p_epic_id: "epic-1",
      p_assignee_id: "user-1",
      p_label_ids: ["label-1"],
    });
  });

  it("surfaces the create RPC's error message instead of throwing", async () => {
    rpcResults.insert_board_item = { data: null, error: { message: "Backlog insert failed" } };
    const { createDraftStory } = await import("./actions");

    await expect(createDraftStory(baseInput({ target: "backlog" }))).resolves.toEqual({
      ok: false,
      message: "Backlog insert failed",
    });
  });

  it("surfaces update_story's error message when the field save fails", async () => {
    rpcResults.update_story = { data: null, error: { message: "Points must be on the point scale" } };
    const { createDraftStory } = await import("./actions");

    await expect(createDraftStory(baseInput({ target: "unstarted" }))).resolves.toEqual({
      ok: false,
      message: "Points must be on the point scale",
    });
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
    fixtures.project_states = { list: { data: CLASSIC_STATE_ROWS, error: null } };
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
            state_id: "unstarted",
            story_type: "feature",
            points: 3,
            iteration_id: CURRENT_ITERATION,
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
          state_id: "unstarted",
          iteration_id: CURRENT_ITERATION,
        },
        p_deltas: { state_id: "started" },
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
            state_id: "unstarted",
            story_type: "feature",
            points: 1,
            iteration_id: null,
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

  // Rollover is writers-only (finalize_iteration rejects viewers with 42501,
  // owner decision 2026-07-22). ensureCurrentIteration must NOT let that
  // rejection error the board/iterations pages for a viewer — it swallows
  // 42501 and lets the stale iteration render.
  describe("ensureCurrentIteration", () => {
    beforeEach(() => {
      rpcMock.mockReset();
      for (const key of Object.keys(rpcResults)) {
        delete rpcResults[key];
      }
      // An expired latest iteration, so the cheap pre-check doesn't early-return
      // and the RPC is actually attempted.
      fixtures.iterations = { list: { data: [{ state: "current", end_date: "2000-01-01" }], error: null } };
    });

    it("swallows the viewer/non-writer 42501 rejection instead of throwing", async () => {
      rpcResults.finalize_iteration = { data: null, error: { code: "42501", message: "not authorized" } };
      const { ensureCurrentIteration } = await import("./actions");
      await expect(ensureCurrentIteration("project-1")).resolves.toBeUndefined();
      expect(rpcMock).toHaveBeenCalledWith("finalize_iteration", { p_project_id: "project-1", p_manual: false });
    });

    it("still throws on a real (non-42501) rollover error", async () => {
      rpcResults.finalize_iteration = { data: null, error: { code: "XX000", message: "boom" } };
      const { ensureCurrentIteration } = await import("./actions");
      await expect(ensureCurrentIteration("project-1")).rejects.toThrow("boom");
    });

    it("skips the RPC entirely when the current iteration is still up to date", async () => {
      const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      fixtures.iterations = { list: { data: [{ state: "current", end_date: future }], error: null } };
      const { ensureCurrentIteration } = await import("./actions");
      await ensureCurrentIteration("project-1");
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });
});
