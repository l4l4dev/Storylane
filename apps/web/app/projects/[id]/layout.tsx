import { notFound, redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { getProject } from "@/lib/supabase/project-data";
import { fetchSidebarData } from "@/lib/supabase/sidebar-data";
import { AppSidebar } from "@/components/features/shell/app-sidebar";

// Shared shell for every project page. Fetches the navigation context once
// (current project, the switcher's project list, the signed-in username) so
// individual pages no longer re-declare their own nav link rows.
//
// TASK-147: this is the ONE choke point every /projects/[id]/* page shares
// (board, iterations, epics, activity, settings, and the bare-id redirect
// page), so it's also the single place to seal the hidden personal
// project's tracker surfaces — a direct URL to any of them redirects to
// /my-work instead of rendering. Scoped to the VIEWER'S OWN personal project
// (is_personal AND created_by = them, matching TASK-103's own check
// elsewhere): no one else can ever be a member of it (TASK-147 also locks
// invite_member/project_members to reject is_personal), so there is no other
// case to handle.
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
  } = await getUser();

  const [project, { projects, username }] = await Promise.all([
    getProject(id),
    fetchSidebarData(supabase, user?.id),
  ]);

  if (!project) {
    notFound();
  }

  if (project.is_personal && project.created_by === user?.id) {
    redirect("/my-work");
  }

  const isFavorite = projects.find((p) => p.id === project.id)?.isFavorite ?? false;

  return (
    <div className="flex min-h-dvh">
      <AppSidebar
        project={{
          id: project.id,
          name: project.name,
          isFavorite,
          isArchived: false,
        }}
        projects={projects}
        username={username}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
