import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { describeActivity } from "@/lib/utils/activity";
import { formatDateTime } from "@/lib/utils/format";
import { AgentIndicator } from "@/components/features/projects/agent-indicator";

export default async function ProjectActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id").eq("id", id).single();

  if (!project) {
    notFound();
  }

  const { data: activity } = await supabase
    .from("activity_logs")
    .select("id, action, payload, created_at, actor:profiles(display_name, is_agent), story:stories(title)")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Activity</h1>

      {(activity ?? []).length > 0 ? (
        <ul className="flex flex-col gap-2">
          {(activity ?? []).map((log) => {
            const actor = Array.isArray(log.actor) ? log.actor[0] : log.actor;
            const storyRow = Array.isArray(log.story) ? log.story[0] : log.story;
            return (
              <li key={log.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-1.5">
                  <span>
                    {describeActivity({
                      action: log.action,
                      payload: log.payload,
                      actorName: actor?.display_name ?? "Someone",
                      storyTitle: storyRow?.title ?? null,
                    })}
                  </span>
                  {actor?.is_agent && <AgentIndicator />}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(log.created_at)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      )}
    </main>
  );
}
