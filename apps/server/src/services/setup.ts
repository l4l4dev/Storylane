import type { Db } from "../db/client";
import { users } from "../db/schema";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { clearSetupToken, setupTokenMatches } from "../setup/setup-token";

export interface SetupInput {
  token: string;
  email: string;
  displayName: string;
  /** Already hashed by the route: a transaction cannot await (design §5). */
  passwordHash: string;
}

/**
 * BEGIN IMMEDIATE plus a "no users yet" check inside the same transaction: SQLite has one
 * writer, so the second of two concurrent submissions sees the first admin and is refused.
 */
export function completeSetup(db: Db, input: SetupInput, now = Date.now()): { userId: string } {
  return db.transaction(
    (tx) => {
      const existing = tx.select({ id: users.id }).from(users).limit(1).get();
      if (existing) throw new HttpError(404, "not_found");
      if (!setupTokenMatches(tx, input.token, now)) throw new HttpError(403, "setup_token_invalid");
      const userId = newId();
      tx.insert(users)
        .values({
          id: userId,
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          isAdmin: true,
          createdAt: now,
        })
        .run();
      clearSetupToken(tx);
      return { userId };
    },
    { behavior: "immediate" },
  );
}
