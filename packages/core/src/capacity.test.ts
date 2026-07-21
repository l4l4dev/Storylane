import { describe, expect, it } from "vitest";
import capacityFixture from "../../../spec/fixtures/capacity.json";
import { nextWorkingDay, projectCapacity, type CalendarException } from "./capacity";

describe("projectCapacity (spec/fixtures/capacity.json)", () => {
  for (const testCase of capacityFixture.cases) {
    it(testCase.name, () => {
      expect(
        projectCapacity({
          workingWeekdays: testCase.working_weekdays,
          exceptions: testCase.exceptions as CalendarException[],
          members: testCase.members.map((m) => ({ role: m.role, timeOff: m.time_off })),
          start: testCase.start,
          end: testCase.end,
        }),
      ).toBe(testCase.expected);
    });
  }
});

describe("nextWorkingDay", () => {
  const MON_FRI = [1, 2, 3, 4, 5];

  it("returns the day itself when it already works", () => {
    expect(nextWorkingDay(MON_FRI, [], "2026-07-17")).toBe("2026-07-17");
  });

  it("skips the weekend", () => {
    expect(nextWorkingDay(MON_FRI, [], "2026-07-18")).toBe("2026-07-20");
  });

  it("skips a project holiday", () => {
    expect(nextWorkingDay(MON_FRI, [{ date: "2026-07-20", kind: "holiday" }], "2026-07-18")).toBe("2026-07-21");
  });

  it("lands on an extra workday", () => {
    expect(nextWorkingDay(MON_FRI, [{ date: "2026-07-18", kind: "extra_workday" }], "2026-07-18")).toBe("2026-07-18");
  });

  it("returns null when a whole year has no working day", () => {
    expect(nextWorkingDay([], [], "2026-07-17")).toBeNull();
  });
});
