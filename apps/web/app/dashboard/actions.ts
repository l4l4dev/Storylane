"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const iterationLength = Number(formData.get("iteration_length") ?? 14);
  const pointScale = String(formData.get("point_scale") ?? "fibonacci");

  if (!name) {
    return;
  }

  const supabase = await createClient();
  // created_by defaults to auth.uid(); a trigger adds the creator as owner.
  const { error } = await supabase.from("projects").insert({
    name,
    description,
    iteration_length: iterationLength,
    point_scale: pointScale,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}

export type UpdateUsernameState = { error?: string; success?: string };

export async function updateUsername(
  _prev: UpdateUsernameState,
  formData: FormData,
): Promise<UpdateUsernameState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return { error: "Usernames must be 3-30 characters: lowercase letters, numbers, underscores." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in." };
  }

  const { error } = await supabase.from("profiles").update({ username }).eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is already taken." };
    }
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  return { success: "Username updated." };
}
