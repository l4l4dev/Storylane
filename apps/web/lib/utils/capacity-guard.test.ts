import { describe, expect, it } from "vitest";
import { readWasTruncated } from "./capacity-guard";

describe("readWasTruncated", () => {
  it("is false when the returned rows match the exact count", () => {
    expect(readWasTruncated(3, 3)).toBe(false);
  });

  it("is false for an empty, uncapped result", () => {
    expect(readWasTruncated(0, 0)).toBe(false);
  });

  // The failure this guards against: PostgREST's row cap silently drops rows
  // past its limit with no error, so `data.length` alone can't tell a
  // complete read apart from a truncated one — the exact count is the only
  // signal.
  it("is true when PostgREST's row cap dropped rows the count still reports", () => {
    expect(readWasTruncated(1500, 1000)).toBe(true);
  });

  it("is false when count is unavailable (not requested) — nothing to compare", () => {
    expect(readWasTruncated(null, 5)).toBe(false);
  });
});
