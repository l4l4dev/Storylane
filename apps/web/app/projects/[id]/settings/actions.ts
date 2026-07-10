"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAllSucceeded } from "@/lib/supabase/assert";
import { clampVelocityWindow } from "@/lib/utils/velocity";

export type InviteState = { error?: string; success?: string };

export type InviteSearchResult = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

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
  const { error } = await supabase
    .from("projects")
    .update({
      name,
      description,
      iteration_length: iterationLength,
      point_scale: pointScale,
      velocity_window: velocityWindow,
    })
    .eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
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

export async function updateMemberRole(formData: FormData) {
  const id = String(formData.get("project_id"));
  const userId = String(formData.get("user_id"));
  const role = String(formData.get("role"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .update({ role })
    .eq("project_id", id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${id}/settings`);
}

export async function removeMember(formData: FormData) {
  const id = String(formData.get("project_id"));
  const userId = String(formData.get("user_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${id}/settings`);
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
  const { error } = await supabase.from("labels").delete().eq("id", id).eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}

// ---- Custom statuses (Task 14, free-mode projects only) ----

export async function createCustomStatus(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#6b7280");

  if (!name) {
    return;
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("custom_statuses")
    .select("position")
    .eq("project_id", projectId);
  const position = (existing ?? []).reduce((max, s) => Math.max(max, s.position), -1) + 1;

  const { error } = await supabase
    .from("custom_statuses")
    .insert({ project_id: projectId, name, color, position });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

export async function updateCustomStatus(formData: FormData) {
  const id = String(formData.get("status_id"));
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#6b7280");
  const isDone = formData.get("is_done") === "on";

  if (!name) {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_statuses")
    .update({ name, color, is_done: isDone })
    .eq("id", id)
    .eq("project_id", projectId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

export async function deleteCustomStatus(formData: FormData) {
  const id = String(formData.get("status_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_statuses")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId);
  if (error) {
    // 23503 = the stories.custom_status FK — a column with cards on it
    // can't be removed (see the workflow_modes migration).
    if (error.code === "23503") {
      throw new Error("Move the stories off this status before deleting it");
    }
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

/**
 * TASK-16.2: sets or clears a column's WIP limit — configured from the
 * board's column header menu (spec/screens.md "Free mode board"), not the
 * Settings status editor, but still a custom_statuses mutation like its
 * siblings above. A soft limit only: this never blocks a drop, it just
 * changes what the board renders as a warning past the count.
 */
export async function setStatusWipLimit(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const statusId = String(formData.get("status_id"));
  const raw = String(formData.get("wip_limit") ?? "").trim();

  let wipLimit: number | null = null;
  if (raw !== "") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error("WIP limit must be a positive number");
    }
    wipLimit = Math.floor(parsed);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_statuses")
    .update({ wip_limit: wipLimit })
    .eq("id", statusId)
    .eq("project_id", projectId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/board`);
}

/** Swaps the status with its neighbor above/below — one step per click. */
export async function moveCustomStatus(formData: FormData) {
  const id = String(formData.get("status_id"));
  const projectId = String(formData.get("project_id"));
  const direction = String(formData.get("direction")) === "up" ? "up" : "down";

  const supabase = await createClient();
  const { data: statuses } = await supabase
    .from("custom_statuses")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  const list = statuses ?? [];
  const index = list.findIndex((s) => s.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= list.length) {
    return;
  }

  await assertAllSucceeded(
    await Promise.all([
      supabase
        .from("custom_statuses")
        .update({ position: list[swapWith].position })
        .eq("id", list[index].id)
        .eq("project_id", projectId),
      supabase
        .from("custom_statuses")
        .update({ position: list[index].position })
        .eq("id", list[swapWith].id)
        .eq("project_id", projectId),
    ]),
  );

  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

// TASK-16.3: swimlane CRUD, mirroring the custom_statuses actions above —
// same composite-FK-blocks-delete pattern (see the swimlanes migration).
export async function createLane(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return;
  }

  const supabase = await createClient();
  const { data: existing } = await supabase.from("swimlanes").select("position").eq("project_id", projectId);
  const position = (existing ?? []).reduce((max, s) => Math.max(max, s.position), -1) + 1;

  const { error } = await supabase.from("swimlanes").insert({ project_id: projectId, name, position });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

export async function updateLane(formData: FormData) {
  const id = String(formData.get("lane_id"));
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("swimlanes").update({ name }).eq("id", id).eq("project_id", projectId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

export async function deleteLane(formData: FormData) {
  const id = String(formData.get("lane_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  const { error } = await supabase.from("swimlanes").delete().eq("id", id).eq("project_id", projectId);
  if (error) {
    // 23503 = the stories.swimlane_id FK — a lane with cards on it can't
    // be removed (see the free_mode_swimlanes migration).
    if (error.code === "23503") {
      throw new Error("Move the stories off this lane before deleting it");
    }
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

/** Swaps the lane with its neighbor above/below — one step per click. */
export async function moveLane(formData: FormData) {
  const id = String(formData.get("lane_id"));
  const projectId = String(formData.get("project_id"));
  const direction = String(formData.get("direction")) === "up" ? "up" : "down";

  const supabase = await createClient();
  const { data: lanes } = await supabase
    .from("swimlanes")
    .select("id, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  const list = lanes ?? [];
  const index = list.findIndex((l) => l.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= list.length) {
    return;
  }

  await assertAllSucceeded(
    await Promise.all([
      supabase
        .from("swimlanes")
        .update({ position: list[swapWith].position })
        .eq("id", list[index].id)
        .eq("project_id", projectId),
      supabase
        .from("swimlanes")
        .update({ position: list[index].position })
        .eq("id", list[swapWith].id)
        .eq("project_id", projectId),
    ]),
  );

  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/board`);
}

type RecurringCadence = "daily" | "weekly" | "monthly";

/** Reads and validates the cadence-specific fields, matching the DB's own CHECK constraints. */
function parseRecurringCadence(formData: FormData): {
  cadence: RecurringCadence;
  weekday: number | null;
  day_of_month: number | null;
} {
  const cadence = String(formData.get("cadence"));
  if (cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
    throw new Error(`Unknown cadence: ${cadence}`);
  }

  if (cadence === "weekly") {
    const weekday = Number(formData.get("weekday"));
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error("Weekly recurrence requires a weekday");
    }
    return { cadence, weekday, day_of_month: null };
  }

  if (cadence === "monthly") {
    const dayOfMonth = Number(formData.get("day_of_month"));
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      throw new Error("Monthly recurrence requires a day of month (1-31)");
    }
    return { cadence, weekday: null, day_of_month: dayOfMonth };
  }

  return { cadence, weekday: null, day_of_month: null };
}

// TASK-16.4: recurring-story rule CRUD, free-mode Settings only. Generation
// itself never runs here — it's the generate_recurring_stories RPC, called
// lazily on board access (see apps/web/app/projects/[id]/board/actions.ts).
export async function createRecurringStory(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const customStatusId = String(formData.get("custom_status_id") ?? "") || null;
  const swimlaneId = String(formData.get("swimlane_id") ?? "") || null;

  if (!title) {
    return;
  }
  const { cadence, weekday, day_of_month } = parseRecurringCadence(formData);

  const supabase = await createClient();
  const { error } = await supabase.from("recurring_stories").insert({
    project_id: projectId,
    title,
    description,
    custom_status_id: customStatusId,
    swimlane_id: swimlaneId,
    cadence,
    weekday,
    day_of_month,
  });
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}

export async function updateRecurringStory(formData: FormData) {
  const id = String(formData.get("rule_id"));
  const projectId = String(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const customStatusId = String(formData.get("custom_status_id") ?? "") || null;
  const swimlaneId = String(formData.get("swimlane_id") ?? "") || null;
  const isActive = formData.get("is_active") === "on";

  if (!title) {
    return;
  }
  const { cadence, weekday, day_of_month } = parseRecurringCadence(formData);

  const supabase = await createClient();
  const { error } = await supabase
    .from("recurring_stories")
    .update({
      title,
      description,
      custom_status_id: customStatusId,
      swimlane_id: swimlaneId,
      cadence,
      weekday,
      day_of_month,
      is_active: isActive,
    })
    .eq("id", id)
    .eq("project_id", projectId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}

export async function deleteRecurringStory(formData: FormData) {
  const id = String(formData.get("rule_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  const { error } = await supabase.from("recurring_stories").delete().eq("id", id).eq("project_id", projectId);
  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}

const INTEGRATION_PROVIDERS = ["github", "forgejo", "slack"] as const;
type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * Creates or updates a project's integration for one provider (Task 12 —
 * see spec/integrations.md for the config shape per provider). RLS limits
 * this to project owners; one row per (project_id, provider).
 */
export async function saveIntegration(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const provider = String(formData.get("provider")) as IntegrationProvider;
  const isActive = formData.get("is_active") === "on";

  if (!INTEGRATION_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const config =
    provider === "slack"
      ? { webhook_url: String(formData.get("webhook_url") ?? "").trim() }
      : {
          repo_url: String(formData.get("repo_url") ?? "").trim(),
          webhook_secret: String(formData.get("webhook_secret") ?? "").trim(),
        };

  // Server-side mirror of the form's `required` fields — an integration
  // without its secret/URL can only ever no-op (git-webhook 422s, the Slack
  // helper skips), so reject it here instead of storing a dud row.
  if (provider === "slack" && !("webhook_url" in config && config.webhook_url)) {
    throw new Error("webhook_url is required");
  }
  if (provider !== "slack" && !("webhook_secret" in config && config.webhook_secret)) {
    throw new Error("webhook_secret is required");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("integrations")
    .upsert(
      { project_id: projectId, provider, config, is_active: isActive },
      { onConflict: "project_id,provider" },
    );

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}

export async function deleteIntegration(formData: FormData) {
  const id = String(formData.get("integration_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  const { error } = await supabase.from("integrations").delete().eq("id", id).eq("project_id", projectId);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath(`/projects/${projectId}/settings`);
}
