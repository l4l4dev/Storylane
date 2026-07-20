import { createClient } from "@/lib/supabase/server";
import { fetchSidebarData } from "@/lib/supabase/sidebar-data";
import { AppSidebar } from "@/components/features/shell/app-sidebar";

// Cross-project shell (spec/screens.md "Navigation") — same sidebar as the
// per-project layout, but with no current project: the switcher trigger
// reads "My Work" and the per-project section nav is omitted.
export default async function MyWorkLayout({ children }: { children: React.ReactNode }) {
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
