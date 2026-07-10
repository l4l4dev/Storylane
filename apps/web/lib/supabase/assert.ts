/**
 * Throws on the first failed write in a batch of parallel Supabase updates
 * (TASK-22). `Promise.all` alone only rejects if a promise itself throws —
 * a Supabase update that fails (including one RLS silently filters to zero
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
