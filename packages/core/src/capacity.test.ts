import { describe, expect, it } from "vitest";
import capacityFixture from "../../../spec/fixtures/capacity.json";
import { projectCapacity, type CalendarException } from "./capacity";

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
