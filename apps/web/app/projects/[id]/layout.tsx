import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchSidebarData } from "@/lib/supabase/sidebar-data";
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

  const [{ data: project }, { projects, username }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", id).single(),
    fetchSidebarData(supabase, user?.id),
  ]);

  if (!project) {
    notFound();
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
