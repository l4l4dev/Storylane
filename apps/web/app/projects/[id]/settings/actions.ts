"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import { clampVelocityWindow } from "@storylane/core";
import { formatDate } from "@/lib/utils/format";
import { parseWorkingWeekdays } from "@/lib/utils/working-days";
import type { InviteSearchResult } from "@/lib/types";

export type { InviteSearchResult } from "@/lib/types";

export type InviteState = { error?: string; success?: string };

/**
 * Backs the invite picker's search box (spec/features.md "Invite members
 * by user search") — thin wrapper around the search_users_for_invite RPC,
 * which enforces the 2-char minimum, the cap, and excludes existing
 * project members server-side.
 */
export async function searchUsersForInvite(
  projectId: string,
  query: string,
): Promise<InviteSearchResult[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_users_for_invite", {
    p_query: query,
    p_project_id: projectId,
  });

  return (data ?? []).map((u) => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
  }));
}

export async function updateProject(formData: FormData) {
  const id = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const iterationLength = Number(formData.get("iteration_length") ?? 14);
  const pointScale = String(formData.get("point_scale") ?? "fibonacci");
  const velocityWindow = clampVelocityWindow(Number(formData.get("velocity_window") ?? 3));

  if (!name) {
    return;
  }

  const supabase = await createClient();
  await assertRowAffected(
    await supabase
      .from("projects")
      .update({
        name,
        description,
        iteration_length: iterationLength,
        point_scale: pointScale,
        velocity_window: velocityWindow,
      })
      .eq("id", id)
      .select("id"),
  );
  revalidatePath(`/projects/${id}/settings`);
}

export async function inviteMember(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const id = String(formData.get("project_id"));
  const userId = String(formData.get("user_id") ?? "");
  const displayName = String(formData.get("display_name") ?? "member");
  const role = String(formData.get("role") ?? "member");

  if (!userId) {
    return { error: "Search for and select a user to invite" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member", {
    p_project_id: id,
    p_user_id: userId,
    p_role: role,
  });

  if (error) {
    return { error: error.message };
  }
  revalidatePath(`/projects/${id}/settings`);
  return { success: `Added ${displayName}` };
}

// Membership admin must use these RPCs because direct table writes are denied
// and the RPCs enforce the last-owner invariant. Their state results let the
// settings UI surface that error inline (spec/ux-principles.md #2).
export type MemberActionState = { error?: string };

