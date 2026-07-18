"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import { clampVelocityWindow } from "@storylane/core";
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
  const fields: { config: { repo_url: string }; is_active: boolean; webhook_secret?: string } = {
    config: { repo_url: repoUrl },
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
