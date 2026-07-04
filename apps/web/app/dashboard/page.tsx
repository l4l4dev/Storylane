import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CreateProjectDialog } from "@/components/features/projects/create-project-dialog";
import { UsernameEditor } from "@/components/features/projects/username-editor";
import { Button } from "@/components/ui/button";
import { signOut } from "./actions";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: projects }, { data: profile }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, updated_at")
      .order("updated_at", { ascending: false }),
    user
      ? supabase.from("profiles").select("username").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <CreateProjectDialog />
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {profile && (
        <div className="mb-6">
          <UsernameEditor username={profile.username} />
        </div>
      )}

      {projects && projects.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li
              key={project.id}
              className="rounded-lg border border-border p-4 transition-colors hover:border-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/projects/${project.id}`} className="block flex-1">
                  <p className="font-medium">{project.name}</p>
                  {project.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
                  )}
                </Link>
                <Link
                  href={`/projects/${project.id}/settings`}
                  className="shrink-0 text-sm text-primary hover:underline"
                >
                  Settings
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No projects yet. Create your first one to get started.
        </p>
      )}
    </main>
  );
}
