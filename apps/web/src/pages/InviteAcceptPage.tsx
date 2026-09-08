import { useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useSession } from "../lib/session";
import { buttonClass, Field, inputClass } from "../components/Field";

interface InvitePreview {
  projectId: string;
  projectName: string;
  role: "owner" | "member" | "viewer";
}

/** Accepting while signed in joins; while signed out it registers and joins (design §7). */
export function InviteAcceptPage({ token, onJoined }: { token: string; onJoined: (projectId: string) => void }) {
  const { me, refresh } = useSession();
  const preview = useResource<InvitePreview>(`/api/invites/${token}`);
  const [form, setForm] = useState({ email: "", displayName: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  async function accept(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    try {
      const joined = await apiFetch<InvitePreview>(`/api/invites/${token}/accept`, {
        method: "POST",
        body: me ? {} : form,
      });
      // The anonymous branch just minted a session cookie; the signed-in branch may have just
      // joined a first project. Either way the session provider's cached `me` is stale.
      await refresh();
      onJoined(joined.projectId);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (preview.loading) return <main className="p-6 text-sm">Checking the invitation…</main>;
  if (preview.error || !preview.data) {
    return (
      <main className="p-6 text-sm" role="alert">
        This invitation is not valid any more. Ask for a new link.
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">Join {preview.data.projectName}</h1>
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        You are invited as <strong>{preview.data.role}</strong>.
      </p>
      {me ? (
        <>
          <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => void accept()}>
            Join as {me.displayName}
          </button>
          <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
        </>
      ) : (
        <form onSubmit={accept} className="flex flex-col gap-2">
          <Field label="Your name">
            <input className={inputClass} style={{ borderColor: "var(--line)" }} autoComplete="name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className={inputClass} style={{ borderColor: "var(--line)" }} type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" hint="At least 12 characters.">
            <input className={inputClass} style={{ borderColor: "var(--line)" }} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">Create account and join</button>
          <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
        </form>
      )}
    </main>
  );
}
