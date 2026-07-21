"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import type { InviteSearchResult } from "@/lib/types";
import { STATE_TEMPLATES } from "@/lib/types";
import { clampIterationLength, clampVelocityWindow } from "@storylane/core";

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

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const iterationLength = clampIterationLength(Number(formData.get("iteration_length") ?? 14));
  // Free text (doc-8 §5), never blank: the DB CHECK rejects an empty term and
  // the headings that render it would have nothing to show. Same rule as
  // settings/actions.ts updateProject.
  const iterationTerm = String(formData.get("iteration_term") ?? "").trim().slice(0, 30) || "Iteration";
  const pointScale = String(formData.get("point_scale") ?? "fibonacci");
  const velocityWindow = clampVelocityWindow(Number(formData.get("velocity_window") ?? 3));
  const rawTemplate = String(formData.get("state_template") ?? "classic");
  // Falls back to the column default ('classic') for anything unrecognized
  // rather than passing a tampered/stale value straight to the insert.
  const stateTemplate = STATE_TEMPLATES.includes(rawTemplate as (typeof STATE_TEMPLATES)[number])
    ? rawTemplate
    : "classic";

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
      iteration_term: iterationTerm,
      point_scale: pointScale,
      velocity_window: velocityWindow,
      state_template: stateTemplate,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  // Invitations stay outside the transaction: a failed lookup must not undo the
  // project, so failures are counted and surfaced, not fatal.
  let failedInviteCount = 0;
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

  revalidatePath("/dashboard");
  // TASK-32: land on the new project's board instead of back on /dashboard
  // — creating a project and then having to find and click into it again
  // was an extra, pointless step.
  const target = `/projects/${project.id}/board`;
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
