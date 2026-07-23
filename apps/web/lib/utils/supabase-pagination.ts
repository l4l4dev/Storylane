// PostgREST caps any unbounded select at max_rows (supabase/config.toml,
// currently 1000) and silently truncates past it — no error, just missing
// rows. Any query whose result count isn't already bounded by something else
// (a small lookup table, a date window that can't realistically exceed the
// cap, etc.) needs to page through with .range() instead of relying on a
// single unbounded select.
const MAX_ROWS = 1000;

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await fetchPage(from, from + MAX_ROWS - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < MAX_ROWS) return rows;
    from += MAX_ROWS;
  }
}
