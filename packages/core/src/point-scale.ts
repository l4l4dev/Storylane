/**
 * Tracker stores the scale as the comma-separated string itself and exposes
 * `point_scale_is_custom` rather than an enum (core-model §2.2): the set of built-ins is
 * explicitly outside its API version contract, so the string is the data and the built-in list
 * is only a display hint.
 */
export const BUILT_IN_POINT_SCALES: readonly string[] = ["0,1,2,3", "0,1,2,4,8", "0,1,2,3,5,8"];

export function parsePointScale(raw: string): number[] {
  const parts = raw.split(",");
  if (raw.length === 0 || parts.length === 0) throw new RangeError("point scale is empty");
  const values = parts.map((part) => {
    if (part.length === 0 || !/^\d+(\.\d+)?$/.test(part)) throw new RangeError(`point scale value ${part} is not a non-negative number`);
    return Number(part);
  });
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) throw new RangeError("point scale must be strictly ascending");
  }
  return values;
}

export function isCustomPointScale(raw: string): boolean {
  return !BUILT_IN_POINT_SCALES.includes(raw);
}

export function isAllowedEstimate(estimate: number | null, scale: readonly number[]): boolean {
  if (estimate === null) return true;
  return scale.includes(estimate);
}

/** A tie rounds down: moving 0,1,2,3,5,8 → 0,1,2,4,8 must not inflate an estimate. */
export function nearestOnScale(value: number, scale: readonly number[]): number {
  let best = scale[0]!;
  let bestDistance = Math.abs(value - best);
  for (const candidate of scale.slice(1)) {
    const distance = Math.abs(value - candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
