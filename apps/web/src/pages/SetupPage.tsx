import { useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass, Field, inputClass } from "../components/Field";

export function SetupPage({ onReady }: { onReady: () => void }) {
  const [form, setForm] = useState({ token: "", displayName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));
  const input = { className: inputClass, style: { borderColor: "var(--line)" } };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/setup", { method: "POST", body: form });
      onReady();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">Set up Storylane</h1>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field label="Setup token" hint="Printed once when the container started: docker logs <container>">
          <input {...input} autoComplete="off" value={form.token} onChange={set("token")} />
        </Field>
        <Field label="Your name">
          <input {...input} value={form.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Email">
          <input {...input} type="email" autoComplete="username" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" hint="At least 12 characters.">
          <input {...input} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">
          {busy ? "Creating…" : "Create admin"}
        </button>
        <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      </form>
    </main>
  );
}
