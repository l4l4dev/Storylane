import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Resolves once *a* reload settles — this call's own fetch if it gets to run, or whichever
   * later reload supersedes it first (a superseded call is treated as "confirmed by something
   * newer", never left hanging — see the callers using this for why that matters). Rejects only
   * if this call's own fetch is the one that actually failed. */
  reload: () => Promise<void>;
}

type Waiter = { resolve: () => void; reject: (e: unknown) => void };

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

  // Callers of `reload()` register here, keyed by the fetch key their call kicked off, so a
  // settle (or supersession) can find and notify exactly the right waiters.
  const waitersRef = useRef(new Map<string, Waiter[]>());

  useEffect(() => {
    if (path === null || key === null) return;
    let cancelled = false;
    const waiters = waitersRef.current;
    apiFetch<T>(path)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
        for (const waiter of waiters.get(key) ?? []) waiter.resolve();
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e);
        for (const waiter of waiters.get(key) ?? []) waiter.reject(e);
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(key);
        waiters.delete(key);
      });
    return () => {
      cancelled = true;
      // Torn down before its own fetch settled (unmounted, or superseded by a newer reload
      // before this one landed) — resolve any waiters rather than leave them hanging forever.
      // A superseded reload is still "confirmed by something newer" for a caller that only
      // cares that *a* refresh landed (see use-resource.ts's `reload` doc comment); a caller
      // that must react only to its own settle (not applicable here yet) would need a
      // different primitive.
      const stale = waiters.get(key);
      if (stale) {
        for (const waiter of stale) waiter.resolve();
        waiters.delete(key);
      }
    };
  }, [path, key]);

  const reload = useCallback((): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const nextNonce = nonce + 1;
      const nextKey = path === null ? null : `${path}#${nextNonce}`;
      if (nextKey === null) {
        resolve();
        return;
      }
      const list = waitersRef.current.get(nextKey) ?? [];
      list.push({ resolve, reject });
      waitersRef.current.set(nextKey, list);
      setNonce(nextNonce);
    });
  }, [path, nonce]);

  return { data, error, loading, reload };
}
