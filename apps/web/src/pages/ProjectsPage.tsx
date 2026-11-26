import { useState } from "react";
import { Link } from "wouter";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { buttonClass, Field, inputClass } from "../components/Field";

interface ProjectSummary {
  id: string;
  name: string;
  archivedAt: number | null;
  role: "owner" | "member" | "viewer";
}

export function ProjectsPage({ onOpen }: { onOpen: (projectId: string) => void }) {
  const projects = useResource<ProjectSummary[]>("/api/projects");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await apiFetch<ProjectSummary>("/api/projects", { method: "POST", body: { name } });
      // Principle 10: land in the thing that was just created.
      onOpen(created.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const rows = projects.data ?? [];
  const active = rows.filter((p) => p.archivedAt === null);
  const archived = rows.filter((p) => p.archivedAt !== null);

  const row = (project: ProjectSummary) => (
    <li key={project.id} className="border-b" style={{ borderColor: "var(--line)" }}>
      {/* A full row is the hit target, not just the text (principle 7). */}
      <Link href={`/projects/${project.id}`} className="flex items-center justify-between px-2 py-2 hover:bg-[var(--surface-2)]">
        <span>{project.name}</span>
        <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>{project.role}</span>
      </Link>
    </li>
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl">Projects</h1>
      {/* The create affordance sits with the list it adds to (principle 4). */}
      <form onSubmit={create} className="flex items-end gap-2">
        <Field label="Project name">
          <input className={inputClass} style={{ borderColor: "var(--line)" }} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button className={`${buttonClass} mb-5`} style={{ borderColor: "var(--line)" }} type="submit">Create project</button>
      </form>
      <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      {projects.loading ? <p className="text-sm">Loading…</p> : <ul className="border-t" style={{ borderColor: "var(--line)" }}>{active.map(row)}</ul>}
      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm" style={{ color: "var(--ink-muted)" }}>Archived</h2>
          <ul className="border-t" style={{ borderColor: "var(--line)" }}>{archived.map(row)}</ul>
        </section>
      )}
    </main>
  );
}
