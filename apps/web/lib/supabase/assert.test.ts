import { describe, expect, it } from "vitest";
import { assertAllSucceeded } from "./assert";

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
