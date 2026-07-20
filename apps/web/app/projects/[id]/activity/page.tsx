import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { describeActivity } from "@/lib/utils/activity";
import { formatDateTime } from "@/lib/utils/format";
import { AgentIndicator } from "@/components/features/projects/agent-indicator";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

type ActivityCursor = {
  createdAt: string;
  id: string;
};

function encodeCursor(entry: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify([entry.created_at, entry.id])).toString("base64url");
}

function decodeCursor(value: string | undefined): ActivityCursor | null {
  if (!value || value.length > 512) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      typeof decoded[0] !== "string" ||
      !TIMESTAMPTZ_PATTERN.test(decoded[0]) ||
      Number.isNaN(Date.parse(decoded[0])) ||
      typeof decoded[1] !== "string" ||
      !UUID_PATTERN.test(decoded[1])
    ) {
      return null;
    }
    return { createdAt: decoded[0], id: decoded[1] };
  } catch {
    return null;
  }
}

function activityHref(
  projectId: string,
  direction: "before" | "after",
  entry: { created_at: string; id: string },
) {
  const params = new URLSearchParams({ [direction]: encodeCursor(entry) });
  return `/projects/${projectId}/activity?${params.toString()}`;
}

export default async function ProjectActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string; after?: string }>;
}) {
  const { id } = await params;
  const { before: rawBefore, after: rawAfter } = await searchParams;
  const before = decodeCursor(rawBefore);
  const after = before ? null : decodeCursor(rawAfter);
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id").eq("id", id).single();

  if (!project) {
    notFound();
  }

  let activityQuery = supabase
    .from("activity_logs")
    .select("id, action, payload, created_at, actor:profiles(display_name, is_agent), story:stories(title)")
    .eq("project_id", project.id);

  if (before) {
    activityQuery = activityQuery.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  } else if (after) {
    activityQuery = activityQuery.or(
      `created_at.gt.${after.createdAt},and(created_at.eq.${after.createdAt},id.gt.${after.id})`,
    );
  }

  const ascending = after !== null;
  const { data: activity } = await activityQuery
    .order("created_at", { ascending })
    .order("id", { ascending })
    .range(0, PAGE_SIZE);

  const fetchedPage = (activity ?? []).slice(0, PAGE_SIZE);
  const activityPage = ascending ? fetchedPage.reverse() : fetchedPage;
  const hasLookahead = (activity ?? []).length > PAGE_SIZE;
  const hasNewer = before !== null || (after !== null && hasLookahead);
  const hasOlder = after !== null || hasLookahead;
  const firstActivity = activityPage[0];
  const lastActivity = activityPage.at(-1);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Activity</h1>

      {activityPage.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {activityPage.map((log) => {
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
        <p className="text-sm text-muted-foreground">
          {before || after ? "No more activity." : "No activity yet."}
        </p>
      )}

      {(hasNewer || hasOlder || ((before || after) && activityPage.length === 0)) && (
        <nav className="mt-6 flex items-center justify-between" aria-label="Activity pages">
          {hasNewer && firstActivity ? (
            <Button asChild variant="outline" size="sm">
              <Link href={activityHref(project.id, "after", firstActivity)}>Newer</Link>
            </Button>
          ) : (before || after) && activityPage.length === 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/projects/${project.id}/activity`}>Newer</Link>
            </Button>
          ) : (
            <span />
          )}
          {hasOlder && lastActivity && (
            <Button asChild variant="outline" size="sm">
              <Link href={activityHref(project.id, "before", lastActivity)}>Older</Link>
            </Button>
          )}
        </nav>
      )}
    </main>
  );
}