export async function updateMemberRole(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const id = String(formData.get("project_id"));
  const userId = String(formData.get("user_id"));
  const role = String(formData.get("role"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("change_member_role", {
    p_project_id: id,
    p_user_id: userId,
    p_role: role,
  });

  if (error) {
    return { error: error.message };
  }
  revalidatePath(`/projects/${id}/settings`);
  return {};
}

export async function removeMember(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const id = String(formData.get("project_id"));
  const userId = String(formData.get("user_id"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", {
    p_project_id: id,
    p_user_id: userId,
  });

  if (error) {
    return { error: error.message };
  }
  revalidatePath(`/projects/${id}/settings`);
  return {};
}

export async function createLabel(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#6b7280");

  if (!name) {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("labels").insert({ project_id: projectId, name, color });

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}

export async function deleteLabel(formData: FormData) {
  const id = String(formData.get("label_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  await assertRowAffected(
    await supabase.from("labels").delete().eq("id", id).eq("project_id", projectId).select("id"),
  );
  revalidatePath(`/projects/${projectId}/settings`);
}

/**
 * Working-day calendar (doc-8 §6). These feed capacity/velocity math only —
 * nothing here may move an iteration's start or end date.
 */
export type WorkingWeekdaysState = { error?: string; success?: string };

export async function updateWorkingWeekdays(
  _prev: WorkingWeekdaysState,
  formData: FormData,
): Promise<WorkingWeekdaysState> {
  const projectId = String(formData.get("project_id"));
  const weekdays = parseWorkingWeekdays(formData.getAll("weekday"));

  // A project with no working days has zero capacity every sprint, which
  // breaks planning and TASK-87's 1-day start-date selection. The DB CHECK
  // only bounds the range, so the guard lives here.
  if (weekdays.length === 0) {
    return { error: "Select at least one working day." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ working_weekdays: weekdays })
    .eq("id", projectId)
    .select("id");

  if (error) {
    return { error: error.message };
  }
  // RLS makes a non-owner's update a silent zero-row no-op rather than an error.
  if (!data || data.length === 0) {
    return { error: "Only the project owner can change working days." };
  }
  revalidatePath(`/projects/${projectId}/settings`);
  return { success: "Saved." };
}

export type CalendarExceptionState = { error?: string };

const CALENDAR_EXCEPTION_KINDS = ["holiday", "extra_workday"] as const;

export async function createCalendarException(
  _prev: CalendarExceptionState,
  formData: FormData,
): Promise<CalendarExceptionState> {
  const projectId = String(formData.get("project_id"));
  const date = String(formData.get("date") ?? "");
  const kind = String(formData.get("kind") ?? "");

  if (!date) {
    return { error: "Pick a date." };
  }
  if (!CALENDAR_EXCEPTION_KINDS.includes(kind as (typeof CALENDAR_EXCEPTION_KINDS)[number])) {
    return { error: "Pick a kind." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_calendar_exceptions")
    .insert({ project_id: projectId, date, kind });

  if (error) {
    // One exception per date by construction — editing means replacing.
    if (error.code === "23505") {
      return { error: `${formatDate(date)} already has an exception. Remove it first.` };
    }
    return { error: error.message };
  }
  revalidatePath(`/projects/${projectId}/settings`);
  return {};
}

export async function deleteCalendarException(formData: FormData) {
  const id = String(formData.get("exception_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  await assertRowAffected(
    await supabase
      .from("project_calendar_exceptions")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id"),
  );
  revalidatePath(`/projects/${projectId}/settings`);
}

const STATE_CATEGORIES = ["unstarted", "in_progress", "done", "rejected"] as const;

/**
 * Adds a new state (doc-8 §2's board-level "+ Add column" reuses this same
 * action). Lands at the end of its own category's block, not the whole
 * project's position sequence — see create_project_state
 * (20260719000014) for why a plain append-to-end broke computeStateGate's
 * per-category contiguity assumption.
 */
export async function createProjectState(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "");

  if (!name || !STATE_CATEGORIES.includes(category as (typeof STATE_CATEGORIES)[number])) {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_project_state", {
    p_project_id: projectId,
    p_name: name,
    p_category: category,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

export async function renameProjectState(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const stateId = String(formData.get("state_id"));
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return;
  }

  const supabase = await createClient();
  await assertRowAffected(
    await supabase.from("project_states").update({ name }).eq("id", stateId).eq("project_id", projectId).select("id"),
  );
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * The button label a story sitting in this state shows for its own advance
 * action (spec/data-model.md "Transitions") — nullable; a blank field clears
 * it, which `computeStateGate` (packages/core) treats as "no manual advance
 * button here" rather than falling back to any default text.
 */
export async function updateProjectStateActionLabel(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const stateId = String(formData.get("state_id"));
  const actionLabel = String(formData.get("action_label") ?? "").trim() || null;

  const supabase = await createClient();
  await assertRowAffected(
    await supabase
      .from("project_states")
      .update({ action_label: actionLabel })
      .eq("id", stateId)
      .eq("project_id", projectId)
      .select("id"),
  );
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

/** Swaps this state with its nearest same-category neighbour (up/down arrows) — see reorder_project_state (20260719000013). */
export async function reorderProjectState(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const stateId = String(formData.get("state_id"));
  const direction = String(formData.get("direction"));
  if (direction !== "up" && direction !== "down") {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_project_state", {
    p_project_id: projectId,
    p_state_id: stateId,
    p_direction: direction,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

export type ProjectStateActionState = { error?: string };

/**
 * Deletion is plain-FK blocked while any story points at the state, and a
 * trigger blocks removing a category's last row (spec/data-model.md
 * "Integrity rules") — both surface as an inline message here (the
 * custom_statuses precedent) instead of a thrown 500, since either is a
 * routine, expected outcome of clicking delete on the wrong state, not a
 * bug.
 */
export async function deleteProjectState(
  _prev: ProjectStateActionState,
  formData: FormData,
): Promise<ProjectStateActionState> {
  const projectId = String(formData.get("project_id"));
  const stateId = String(formData.get("state_id"));

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("project_states")
    .delete()
    .eq("id", stateId)
    .eq("project_id", projectId)
    .select("id");

  if (error) {
    if (error.code === "23503") {
      return { error: "Move the stories off this state before deleting it." };
    }
    return { error: error.message };
  }
  if (!data || data.length === 0) {
    return { error: "State not found." };
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
  return {};
}

const INTEGRATION_PROVIDERS = ["github", "forgejo", "slack"] as const;
type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * Creates or updates a project's integration for one provider (see
 * spec/integrations.md for the config shape per provider). RLS limits this
 * to project owners; one row per (project_id, provider).
 *
 * webhook_secret lives in its own column, not `config` — authenticated has no
 * SELECT on it (TASK-63), so it is set/rotate-only: a blank field on edit keeps
 * the stored secret (the column is simply omitted from the upsert payload, and
 * PostgREST leaves unlisted columns untouched — no read-back needed).
 */
export async function saveIntegration(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const provider = String(formData.get("provider")) as IntegrationProvider;
  const isActive = formData.get("is_active") === "on";

  if (!INTEGRATION_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const supabase = await createClient();

  if (provider === "slack") {
    const webhookUrl = String(formData.get("webhook_url") ?? "").trim();
    // Server-side mirror of the form's `required` field — a Slack integration
    // without its URL can only no-op (the helper skips), so reject a dud row.
    if (!webhookUrl) {
      throw new Error("webhook_url is required");
    }
    const { error } = await supabase
      .from("integrations")
      .upsert(
        { project_id: projectId, provider, config: { webhook_url: webhookUrl }, is_active: isActive },
        { onConflict: "project_id,provider" },
      );
    if (error) {
      throw new Error(error.message);
    }
    revalidatePath(`/projects/${projectId}/settings`);
    return;
  }

  const repoUrl = String(formData.get("repo_url") ?? "").trim();
  const secret = String(formData.get("webhook_secret") ?? "").trim();
  // Nullable by spec (spec/integrations.md "integrations.config の中身"):
  // unset disables the merge transition — finish_story_from_git already
  // fails closed to 'not_configured' rather than erroring, so an empty
  // value here is a valid "not configured yet" state, not an error.
  const mergeTargetStateId = String(formData.get("merge_target_state_id") ?? "").trim() || null;

  // Does a row already exist? (id is SELECTable; webhook_secret is not.) On
  // create the secret is mandatory; on edit a blank field keeps the stored one.
  const { data: existing } = await supabase
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .maybeSingle();

  if (!existing && !secret) {
    throw new Error("webhook_secret is required");
  }

  // Not upsert: an upsert carrying webhook_secret asks PostgREST for a
  // representation it can no longer read (webhook_secret is not SELECTable),
  // so it 42501s. Plain insert/update run return=minimal and omit the secret
  // from the payload on a blank edit, leaving the stored value intact.
  const fields: {
    config: { repo_url: string; merge_target_state_id: string | null };
    is_active: boolean;
    webhook_secret?: string;
  } = {
    config: { repo_url: repoUrl, merge_target_state_id: mergeTargetStateId },
    is_active: isActive,
  };
  if (secret) {
    fields.webhook_secret = secret;
  }

  const { error } = existing
    ? await supabase.from("integrations").update(fields).eq("project_id", projectId).eq("provider", provider)
    : await supabase.from("integrations").insert({ project_id: projectId, provider, ...fields });

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}

export async function deleteIntegration(formData: FormData) {
  const id = String(formData.get("integration_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  await assertRowAffected(
    await supabase.from("integrations").delete().eq("id", id).eq("project_id", projectId).select("id"),
  );
  revalidatePath(`/projects/${projectId}/settings`);
}
