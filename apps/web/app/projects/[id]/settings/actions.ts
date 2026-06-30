"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type InviteState = { error?: string; success?: string };

export async function updateProject(formData: FormData) {
  const id = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const iterationLength = Number(formData.get("iteration_length") ?? 14);
  const pointScale = String(formData.get("point_scale") ?? "fibonacci");
  const velocityWindow = Number(formData.get("velocity_window") ?? 3);

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
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "member");

  if (!email) {
    return { error: "Email is required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member", {
    p_project_id: id,
    p_email: email,
    p_role: role,
  });

  if (error) {
    return { error: error.message };
  }
  revalidatePath(`/projects/${id}/settings`);
  return { success: `Added ${email}` };
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
