import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";

// Per-request memoized project reads (React cache() — see server.ts's
// getUser for why this is safe under Vitest too). The project layout, the
// board page, and the story detail panel all need the same project row or
// member list in one request; without this each re-runs its own query.

export const getProject = cache(async (id: string) => {
  const supabase = await createClient();
  return assertReadOk(
    await supabase
      .from("projects")
      .select(
        "id, name, is_personal, created_by, velocity_window, iteration_length, iteration_term, point_scale, custom_points, working_weekdays, definition_of_done",
      )
      .eq("id", id)
      .maybeSingle(),
  );
});

export const getProjectMembers = cache(async (projectId: string) => {
  const supabase = await createClient();
  return assertReadOk(
    await supabase
      .from("project_members")
      .select("user_id, role, profiles(display_name, is_agent)")
      .eq("project_id", projectId),
  );
});
