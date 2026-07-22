import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Canned per-table results, set by each test. `categoryByStateId` backs every
// project_states lookup (both resolveMappedState's mapped-state check and
// isRealCategoryDone's own-story-state check), keyed by whichever state id
// was actually queried, so the two can differ within one test.
let mappingRow: { doing_state_id: string | null; done_state_id: string | null } | null = null;
let storyStateId: string | null = "story-state";
let categoryByStateId: Record<string, string> = { "story-state": "unstarted" };
let existingMark: { local_status: string | null } | null = null;

const rpcMock = vi.fn<(name: string, args: unknown) => { error: { message: string } | null }>(() => ({ error: null }));
const upsertMock = vi.fn<(row: Record<string, unknown>) => { error: { message: string } | null }>(() => ({ error: null }));

function reader(result: { data: unknown; error: unknown }) {
  const node = {
    select: () => node,
    eq: () => node,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
  };
  return node;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    rpc: (name: string, args: unknown) => Promise.resolve(rpcMock(name, args)),
    from: (table: string) => {
      switch (table) {
        case "stories":
          return reader({ data: { project_id: "p1", state_id: storyStateId }, error: null });
        case "project_my_work_mapping":
          return reader({ data: mappingRow, error: null });
        case "project_states":
          return {
            select: () => ({
              eq: (_col: string, id: string) => ({
                single: () =>
                  Promise.resolve({
                    data: categoryByStateId[id] ? { category: categoryByStateId[id] } : null,
                    error: null,
                  }),
              }),
            }),
          };
        case "my_work_story_state":
          return {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existingMark, error: null }) }) }) }),
            upsert: (row: Record<string, unknown>) => Promise.resolve(upsertMock(row)),
          };
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  }),
}));

import { setMyWorkColumn } from "./actions";

beforeEach(() => {
  mappingRow = null;
  storyStateId = "story-state";
  categoryByStateId = { "story-state": "unstarted" };
  existingMark = null;
  rpcMock.mockClear();
  rpcMock.mockReturnValue({ error: null });
  upsertMock.mockClear();
  upsertMock.mockReturnValue({ error: null });
});

describe("setMyWorkColumn", () => {
  it("To Today never touches the project — upserts is_today only, no set_story_state", async () => {
    const result = await setMyWorkColumn("s1", "today");
    expect(result).toEqual({ ok: true });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ is_today: true }));
  });

  it("To Todo is a local-only write that sets local_status='todo' and clears is_today", async () => {
    await setMyWorkColumn("s1", "todo");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ is_today: false, local_status: "todo" }));
  });

  it("To Doing on a MAPPED project transitions the real state via set_story_state", async () => {
    mappingRow = { doing_state_id: "doing-state", done_state_id: null };
    categoryByStateId["doing-state"] = "in_progress";
    const result = await setMyWorkColumn("s1", "doing");
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("set_story_state", { p_story_id: "s1", p_state_id: "doing-state" });
    // Mapped: no local_status divergence, only the leave-Today clear.
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ is_today: false, local_status: null }));
  });

  it("To Doing on an UNMAPPED project is local-only (no set_story_state)", async () => {
    const result = await setMyWorkColumn("s1", "doing");
    expect(result).toEqual({ ok: true });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ local_status: "doing" }));
  });

  it("a category-drifted mapping is treated as unmapped (local-only)", async () => {
    mappingRow = { doing_state_id: "doing-state", done_state_id: null };
    categoryByStateId["doing-state"] = "unstarted"; // no longer in_progress
    await setMyWorkColumn("s1", "doing");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ local_status: "doing" }));
  });

  it("surfaces set_story_state's 'No active iteration' as a visible, friendly error", async () => {
    mappingRow = { doing_state_id: "doing-state", done_state_id: null };
    categoryByStateId["doing-state"] = "in_progress";
    rpcMock.mockReturnValueOnce({ error: { message: "No active iteration" } });
    const result = await setMyWorkColumn("s1", "doing");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ message: expect.stringContaining("no active iteration") });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  // fable-advisor (TASK-132): a real-done story can never leave Done via a
  // local-only write (assignedColumn routes category==='done' to Done
  // unconditionally) — without this guard the write would silently succeed
  // and the card would snap back to Done on the next revalidate with no
  // explanation (ux-principles.md principle 2).
  it("rejects dragging an already-real-done story to Todo instead of a silent no-op", async () => {
    categoryByStateId["story-state"] = "done";
    const result = await setMyWorkColumn("s1", "todo");
    expect(result.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects dragging an already-real-done story to Today", async () => {
    categoryByStateId["story-state"] = "done";
    const result = await setMyWorkColumn("s1", "today");
    expect(result.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects dragging an already-real-done story to an UNMAPPED Doing (still a no-op locally)", async () => {
    categoryByStateId["story-state"] = "done";
    const result = await setMyWorkColumn("s1", "doing");
    expect(result.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("still allows a MAPPED Doing drag to reopen an already-real-done story (a real transition, not a no-op)", async () => {
    categoryByStateId["story-state"] = "done";
    mappingRow = { doing_state_id: "doing-state", done_state_id: null };
    categoryByStateId["doing-state"] = "in_progress";
    const result = await setMyWorkColumn("s1", "doing");
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("set_story_state", { p_story_id: "s1", p_state_id: "doing-state" });
  });
});
