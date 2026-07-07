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

// Sets a story's points directly via the DB, bypassing the side-peek UI.
// The side peek isn't what this E2E spec is exercising (that's the board's
// quick-add, one-click transitions, and iteration rollover) — estimating a
// story is just a prerequisite so the "Start" transition button isn't
// blocked (see transition-buttons.tsx's isUnestimatedFeature check).
export async function estimateStory(projectId: string, title: string, points: number) {
  const supabase = createTestAdminClient();
  const { data: story, error: findError } = await supabase
    .from("stories")
    .select("id")
    .eq("project_id", projectId)
    .eq("title", title)
    .single();
  if (findError || !story) {
    throw new Error(`Failed to find story "${title}" in project ${projectId}: ${findError?.message}`);
  }
  const { error: updateError } = await supabase.from("stories").update({ points }).eq("id", story.id);
  if (updateError) {
    throw new Error(`Failed to set points on story ${story.id}: ${updateError.message}`);
  }
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
