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
    // Falls back to `single` when unset — set it only when one action makes
    // BOTH a .single() and a .maybeSingle() call on the same table and the two
    // need different answers (dropStoryInList: the story, then its new epic).
    maybeSingle?: { data: unknown; error: unknown };
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
    maybeSingle: () =>
      Promise.resolve(fixtures[table]?.maybeSingle ?? fixtures[table]?.single ?? { data: null, error: null }),
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

describe("updateIterationRetroNotes", () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it("writes the trimmed retro notes for the given iteration/project", async () => {
    const { updateIterationRetroNotes } = await import("./actions");

    const formData = new FormData();
    formData.set("project_id", "project-1");
    formData.set("iteration_id", "iteration-1");
    formData.set("retro_notes", "  Went well: shipped on time  ");

    await updateIterationRetroNotes(formData);

    expect(updateMock).toHaveBeenCalledWith(
      "iterations",
      { retro_notes: "Went well: shipped on time" },
      "iteration-1",
    );
  });

  it("stores null for an empty/whitespace-only value (clearing the notes)", async () => {
    const { updateIterationRetroNotes } = await import("./actions");

    const formData = new FormData();
    formData.set("project_id", "project-1");
    formData.set("iteration_id", "iteration-1");
    formData.set("retro_notes", "   ");

    await updateIterationRetroNotes(formData);

    expect(updateMock).toHaveBeenCalledWith("iterations", { retro_notes: null }, "iteration-1");
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

// TASK-82 / TASK-212: the Pivotal-parity draft card's full-field create. It is
// now a thin caller of create_draft_story, which does insert + fields +
// positioning in one transaction — so these assert only what the action itself
// still owns: the arguments it builds, and that it surfaces the RPC's error
// rather than swallowing it. The RPC's own behaviour (atomicity, the iteration
// resolved under the finalize lock, the three targets' landing zones) is proven
// against a real database in create-draft-story.integration.test.ts.
describe("createDraftStory", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    insertMock.mockReset();
    for (const key of Object.keys(rpcResults)) {
      delete rpcResults[key];
    }
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
      assigneeId: null,
      labelIds: [],
      ...overrides,
    };
  }

  const draftCall = () => rpcMock.mock.calls.find(([fn]) => fn === "create_draft_story")?.[1] as Record<string, unknown>;

  it("returns an error for a blank title without calling the RPC", async () => {
    const { createDraftStory } = await import("./actions");

    const result = await createDraftStory(baseInput({ title: "   " }));

    expect(result).toEqual({ ok: false, message: "Title is required" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sends the whole draft in a single RPC call, with the title trimmed", async () => {
    const { createDraftStory } = await import("./actions");

    const result = await createDraftStory(
      baseInput({
        target: "unstarted",
        view: "tracker",
        beforeItemId: "story:top",
        title: "  Draft title  ",
        description: "Details",
        points: 3,
        assigneeId: "user-1",
        labelIds: ["label-1"],
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(draftCall()).toEqual({
      p_project_id: "project-1",
      p_target: "unstarted",
      p_title: "Draft title",
      p_view: "tracker",
      p_description: "Details",
      p_story_type: "feature",
      p_points: 3,
      p_assignee_id: "user-1",
      p_label_ids: ["label-1"],
      p_anchor: { before: { kind: "story", id: "top" } },
    });
    // The three-step path is gone: no plain insert, and no second RPC that a
    // failure could strand a title-only row behind (TASK-212 AC #1).
    expect(insertMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("passes an empty anchor when the panel is empty, rather than omitting it", async () => {
    // The RPC keys "reposition or not" off `p_anchor ? 'before'`, so an empty
    // object is the append case — not a missing argument.
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ beforeItemId: null }));

    expect(draftCall().p_anchor).toEqual({});
  });

  it("defaults the view to list when the caller doesn't pass one", async () => {
    // Only the unstarted zone is ordered per-view; List callers and the Icebox
    // leave `view` unset, and the RPC ignores it for the other two targets.
    const { createDraftStory } = await import("./actions");

    await createDraftStory(baseInput({ target: "icebox", view: undefined }));

    expect(draftCall().p_view).toBe("list");
  });

  for (const target of ["backlog", "unstarted", "icebox"] as const) {
    it(`forwards target ${target} to the RPC rather than branching per target (AC #3)`, async () => {
      const { createDraftStory } = await import("./actions");

      await createDraftStory(baseInput({ target }));

      expect(draftCall().p_target).toBe(target);
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });
  }

  // AC #2: the reposition error used to be discarded here on a best-effort
  // basis. One RPC means every failure — including the splice's — comes back
  // through this single error path.
  it("surfaces the RPC's error message instead of reporting success", async () => {
    rpcResults.create_draft_story = { data: null, error: { message: "stale story state; refresh and retry" } };
    const { createDraftStory } = await import("./actions");

    await expect(createDraftStory(baseInput({ target: "unstarted" }))).resolves.toEqual({
      ok: false,
      message: "stale story state; refresh and retry",
    });
  });

  it("returns the pick-someone-else message when the RPC rejects a non-member assignee", async () => {
    rpcResults.create_draft_story = {
      data: null,
      error: {
        code: "23503",
        message:
          'insert or update on table "stories" violates foreign key constraint "stories_assignee_project_fkey"',
      },
    };
    const { createDraftStory } = await import("./actions");

    await expect(createDraftStory(baseInput({ assigneeId: "user-2" }))).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/pick a different assignee/i),
    });
  });

  it("returns the retry message when the RPC loses a deadlock", async () => {
    rpcResults.create_draft_story = {
      data: null,
      error: { code: "40P01", message: "deadlock detected" },
    };
    const { createDraftStory } = await import("./actions");

    await expect(createDraftStory(baseInput())).resolves.toEqual({
      ok: false,
      message: expect.stringMatching(/try again/i),
    });
  });

  it("surfaces 'No active iteration' from the RPC, which resolves it under the lock", async () => {
    // The action no longer reads iterations itself — doing so before the RPC
    // took iteration_finalize is what let a concurrent finalize land the story
    // in a just-closed iteration.
    rpcResults.create_draft_story = { data: null, error: { message: "No active iteration" } };
    const { createDraftStory } = await import("./actions");

    await expect(createDraftStory(baseInput({ target: "unstarted" }))).resolves.toEqual({
      ok: false,
      message: "No active iteration",
    });
    expect(rpcMock.mock.calls.every(([fn]) => fn === "create_draft_story")).toBe(true);
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
            parent_id: null,
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
          // move_story_board writes parent_id, so a concurrent reparent has to
          // invalidate the move exactly as a state/iteration change does.
          parent_id: null,
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

    // doc-20 §5 retired attach-by-move: a List drop never carries parent_id
    // anymore, and a forged one is ignored rather than honoured. Attaching is
    // set_story_parent's job (setStoryParent + its own integration test).
    function iceboxDrop(parentId?: string): FormData {
      fixtures.stories = {
        single: {
          data: {
            number: 4,
            title: "Backlog story",
            state_id: "unstarted",
            story_type: "feature",
            points: 1,
            iteration_id: null,
            parent_id: null,
          },
          error: null,
        },
        maybeSingle: { data: { id: "epic-1" }, error: null },
      };
      const data = new FormData();
      data.set("project_id", "project-1");
      data.set("item_kind", "story");
      data.set("item_id", "story-4");
      data.set("target_zone", "icebox");
      if (parentId !== undefined) {
        data.set("parent_id", parentId);
      }
      return data;
    }

    it("never sends a parent_id delta, even when the form post carries one", async () => {
      const { dropStoryInList } = await import("./actions");

      await dropStoryInList(iceboxDrop("epic-1"));

      expect(moveCall().p_deltas).toEqual({ state_id: null, iteration: "none" });
    });

    it("omits parent_id for an ordinary drop", async () => {
      const { dropStoryInList } = await import("./actions");

      await dropStoryInList(iceboxDrop());

      expect(moveCall().p_deltas).toEqual({ state_id: null, iteration: "none" });
    });
  });

  describe("setStoryParent", () => {
    it("attaches through set_story_parent, not move_story_board", async () => {
      rpcResults["set_story_parent"] = { data: null, error: null };
      const { setStoryParent } = await import("./actions");

      const result = await setStoryParent({ storyId: "story-4", projectId: "project-1", parentId: "epic-1" });

      expect(result).toEqual({ ok: true });
      expect(rpcMock).toHaveBeenCalledWith("set_story_parent", {
        p_story_id: "story-4",
        p_parent_id: "epic-1",
      });
      expect(rpcMock).not.toHaveBeenCalledWith("move_story_board", expect.anything());
    });

    it("detaches with a null parent", async () => {
      rpcResults["set_story_parent"] = { data: null, error: null };
      const { setStoryParent } = await import("./actions");

      await setStoryParent({ storyId: "story-4", projectId: "project-1", parentId: null });

      expect(rpcMock).toHaveBeenCalledWith("set_story_parent", { p_story_id: "story-4", p_parent_id: null });
    });

    // The RPC owns the rules, so its refusal is what the user must see —
    // surfaced, not swallowed into a silent no-op.
    it("returns the RPC's message when it refuses", async () => {
      rpcResults["set_story_parent"] = { data: null, error: { message: "That epic no longer exists." } };
      const { setStoryParent } = await import("./actions");

      const result = await setStoryParent({ storyId: "story-4", projectId: "project-1", parentId: "epic-1" });

      expect(result).toEqual({ ok: false, message: "That epic no longer exists." });
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
