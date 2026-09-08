import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, apiFetch } from "./api";

export interface Me {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface SessionState {
  me: Me | null;
  setupRequired: boolean;
  loading: boolean;
  /**
   * Re-fetches /api/me and updates the cached session. Resolves for a normal "no session" 401
   * (`me` becomes null); rejects for anything else that goes wrong (5xx, a network error), so a
   * caller can await it and show its own error instead of proceeding on a session that failed
   * to reload.
   */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  // Only flipped true inside the mount effect's `.finally()` (never set synchronously in the
  // effect body), which is what keeps this out of the react-hooks `set-state-in-effect` rule.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const value = await apiFetch<Me>("/api/me");
      setMe(value);
      setSetupRequired(false);
    } catch (e) {
      setMe(null);
      // 409 setup_required is how the API says "this instance is brand new" (design §7).
      setSetupRequired(e instanceof ApiError && e.status === 409 && e.code === "setup_required");
      // 401 unauthenticated is /api/me's normal "no session" answer (already resolved above),
      // not a failed reload — e.g. ResetPage's own successful case revokes the session and
      // expects exactly this. Anything else (5xx, a network error) really did fail to reload
      // the session, so it propagates to the caller instead of being swallowed.
      if (e instanceof ApiError && e.status === 401) return;
      throw e;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Already reflected in `me`/`setupRequired` by `refresh` itself; the mount load has no
        // caller to propagate a rejection to.
        await refresh().catch(() => {});
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return <SessionContext.Provider value={{ me, setupRequired, loading: !loaded, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error("useSession must be used inside SessionProvider");
  return state;
}
