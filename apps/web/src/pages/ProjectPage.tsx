import { useResource } from "../lib/use-resource";
import { errorMessage } from "../lib/api";

interface ProjectDetail {
  id: string;
  name: string;
  archivedAt: number | null;
  role: "owner" | "member" | "viewer";
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const project = useResource<ProjectDetail>(`/api/projects/${projectId}`);
  if (project.error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{errorMessage(project.error)}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl">{project.data?.name ?? "…"}</h1>
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>The project view arrives in step 2.</p>
    </main>
  );
}
