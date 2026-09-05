import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Counts the authorizations that actually happened while serving one request.
 * Only authorizeIn increments it, so the fail-closed check cannot be satisfied
 * by a handler that asserts its own innocence.
 */
export const authzScope = new AsyncLocalStorage<{ authorized: number }>();

/** No store (CLI, worker, tests calling withProject directly) → nothing to count. */
export function noteAuthorized(): void {
  const store = authzScope.getStore();
  if (store) store.authorized += 1;
}
