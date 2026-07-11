/**
 * Throws on the first failed write in a batch of parallel Supabase updates.
 * `Promise.all` alone only rejects if a promise itself throws — a Supabase
 * update that fails (including one RLS silently filters to zero
 * rows) resolves normally with `{ error }` set, so an unchecked batch like
 * `Promise.all(ids.map(id => supabase.from(...).update(...).eq("id", id)))`
 * can partially apply and still look like a success to the caller.
 */
export async function assertAllSucceeded(
  results: ReadonlyArray<{ error: { message: string } | null }>,
): Promise<void> {
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw new Error(failed.error.message);
  }
}

/**
 * Same silent-failure class as `assertAllSucceeded`, but for a single
 * write whose row-count — not its `error` field — is the signal:
 * an `.update(...).eq("id", id).select("id")` on a row RLS filters out
 * resolves with `error: null` and `data: []`, not an error, so the caller
 * must check the row count itself to detect a no-op write.
 */
export async function assertRowAffected(
  result: { data: ReadonlyArray<unknown> | null; error: { message: string } | null },
  message = "No matching row found, or you don't have permission to modify it",
): Promise<void> {
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (!result.data || result.data.length === 0) {
    throw new Error(message);
  }
}
