import Link from "next/link";

// TASK-133 (doc-14): surfaced on My Work (not project-side) when a project's
// configured Doing/Done mapping has drifted — the owner mapped a state, then
// later changed its category away from what that column expects. One line
// per affected project, each linking to that project's own Settings page
// (spec/ux-principles.md principle 8: "stay put and offer a link").
export function MyWorkMappingBrokenBanner({ projects }: { projects: { id: string; name: string }[] }) {
  if (projects.length === 0) return null;

  return (
    <div className="mx-auto mb-4 flex max-w-3xl flex-col gap-1 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {projects.map((project) => (
        <p key={project.id}>
          {project.name}&apos;s Doing/Done sync is no longer valid —{" "}
          <Link href={`/projects/${project.id}/settings`} className="underline">
            reconfigure in Settings
          </Link>
          .
        </p>
      ))}
    </div>
  );
}
