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
