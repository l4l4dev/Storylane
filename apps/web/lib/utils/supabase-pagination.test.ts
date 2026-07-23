import { describe, expect, it } from "vitest";
import { fetchAllRows } from "./supabase-pagination";

// Regression for TASK-166: Board/My Work fetched stories with a single
// unbounded select, which PostgREST silently truncates at max_rows (1000) —
// no error, just missing rows past the cap. This fixture simulates a project
// with 2,500 rows (past two full pages) to prove every row survives.
describe("fetchAllRows", () => {
  it("pages through all rows past a single max_rows page", async () => {
    const total = 2500;
    const allRows = Array.from({ length: total }, (_, i) => ({ id: i }));

    const rows = await fetchAllRows((from, to) => Promise.resolve({ data: allRows.slice(from, to + 1), error: null }));

    expect(rows).toHaveLength(total);
    expect(rows[0]).toEqual({ id: 0 });
    expect(rows[total - 1]).toEqual({ id: total - 1 });
  });

  it("stops after a single partial page (no trailing empty request)", async () => {
    let calls = 0;
    const rows = await fetchAllRows((from, to) => {
      calls += 1;
      return Promise.resolve({ data: Array.from({ length: 3 }, (_, i) => from + i).slice(0, to - from + 1), error: null });
    });

    expect(rows).toEqual([0, 1, 2]);
    expect(calls).toBe(1);
  });

  it("throws on a page error instead of returning a partial result silently", async () => {
    await expect(fetchAllRows(() => Promise.resolve({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});
