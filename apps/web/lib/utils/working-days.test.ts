import { describe, expect, it } from "vitest";
import { parseWorkingWeekdays } from "./working-days";

describe("parseWorkingWeekdays", () => {
  it("sorts the submitted checkbox values", () => {
    expect(parseWorkingWeekdays(["5", "1", "3"])).toEqual([1, 3, 5]);
  });

  it("drops repeats, which capacity math would otherwise double-count", () => {
    expect(parseWorkingWeekdays(["2", "2", "3"])).toEqual([2, 3]);
  });

  it("drops values outside the ISO weekday range and non-numbers", () => {
    expect(parseWorkingWeekdays(["0", "8", "-1", "1.5", "abc", "4"])).toEqual([4]);
  });

  it("returns an empty array when nothing is selected, so the caller can reject it", () => {
    expect(parseWorkingWeekdays([])).toEqual([]);
  });
});
