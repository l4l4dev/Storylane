import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CreateProjectDialog } from "@/components/features/projects/create-project-dialog";
import { signOut } from "./actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, description, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <CreateProjectDialog />
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-zinc-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {projects && projects.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li
              key={project.id}
              className="rounded-lg border border-gray-200 p-4 hover:border-indigo-400 dark:border-gray-800"
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/projects/${project.id}`} className="block flex-1">
                  <p className="font-medium">{project.name}</p>
                  {project.description && (
                    <p className="mt-1 text-sm text-gray-500">{project.description}</p>
                  )}
                </Link>
                <Link
                  href={`/projects/${project.id}/settings`}
                  className="shrink-0 text-sm text-indigo-600 hover:underline"
                >
                  Settings
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">
          No projects yet. Create your first one to get started.
        </p>
      )}
    </main>
  );
}
