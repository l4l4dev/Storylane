"use client";

import { useMemo, useRef } from "react";

/**
 * Shared debounced-callback pattern (story-detail-panel's field autosave,
 * invite-member-form's search-as-you-type): `trigger(fn)` (re)starts a
 * `delay`-ms timer that calls `fn` when it elapses; `cancel()` clears any
 * pending timer without running it. Every caller already needs both halves —
 * flush-now is `cancel()` then call the fn yourself, discard is just `cancel()`.
 *
 * Returns a referentially stable object (memoized on `delay`) so a caller can
 * safely list it in an effect's dependency array without the effect re-firing
 * every render.
 */
export function useDebouncedCallback(delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  return useMemo(
    () => ({
      trigger: (fn: () => void) => {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(fn, delay);
      },
      cancel: () => {
        clearTimeout(timeoutRef.current);
      },
    }),
    [delay],
  );
}
