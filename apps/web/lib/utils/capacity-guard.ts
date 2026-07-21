// TASK-100: PostgREST caps how many rows a single select returns (db-max-rows)
// with no error and no signal — rows past the cap are just missing from
// `data`. For project_calendar_exceptions / user_time_off, missing rows read
// as "no holiday, nobody away", which INFLATES capacity and over-commits the
// team (the same failure direction TASK-86 guarded against for query errors).
// A `count: "exact"` request reports the true match count regardless of the
// cap, so comparing it against what `data` actually holds is the only signal
// available before truncation blends into "no exceptions found".

/** True when a `{ count: "exact" }` read returned fewer rows than it matched. */
export function readWasTruncated(count: number | null, dataLength: number): boolean {
  return count !== null && count > dataLength;
}
