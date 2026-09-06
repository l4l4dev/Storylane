import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Counts the authorizations that actually happened while serving one request.
 * Only authorizeIn increments it, so the fail-closed check cannot be satisfied
 * by a handler that asserts its own innocence. Module-private: callers get at
 * it only through noteAuthorized/runAuthzScope below.
 */
const authzScope = new AsyncLocalStorage<{ authorized: number }>();

/** No store (CLI, worker, tests calling withProject directly) → nothing to count. */
export function noteAuthorized(): void {
  const store = authzScope.getStore();
  if (store) store.authorized += 1;
}

/** Runs fn inside a fresh authorization-tracking scope and reports how many authorizations happened. */
export async function runAuthzScope<T>(fn: () => Promise<T>): Promise<{ result: T; authorized: number }> {
  const store = { authorized: 0 };
  const result = await authzScope.run(store, fn);
  return { result, authorized: store.authorized };
}
