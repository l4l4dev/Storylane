import { HttpError } from "../http-error";

export interface Argon2Params {
  algorithm: "argon2id";
  /** KiB — design §4 asks for 64 MiB. */
  memoryCost: number;
  timeCost: number;
}

/**
 * Bun.password exposes memoryCost and timeCost only; argon2id's parallelism is fixed by the
 * implementation, so design §4's "parallelism 1" is not a knob we can set here.
 */
export const ARGON2_PARAMS: Argon2Params = { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 };

export const MIN_PASSWORD_LENGTH = 12;
/**
 * Argon2's cost grows with the input, so an unbounded password is a cheap way to make the
 * server spend 64 MiB and seconds of CPU per request. 1024 is far above any real passphrase.
 */
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * Each in-flight hash holds ARGON2_PARAMS.memoryCost (64 MiB); an unthrottled login burst would
 * be an out-of-memory switch on the small home server this targets. Requests past the cap wait
 * for a slot instead of allocating.
 */
export const KDF_MAX_CONCURRENCY = 4;

let inFlight = 0;
let peak = 0;
const waiting: Array<() => void> = [];

/** Diagnostics for KDF saturation; `peak` is also what the concurrency test asserts on. */
export function kdfStats(): { inFlight: number; peak: number } {
  return { inFlight, peak };
}

export function resetKdfPeak(): void {
  peak = inFlight;
}

async function withKdfSlot<T>(run: () => Promise<T>): Promise<T> {
  // The slot is handed straight from a finishing call to the next waiter without passing
  // through inFlight--: decrementing first would let a caller arriving in that window take a
  // fifth slot before the woken waiter resumes.
  if (inFlight < KDF_MAX_CONCURRENCY) inFlight++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  if (inFlight > peak) peak = inFlight;
  try {
    return await run();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }
}

export async function hashPassword(plain: string, params: Argon2Params = ARGON2_PARAMS): Promise<string> {
  // Enforced here and not only at the route: nothing may reach the KDF, or the users table,
  // without having passed the bounds.
  assertPasswordAcceptable(plain);
  return withKdfSlot(() => Bun.password.hash(plain, params));
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await withKdfSlot(() => Bun.password.verify(plain, hash));
  } catch {
    // A malformed stored hash must read as "wrong password", not as a 500.
    return false;
  }
}

/** Length only — no composition rules (design §4). */
export function assertPasswordAcceptable(plain: string): void {
  // Code points, not UTF-16 units: an emoji passphrase must not be counted twice per character.
  const length = [...plain].length;
  if (length < MIN_PASSWORD_LENGTH) throw new HttpError(400, "password_too_short");
  if (length > MAX_PASSWORD_LENGTH) throw new HttpError(400, "password_too_long");
}
