import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The project ids authorized while serving one request. Only authorizeIn writes to it,
 * so a handler cannot assert its own innocence. Module-private: reachable only through
 * noteAuthorized / runAuthzScope.
 */
const authzScope = new AsyncLocalStorage<{ authorized: Set<string> }>();

/** No store (CLI, worker, a test calling withProject directly) → nothing to record. */
export function noteAuthorized(projectId: string): void {
  authzScope.getStore()?.authorized.add(projectId);
}

export async function runAuthzScope<T>(fn: () => Promise<T>): Promise<{ result: T; authorized: ReadonlySet<string> }> {
  const store = { authorized: new Set<string>() };
  const result = await authzScope.run(store, fn);
  return { result, authorized: store.authorized };
}
