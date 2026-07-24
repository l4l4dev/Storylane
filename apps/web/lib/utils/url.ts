/** Builds the pathname+query after removing `keys` from `searchParams` — bare pathname if none remain. */
export function withoutSearchParams(pathname: string, searchParams: URLSearchParams, keys: string[]): string {
  const params = new URLSearchParams(searchParams);
  keys.forEach((key) => params.delete(key));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
