import { useState } from "react";
import { useSearch } from "wouter";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass, Field, inputClass } from "../components/Field";

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const search = useSearch();
  const justReset = new URLSearchParams(search).get("reset") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/auth/login", { method: "POST", body: { email, password } });
      onSignedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">Storylane</h1>
      {justReset && (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          Password changed. Sign in with your new password.
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2" style={{ borderColor: "var(--line)" }}>
        <Field label="Email">
          <input className={inputClass} style={{ borderColor: "var(--line)" }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className={inputClass} style={{ borderColor: "var(--line)" }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {/* Never disabled: a visible action is pressable and says what happened (principle 1). */}
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>
          {error ?? ""}
        </p>
      </form>
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        Forgot your password? An instance admin can send you a one-time reset link.
      </p>
    </main>
  );
}
