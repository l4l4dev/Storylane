import { createClient } from "@/lib/supabase/server";
import { fetchSidebarData } from "@/lib/supabase/sidebar-data";
import { AppSidebar } from "@/components/features/shell/app-sidebar";

// Cross-project shell (spec/screens.md "Navigation") — same sidebar as
// my-work/layout.tsx (no current project: the switcher trigger reads
// "Projects" and the per-project section nav is omitted). The Projects list
// previously had no sidebar at all, losing the My Work nav link once a user
// navigated here.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { projects, username } = await fetchSidebarData(supabase, user?.id);

  return (
    <div className="flex min-h-dvh">
      <AppSidebar project={null} projects={projects} username={username} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
