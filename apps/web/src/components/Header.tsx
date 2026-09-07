import { Link, useRoute } from "wouter";
import { apiFetch } from "../lib/api";
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

  async function signOut() {
    await apiFetch("/api/auth/logout", { method: "POST" });
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
      <button type="button" className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={signOut}>
        Sign out
      </button>
    </header>
  );
}
