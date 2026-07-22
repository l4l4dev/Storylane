"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { writeErrorMessage } from "@/lib/utils/write-error";

export type UpdateProfileState = { error?: string; success?: string };

/**
 * Profile identity editing (spec/screens.md "/settings") — the only place
 * username/display name are edited (moved off the Projects page).
 */
export async function updateProfile(
  _prev: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return { error: "Usernames must be 3-30 characters: lowercase letters, numbers, underscores." };
  }
  if (!displayName) {
    return { error: "Display name can't be empty." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ username, display_name: displayName })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is already taken." };
    }
    return { error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { success: "Saved." };
}

export type MyWorkDoneWindowState = { error?: string; success?: string };

/**
 * How many days My Work's Done log reaches back before an entry falls out
 * to the read-only archive (/my-work/archive). Per-user, matches the DB's
 * own check constraint range.
 */
export async function updateMyWorkDoneWindow(
  _prev: MyWorkDoneWindowState,
  formData: FormData,
): Promise<MyWorkDoneWindowState> {
  const days = Number(formData.get("done_window_days"));
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return { error: "Enter a whole number of days between 1 and 90." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in." };
  }

  const { error } = await supabase.from("profiles").update({ my_work_done_window_days: days }).eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/my-work");
  return { success: "Saved." };
}

export type TimeOffState = { error?: string };

/**
 * Personal time off (doc-8 §6) — cross-project by design: one absence applies
 * everywhere the user works. Dates only; the table has no reason field
 * because co-members read these rows for capacity math (spec/rls.md).
 */
export async function addTimeOff(
  _prev: TimeOffState,
  formData: FormData,
): Promise<TimeOffState> {
  const date = String(formData.get("date") ?? "");
  if (!date) {
    return { error: "Pick a date." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in." };
  }

  const { error } = await supabase
    .from("user_time_off")
    .insert({ user_id: user.id, date, kind: "off" });

  if (error) {
    if (error.code === "23505") {
      return { error: `${formatDate(date)} is already marked as time off.` };
    }
    return { error: writeErrorMessage(error, "You can only book your own time off.") };
  }

  revalidatePath("/settings");
  return {};
}

export async function removeTimeOff(formData: FormData) {
  const date = String(formData.get("date") ?? "");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  // Zero rows is not an error here — the row is self-owned, so "already gone"
  // (double click, stale page) is the intended end state. Only a real failure
  // is worth surfacing, and it must not pass silently.
  const { error } = await supabase
    .from("user_time_off")
    .delete()
    .eq("user_id", user.id)
    .eq("date", date);

  if (error) {
    throw new Error(error.message);
  }
  revalidatePath("/settings");
}
