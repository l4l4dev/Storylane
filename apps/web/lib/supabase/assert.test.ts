import { describe, expect, it } from "vitest";
import { assertAllSucceeded, assertRowAffected } from "./assert";

describe("assertAllSucceeded", () => {
  it("resolves without throwing when every result has no error", async () => {
    await expect(
      assertAllSucceeded([{ error: null }, { error: null }]),
    ).resolves.toBeUndefined();
  });

  it("throws with the first failed result's message when any result has an error", async () => {
    await expect(
      assertAllSucceeded([
        { error: null },
        { error: { message: "row not found" } },
        { error: { message: "second failure" } },
      ]),
    ).rejects.toThrow("row not found");
  });
});

describe("assertRowAffected", () => {
  it("resolves without throwing when the result has no error and at least one row", async () => {
    await expect(
      assertRowAffected({ data: [{ id: "row-1" }], error: null }),
    ).resolves.toBeUndefined();
  });

  it("throws the result's error message when the write itself failed", async () => {
    await expect(
      assertRowAffected({ data: null, error: { message: "connection reset" } }),
    ).rejects.toThrow("connection reset");
  });

  it("throws a default message when there is no error but zero rows were affected (RLS silently filtered)", async () => {
    await expect(assertRowAffected({ data: [], error: null })).rejects.toThrow();
  });

  it("accepts a custom message for the zero-rows case", async () => {
    await expect(
      assertRowAffected({ data: [], error: null }, "Not allowed"),
    ).rejects.toThrow("Not allowed");
  });
});
