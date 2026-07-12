"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import { FREE_TEMPLATES, type FreeTemplate } from "@/lib/types";
import { clampVelocityWindow } from "@/lib/utils/velocity";

export type NewProjectInviteResult = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export type NewProjectInviteSearchResult =
  | { status: "found"; user: NewProjectInviteResult }
  | { status: "not_found" }
  | { status: "error"; message: string };

/**
 * Backs the project-creation panel's invite picker — exact-match only,
 * usable before a project row exists. See
 * supabase/migrations/20260713000001_search_users_for_new_project.sql for
 * why this can't reuse search_users_for_invite.
 *
 * Distinguishes an RPC error (e.g. a transient failure, or the "Not signed
 * in" exception) from a genuine no-match, so the UI can tell the two apart
 * instead of showing "no user found" for both.
 */
export async function searchUserForNewProject(query: string): Promise<NewProjectInviteSearchResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_users_for_new_project", { p_query: query });
  if (error) {
    return { status: "error", message: error.message };
  }
  const match = data?.[0];
  if (!match) {
    return { status: "not_found" };
  }
  return {
    status: "found",
    user: {
      id: match.id,
      username: match.username,
      displayName: match.display_name,
      avatarUrl: match.avatar_url,
    },
  };
}

// Column templates seeded for a new free-mode project (see
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
  const velocityWindow = clampVelocityWindow(Number(formData.get("velocity_window") ?? 3));
  // Fixed at creation — there is no mode-change path.
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

  // ids come from a client-controlled hidden input (the picker's
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
  // TASK-32: land on the new project's board instead of back on /dashboard
  // — creating a project and then having to find and click into it again
  // was an extra, pointless step. `project` is only ever null here if the
  // insert somehow returned no row despite no error; falling back to
  // /dashboard keeps that (unreachable in practice) case from crashing on
  // `project.id`.
  const target = project ? `/projects/${project.id}/board` : "/dashboard";
  redirect(failedInviteCount > 0 ? `${target}?invite_failed=${failedInviteCount}` : target);
}

export async function archiveProject(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id"));
  const supabase = await createClient();
  await assertRowAffected(
    await supabase
      .from("projects")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", projectId)
      .select("id"),
  );
  revalidatePath("/dashboard");
}

export async function unarchiveProject(formData: FormData): Promise<void> {
  const projectId = String(formData.get("project_id"));
  const supabase = await createClient();
  await assertRowAffected(
    await supabase.from("projects").update({ archived_at: null }).eq("id", projectId).select("id"),
  );
  revalidatePath("/dashboard");
}

/**
 * Best-effort — never throws. The picker/card calls this after an
 * optimistic UI update and reverts on `{ ok: false }` rather than crashing
 * the page ("surface RPC errors, don't swallow them" pattern, applied
 * here as a returned status instead of a thrown error since this
 * is called directly from a client event handler, not a `<form action>`).
 */
export async function toggleFavorite(projectId: string, favorite: boolean): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("toggle_project_favorite", {
    p_project_id: projectId,
    p_favorite: favorite,
  });
  if (error) {
    return { ok: false };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}
