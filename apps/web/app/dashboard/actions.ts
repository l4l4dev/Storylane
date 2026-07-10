"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FREE_TEMPLATES, type FreeTemplate } from "@/lib/types";

export type NewProjectInviteResult = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

/**
 * Backs the project-creation panel's invite picker (TASK-7) — exact-match
 * only, usable before a project row exists. See
 * supabase/migrations/20260713000001_search_users_for_new_project.sql for
 * why this can't reuse search_users_for_invite.
 */
export async function searchUserForNewProject(query: string): Promise<NewProjectInviteResult | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_users_for_new_project", { p_query: query });
  const match = data?.[0];
  if (!match) {
    return null;
  }
  return {
    id: match.id,
    username: match.username,
    displayName: match.display_name,
    avatarUrl: match.avatar_url,
  };
}

// Column templates seeded for a new free-mode project (TASK-16.1,
// spec/screens.md "Projects page" / "Free mode board") — the owner
// customizes them afterwards in Settings. KanbanFlow's Done column is the
// project's only is_done seed; Basic's Done is is_done too, since it's the
// same "cards land here when work is complete" column, just under a
// simpler three-column board.
//
// Not exported: a "use server" file may only export async functions — a
// plain object export here breaks the whole module ("A 'use server' file
// can only export async functions, found object").
const FREE_TEMPLATE_STATUSES: Record<FreeTemplate, { name: string; color: string; position: number; is_done: boolean }[]> = {
  kanbanflow: [
    { name: "Todo", color: "#6b7280", position: 0, is_done: false },
    { name: "This week", color: "#a855f7", position: 1, is_done: false },
    { name: "Today", color: "#f59e0b", position: 2, is_done: false },
    { name: "In progress", color: "#3b82f6", position: 3, is_done: false },
    { name: "Done", color: "#22c55e", position: 4, is_done: true },
  ],
  basic: [
    { name: "To do", color: "#6b7280", position: 0, is_done: false },
    { name: "Doing", color: "#3b82f6", position: 1, is_done: false },
    { name: "Done", color: "#22c55e", position: 2, is_done: true },
  ],
};

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const iterationLength = Number(formData.get("iteration_length") ?? 14);
  const pointScale = String(formData.get("point_scale") ?? "fibonacci");
  const velocityWindow = Number(formData.get("velocity_window") ?? 3);
  // Fixed at creation (Task 14 decision) — there is no mode-change path.
  const workflowMode = formData.get("workflow_mode") === "free" ? "free" : "tracker";
  const freeTemplateInput = String(formData.get("free_template") ?? "kanbanflow");
  const freeTemplate: FreeTemplate = FREE_TEMPLATES.includes(freeTemplateInput as FreeTemplate)
    ? (freeTemplateInput as FreeTemplate)
    : "kanbanflow";

  if (!name) {
    return;
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // TASK-7: ids come from a client-controlled hidden input (the picker's
  // selections) — dedupe, drop the caller's own id (the RPC itself also
  // excludes it, but invite_member's upsert would demote an included
  // creator from owner to member; this is defense in depth, not the only
  // guard), and cap so one submit can't fan out unbounded invite_member
  // calls.
  const invitedUserIds = [...new Set(formData.getAll("invited_user_ids").map(String))]
    .filter((id) => id && id !== user?.id)
    .slice(0, 20);

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      name,
      description,
      iteration_length: iterationLength,
      point_scale: pointScale,
      velocity_window: velocityWindow,
      workflow_mode: workflowMode,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (workflowMode === "free" && project) {
    const { error: statusError } = await supabase
      .from("custom_statuses")
      .insert(FREE_TEMPLATE_STATUSES[freeTemplate].map((status) => ({ ...status, project_id: project.id })));
    if (statusError) {
      throw new Error(statusError.message);
    }
  }

  let failedInviteCount = 0;
  if (project) {
    for (const userId of invitedUserIds) {
      const { error: inviteError } = await supabase.rpc("invite_member", {
        p_project_id: project.id,
        p_user_id: userId,
        p_role: "member",
      });
      if (inviteError) {
        failedInviteCount += 1;
      }
    }
  }

  revalidatePath("/dashboard");
  redirect(failedInviteCount > 0 ? `/dashboard?invite_failed=${failedInviteCount}` : "/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}
