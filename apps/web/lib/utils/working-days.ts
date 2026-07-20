/**
 * ISO weekday numbers (1=Mon .. 7=Sun) for projects.working_weekdays, deduped
 * and sorted. The DB CHECK bounds the range but cannot reject a repeat, and a
 * repeated day would be counted twice by capacity math (spec/velocity.md).
 */
export function parseWorkingWeekdays(values: FormDataEntryValue[]): number[] {
  return [
    ...new Set(
      values
        .map((value) => Number(value))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
    ),
  ].sort((a, b) => a - b);
}
