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
  refresh: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [nonce, setNonce] = useState(0);
  // The nonce that finished loading most recently. `loading` is derived by comparing it against
  // the current nonce at render time, rather than toggled with a setState call inside the effect
  // (which the react-hooks `set-state-in-effect` rule flags as a synchronous derived-state effect).
  const [loadedNonce, setLoadedNonce] = useState<number | null>(null);
  const loading = loadedNonce !== nonce;

  useEffect(() => {
    let cancelled = false;
    apiFetch<Me>("/api/me")
      .then((value) => {
        if (!cancelled) {
          setMe(value);
          setSetupRequired(false);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMe(null);
        // 409 setup_required is how the API says "this instance is brand new" (design §7).
        setSetupRequired(e instanceof ApiError && e.status === 409 && e.code === "setup_required");
      })
      .finally(() => {
        if (!cancelled) setLoadedNonce(nonce);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return <SessionContext.Provider value={{ me, setupRequired, loading, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error("useSession must be used inside SessionProvider");
  return state;
}
