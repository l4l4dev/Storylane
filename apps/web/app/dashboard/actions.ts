"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import { FREE_TEMPLATES, type FreeTemplate, type InviteSearchResult } from "@/lib/types";
import { clampVelocityWindow } from "@/lib/utils/velocity";

export type NewProjectInviteResult = InviteSearchResult;

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
// customizes them afterwards in Settings. Daily's Done column is the
// project's only is_done seed; Basic's Done is is_done too, since it's the
// same "cards land here when work is complete" column, just under a
// simpler three-column board.
//
// Not exported: a "use server" file may only export async functions — a
// plain object export here breaks the whole module ("A 'use server' file
// can only export async functions, found object").
// Order comes from the array order: custom_statuses.position is assigned by its
// sequence default, evaluated per row in VALUES order. Passing explicit
// positions here would leave the sequence behind the rows it never issued, and
// the next created column would land mid-board.
const FREE_TEMPLATE_STATUSES: Record<FreeTemplate, { name: string; color: string; is_done: boolean }[]> = {
  // No 'This week' seeded — users add it themselves as a normal custom
  // column if they want a weekly staging lane.
  daily: [
    { name: "Todo", color: "#6b7280", is_done: false },
    { name: "Today", color: "#f59e0b", is_done: false },
    { name: "In progress", color: "#3b82f6", is_done: false },
    { name: "Done", color: "#22c55e", is_done: true },
  ],
  basic: [
    { name: "To do", color: "#6b7280", is_done: false },
    { name: "Doing", color: "#3b82f6", is_done: false },
    { name: "Done", color: "#22c55e", is_done: true },
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
  const freeTemplateInput = String(formData.get("free_template") ?? "daily");
  const freeTemplate: FreeTemplate = FREE_TEMPLATES.includes(freeTemplateInput as FreeTemplate)
    ? (freeTemplateInput as FreeTemplate)
    : "daily";

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

  // Project + free-mode template columns commit together (TASK-58 AC#4): a
  // free project must never exist without board columns to drop onto.
  const { data: projectId, error } = await supabase.rpc("create_project", {
    p_name: name,
    p_description: description ?? undefined,
    p_iteration_length: iterationLength,
    p_point_scale: pointScale,
    p_velocity_window: velocityWindow,
    p_workflow_mode: workflowMode,
    p_statuses: workflowMode === "free" ? FREE_TEMPLATE_STATUSES[freeTemplate] : [],
  });

  if (error) {
    throw new Error(error.message);
  }

  // Invitations stay outside the transaction: a failed lookup must not undo the
  // project, so failures are counted and surfaced, not fatal.
  let failedInviteCount = 0;
  if (projectId) {
    for (const userId of invitedUserIds) {
      const { error: inviteError } = await supabase.rpc("invite_member", {
        p_project_id: projectId,
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
  // was an extra, pointless step. `projectId` is only ever null here if the
  // RPC somehow returned no id despite no error; falling back to /dashboard
  // keeps that (unreachable in practice) case from crashing.
  const target = projectId ? `/projects/${projectId}/board` : "/dashboard";
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
