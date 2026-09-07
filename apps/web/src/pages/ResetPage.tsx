import { useState } from "react";
import { Link } from "wouter";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { buttonClass, Field, inputClass } from "../components/Field";

export function ResetPage({ token }: { token: string }) {
  const preview = useResource<{ email: string }>(`/api/auth/reset/${token}`);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/auth/reset/${token}`, { method: "POST", body: { password } });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (preview.loading) return <main className="p-6 text-sm">Checking the link…</main>;
  if ((preview.error || !preview.data) && !done) {
    return (
      <main className="p-6 text-sm" role="alert">
        This reset link is not valid any more. Ask an instance admin for a new one.
      </main>
    );
  }
  if (done) {
    // The server issues no session here on purpose: the new password is proven by signing in.
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
        <p className="text-sm">Password changed. Sign in with your new password.</p>
        <Link href="/login?reset=1" className="text-sm underline">Go to sign in</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">New password</h1>
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>for {preview.data!.email}</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field label="Password" hint="At least 12 characters.">
          <input
            className={inputClass}
            style={{ borderColor: "var(--line)" }}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">Set password</button>
        <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      </form>
    </main>
  );
}
