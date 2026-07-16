"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRowAffected } from "@/lib/supabase/assert";
import { nextPosition } from "@/lib/utils/stories";

export async function createEpic(formData: FormData) {
  const projectId = String(formData.get("project_id"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const color = String(formData.get("color") ?? "#6366f1");

  if (!name) {
    return;
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("epics")
    .select("position")
    .eq("project_id", projectId);

  const { error } = await supabase.from("epics").insert({
    project_id: projectId,
    name,
    description,
    color,
    position: nextPosition(existing ?? []),
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

export async function deleteEpic(formData: FormData) {
  const id = String(formData.get("epic_id"));
  const projectId = String(formData.get("project_id"));

  const supabase = await createClient();
  await assertRowAffected(await supabase.from("epics").delete().eq("id", id).select("id"));

  revalidatePath(`/projects/${projectId}/epics`);
}
