import { useState } from "react";
import { Link, useRoute } from "wouter";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { buttonClass } from "./Field";

/**
 * The signed-in shell's top bar: a way back to the project list, the current project's name
 * when on its board, and sign-out. Fetches the project name itself (a small, separate request
 * from BoardPage's own project fetch) so it works from any route without threading state through
 * the router.
 */
export function Header({ onSignedOut }: { onSignedOut: () => void }) {
  const [onBoard, params] = useRoute("/projects/:id/board");
  const project = useResource<{ name: string }>(onBoard ? `/api/projects/${params!.id}` : null);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setError(null);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      // Still signed in: say so rather than leaving a button that looks like it did nothing.
      setError(errorMessage(e));
      return;
    }
    onSignedOut();
  }

  return (
    <header className="flex items-center justify-between border-b px-4 py-2 text-sm" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center gap-3">
        <Link href="/" className="font-medium hover:underline">
          Projects
        </Link>
        {onBoard && project.data && <span style={{ color: "var(--ink-muted)" }}>{project.data.name}</span>}
      </div>
      <div className="flex items-center gap-2">
        {error && (
          <span role="alert" className="text-xs" style={{ color: "var(--danger)" }}>
            {error}
          </span>
        )}
        <button type="button" className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
