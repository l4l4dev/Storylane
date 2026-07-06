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

  const [{ data: project }, { data: projects }, { data: profile }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", id).single(),
    supabase.from("projects").select("id, name").order("updated_at", { ascending: false }),
    user
      ? supabase.from("profiles").select("username").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  if (!project) {
    notFound();
  }

  return (
    <div className="flex min-h-dvh">
      <AppSidebar project={project} projects={projects ?? []} username={profile?.username ?? null} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
