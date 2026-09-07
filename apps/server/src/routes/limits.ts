import { HttpError } from "../http-error";

/**
 * Bounds on every free-text field a project member can write. The deployment target is one
 * container with one SQLite file, so an unbounded JSON body is unbounded `/data` growth; a
 * route-level bound also keeps the refusal a 400 with a code the SPA can render, rather than a
 * constraint failure surfacing as a 500.
 */
export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const TITLE_MAX = 200;
export const ACTION_LABEL_MAX = 40;

export function assertMaxLength(value: string, max: number, code: string): void {
  if (value.length > max) throw new HttpError(400, code);
}
