"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";

export async function createEpic(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "#6366f1");

  if (!name) {
    return;
  }

  const supabase = await createClient();

  const { error } = await supabase.from("epics").insert({
    project_id: projectId,
    name,
    description,
    color,
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/projects/${projectId}/epics`);
}

export async function updateEpic(formData: FormData) {
  const id = String(formData.get("epic_id"));
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "#6366f1");

  if (!name) {
    return;
  }

  const supabase = await createClient();
  await assertRowAffected(
    await supabase.from("epics").update({ name, description, color }).eq("id", id).select("id"),
  );

  revalidatePath(`/projects/${projectId}/epics`);
}

export async function deleteEpic(
  epicId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createClient();
  try {
    await assertRowAffected(await supabase.from("epics").delete().eq("id", epicId).select("id"));
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Failed to delete epic" };
  }

  revalidatePath(`/projects/${projectId}/epics`);
  return { ok: true };
}
