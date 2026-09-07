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

export async function hashPassword(plain: string, params: Argon2Params = ARGON2_PARAMS): Promise<string> {
  return Bun.password.hash(plain, params);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    // A malformed stored hash must read as "wrong password", not as a 500.
    return false;
  }
}

/** Length only — no composition rules (design §4). */
export function assertPasswordAcceptable(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, "password_too_short");
}
