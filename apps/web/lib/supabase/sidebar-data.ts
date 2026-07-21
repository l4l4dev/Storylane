import type { createClient } from "@/lib/supabase/server";
import type { ProjectRef } from "@/components/features/shell/app-sidebar";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Shared by every layout that renders AppSidebar (the per-project layout and
// the My Work layout) — the project-switcher list and the signed-in
// username are the same query regardless of which page is asking.
export async function fetchSidebarData(
  supabase: SupabaseServerClient,
  userId: string | undefined,
): Promise<{ projects: ProjectRef[]; username: string | null }> {
  // Same personal-project exclusion as the projects list (TASK-103 / doc-11
  // D1): hide the viewer's own "My Tasks" from the switcher, but keep a
  // personal project they were invited to (created_by someone else).
  const personalFilter = userId ? `is_personal.eq.false,created_by.neq.${userId}` : "is_personal.eq.false";
  const [{ data: projectRows }, { data: myMemberships }, { data: profile }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .is("archived_at", null)
      .or(personalFilter)
      .order("updated_at", { ascending: false }),
    userId
      ? supabase.from("project_members").select("project_id, is_favorite").eq("user_id", userId)
      : Promise.resolve({ data: null }),
    userId ? supabase.from("profiles").select("username").eq("id", userId).single() : Promise.resolve({ data: null }),
  ]);

  const favoriteProjectIds = new Set(
    (myMemberships ?? []).filter((m: { is_favorite: boolean }) => m.is_favorite).map((m: { project_id: string }) => m.project_id),
  );

  return {
    projects: (projectRows ?? []).map((p: { id: string; name: string }) => ({
      id: p.id,
      name: p.name,
      isFavorite: favoriteProjectIds.has(p.id),
      // The query above already excludes archived_at rows, but the switcher
      // filters this flag itself too (see app-sidebar.tsx) so that behavior
      // stays testable independent of this query.
      isArchived: false,
    })),
    username: (profile as { username: string } | null)?.username ?? null,
  };
}
