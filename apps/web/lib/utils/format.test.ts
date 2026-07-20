import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format";

describe("formatDate", () => {
  it("formats a date-only string as the wall date it names", () => {
    expect(formatDate("2026-08-11")).toBe("2026/8/11");
  });

  // The regression this guards: `new Date("2026-08-11")` is UTC midnight, so
  // local getters returned 2026/8/10 anywhere west of UTC. Reproduced under
  // TZ=America/Los_Angeles before the fix.
  it("does not shift a date-only string west of UTC", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/Los_Angeles";
      expect(formatDate("2026-08-11")).toBe("2026/8/11");
      expect(formatDate("2026-01-01")).toBe("2026/1/1");
    } finally {
      process.env.TZ = original;
    }
  });

  it("strips leading zeros from month and day", () => {
    expect(formatDate("2026-01-05")).toBe("2026/1/5");
  });

  it("still formats a Date instance in local time", () => {
    expect(formatDate(new Date(2026, 7, 11))).toBe("2026/8/11");
  });

  it("still formats a full timestamp string, which does carry a zone", () => {
    expect(formatDate("2026-08-11T15:30:00Z")).toMatch(/^2026\/8\/1[12]$/);
  });
});

describe("formatDateTime", () => {
  it("keeps the time component on a full timestamp", () => {
    expect(formatDateTime(new Date(2026, 7, 11, 9, 5))).toBe("2026/8/11 09:05");
  });
});
