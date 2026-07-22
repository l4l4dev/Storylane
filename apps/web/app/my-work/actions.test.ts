import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Per-test state. `story` is the stories row (with its embedded project's
// is_personal); `categoryByStateId` backs isRealCategoryDone; `lowestByCategory`
// backs the personal Todo/Done real-state resolution; `ownedColumns` backs the
// free-column ownership check.
let story: { project_id: string; state_id: string | null; projects: { is_personal: boolean } };
let categoryByStateId: Record<string, string>;
let lowestByCategory: Record<string, string | null>;
let ownedColumns: Set<string>;
let maxTodayPosition: number | null;

const rpcMock = vi.fn<(name: string, args: unknown) => { error: { message: string } | null }>(() => ({ error: null }));
const upsertMock = vi.fn<(row: Record<string, unknown>) => { error: { message: string } | null }>(() => ({ error: null }));
const updateMock = vi.fn<(row: Record<string, unknown>) => { error: { message: string } | null }>(() => ({ error: null }));

type Query = { select: string; filters: Record<string, unknown> };

function node(resolve: (q: Query) => { data: unknown; error: unknown }) {
  const q: Query = { select: "", filters: {} };
  const self = {
    select: (s: string) => ((q.select = s), self),
    eq: (c: string, v: unknown) => ((q.filters[c] = v), self),
    order: () => self,
    limit: () => self,
    single: () => Promise.resolve(resolve(q)),
    maybeSingle: () => Promise.resolve(resolve(q)),
  };
  return self;
}

// A chainable that records an update() and resolves after .eq().in() is awaited.
function updateChain(row: Record<string, unknown>) {
  const result = updateMock(row);
  const self = {
    eq: () => self,
    in: () => self,
    then: (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF),
  };
  return self;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    rpc: (name: string, args: unknown) => Promise.resolve(rpcMock(name, args)),
    from: (table: string) => {
      switch (table) {
        case "stories":
          return node(() => ({ data: story, error: null }));
        case "project_states":
          return node((q) => {
            if (q.select.includes("category")) {
              const id = q.filters.id as string;
              return { data: categoryByStateId[id] ? { category: categoryByStateId[id] } : null, error: null };
            }
            const cat = q.filters.category as string;
            const id = lowestByCategory[cat];
            return { data: id ? { id } : null, error: null };
          });
        case "my_work_columns":
          return node((q) => ({
            data: ownedColumns.has(q.filters.id as string) && q.filters.user_id === "u1" ? { id: q.filters.id } : null,
            error: null,
          }));
        case "my_work_story_state":
          return {
            select: () => node(() => ({
              data: maxTodayPosition === null ? null : { today_position: maxTodayPosition },
              error: null,
            })),
            upsert: (row: Record<string, unknown>) => Promise.resolve(upsertMock(row)),
            update: (row: Record<string, unknown>) => updateChain(row),
          };
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  }),
}));

import { carryOverToday, dismissCarryOver, setMyWorkColumn } from "./actions";

const TODAY = "2026-07-22";

beforeEach(() => {
  story = { project_id: "p1", state_id: "story-state", projects: { is_personal: false } };
  categoryByStateId = { "story-state": "unstarted" };
  lowestByCategory = { unstarted: "unstarted-state", done: "done-state" };
  ownedColumns = new Set(["col-doing"]);
  maxTodayPosition = null;
  rpcMock.mockClear();
  rpcMock.mockReturnValue({ error: null });
  upsertMock.mockClear();
  upsertMock.mockReturnValue({ error: null });
  updateMock.mockClear();
  updateMock.mockReturnValue({ error: null });
});

describe("setMyWorkColumn — personal project (real-state direct)", () => {
  beforeEach(() => {
    story.projects.is_personal = true;
  });

  it("To Done writes the real done state and clears local marks", async () => {
    const result = await setMyWorkColumn("s1", "done", TODAY);
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("set_story_state", { p_story_id: "s1", p_state_id: "done-state" });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: null, today_date: null, today_position: null }),
    );
  });

  it("To Todo reopens by writing the lowest unstarted state", async () => {
    categoryByStateId["story-state"] = "done"; // was completed
    const result = await setMyWorkColumn("s1", "todo", TODAY);
    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("set_story_state", { p_story_id: "s1", p_state_id: "unstarted-state" });
  });

  it("errors (no local write) when the project has no state of the target category", async () => {
    lowestByCategory.done = null;
    const result = await setMyWorkColumn("s1", "done", TODAY);
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("a free-column drag stays local even for a personal story", async () => {
    const result = await setMyWorkColumn("s1", "col-doing", TODAY);
    expect(result).toEqual({ ok: true });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ column_id: "col-doing", today_date: null }));
  });
});

describe("setMyWorkColumn — team story (local marks only)", () => {
  it("To Today sets today_date + today_position, never calls set_story_state", async () => {
    maxTodayPosition = 2;
    const result = await setMyWorkColumn("s1", "today", TODAY);
    expect(result).toEqual({ ok: true });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ today_date: TODAY, today_position: 3 }));
  });

  it("To Today keeps column_id untouched (Today overlays the card's column)", async () => {
    await setMyWorkColumn("s1", "today", TODAY);
    const row = upsertMock.mock.calls[0][0];
    expect(row).not.toHaveProperty("column_id");
  });

  it("To Todo clears column_id and today marks locally", async () => {
    await setMyWorkColumn("s1", "todo", TODAY);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: null, today_date: null, today_position: null }),
    );
  });

  it("a free-column drag sets column_id and clears today marks", async () => {
    await setMyWorkColumn("s1", "col-doing", TODAY);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ column_id: "col-doing", today_date: null, today_position: null }),
    );
  });

  it("rejects a drag to an unknown/foreign column instead of writing it", async () => {
    const result = await setMyWorkColumn("s1", "not-my-column", TODAY);
    expect(result.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("To Done is rejected — team completion happens on the story's own board", async () => {
    const result = await setMyWorkColumn("s1", "done", TODAY);
    expect(result.ok).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  // A team story already real-done can't leave Done via a local mark: it would
  // snap back on the next refresh (classification excludes real-done), so it's
  // an explicit error, not a silent no-op (ux-principles principle 2).
  it("rejects dragging an already-real-done team story to Todo", async () => {
    categoryByStateId["story-state"] = "done";
    const result = await setMyWorkColumn("s1", "todo", TODAY);
    expect(result.ok).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("carry-over", () => {
  it("carryOverToday bulk-updates the given stories to today", async () => {
    const result = await carryOverToday(["s1", "s2"], TODAY);
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ today_date: TODAY }));
  });

  it("dismissCarryOver clears the today marks", async () => {
    const result = await dismissCarryOver(["s1"]);
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ today_date: null, today_position: null }));
  });

  it("both no-op on an empty id list (no DB call)", async () => {
    await carryOverToday([], TODAY);
    await dismissCarryOver([]);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
