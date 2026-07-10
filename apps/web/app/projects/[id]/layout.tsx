import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/features/shell/app-sidebar";

// Shared shell for every project page. Fetches the navigation context once
// (current project, the switcher's project list, the signed-in username) so
// individual pages no longer re-declare their own nav link rows.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: project }, { data: projectRows }, { data: myMemberships }, { data: profile }] = await Promise.all([
    supabase.from("projects").select("id, name, workflow_mode").eq("id", id).single(),
    supabase
      .from("projects")
      .select("id, name")
      .is("archived_at", null)
      .order("updated_at", { ascending: false }),
    user
      ? supabase.from("project_members").select("project_id, is_favorite").eq("user_id", user.id)
      : Promise.resolve({ data: null }),
    user
      ? supabase.from("profiles").select("username").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const favoriteProjectIds = new Set(
    (myMemberships ?? []).filter((m) => m.is_favorite).map((m) => m.project_id),
  );
  const projects = (projectRows ?? []).map((p) => ({ ...p, isFavorite: favoriteProjectIds.has(p.id) }));

  if (!project) {
    notFound();
  }

  return (
    <div className="flex min-h-dvh">
      <AppSidebar
        project={{ ...project, isFavorite: favoriteProjectIds.has(project.id) }}
        projects={projects}
        username={profile?.username ?? null}
        // Free-mode projects have no iterations (Task 14) — hide that nav item.
        showIterations={project.workflow_mode !== "free"}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
