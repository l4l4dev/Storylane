import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** `path === null` means "nothing to load yet" (e.g. no project selected). */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  // The key that finished loading most recently. `loading` is derived by comparing it against
  // the current key at render time, rather than toggled with a setState call inside the effect
  // (which the react-hooks `set-state-in-effect` rule flags as a synchronous derived-state effect).
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const key = path === null ? null : `${path}#${nonce}`;
  const loading = key !== null && key !== loadedKey;

  useEffect(() => {
    if (path === null || key === null) return;
    let cancelled = false;
    apiFetch<T>(path)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [path, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
