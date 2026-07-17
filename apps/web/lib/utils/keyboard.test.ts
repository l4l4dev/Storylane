import { describe, expect, it } from "vitest";
import type { KeyboardEvent } from "react";
import { isImeComposing } from "./keyboard";

function keyEvent(isComposing: boolean): KeyboardEvent<HTMLElement> {
  return { nativeEvent: { isComposing } } as KeyboardEvent<HTMLElement>;
}

describe("isImeComposing", () => {
  it("returns true during an active IME composition", () => {
    expect(isImeComposing(keyEvent(true))).toBe(true);
  });

  it("returns false outside composition", () => {
    expect(isImeComposing(keyEvent(false))).toBe(false);
  });
});
