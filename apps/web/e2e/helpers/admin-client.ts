import { createClient } from "@supabase/supabase-js";

export function createTestAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see apps/web/.env.local) to run e2e tests",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function backdateCurrentIteration(projectId: string) {
  const supabase = createTestAdminClient();
  // ensureCurrentIteration (app/projects/[id]/board/actions.ts) never sets
  // state to "active" — inserted rows keep the column default ("planned")
  // until they're finalized to "done". The current iteration is just the
  // highest-numbered one that isn't done yet.
  const { data: latest, error: findError } = await supabase
    .from("iterations")
    .select("id")
    .eq("project_id", projectId)
    .neq("state", "done")
    .order("number", { ascending: false })
    .limit(1)
    .single();
  if (findError || !latest) {
    throw new Error(`Failed to find the current iteration for project ${projectId}: ${findError?.message}`);
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { error: updateError } = await supabase.from("iterations").update({ end_date: yesterday }).eq("id", latest.id);
  if (updateError) {
    throw new Error(`Failed to backdate iteration ${latest.id}: ${updateError.message}`);
  }
}
