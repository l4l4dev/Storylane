import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isCurrentIteration } from "@/lib/utils/iterations";
import { StoryCard, type StoryCardData } from "@/components/features/board/story-card";
import { calculateVelocity } from "@/lib/utils/velocity";
import { describeActivity } from "@/lib/utils/activity";

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function ProjectHomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, velocity_window")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const { data: iterations } = await supabase
    .from("iterations")
    .select("id, number, goal, start_date, end_date, velocity, state")
    .eq("project_id", id)
    .order("number", { ascending: true });

  const allIterations = iterations ?? [];
  const today = todayDateOnly();
  const currentIteration = allIterations.find((iteration) => isCurrentIteration(iteration, today));

  const completed = allIterations
    .filter((iteration) => iteration.state === "done")
    .sort((a, b) => b.number - a.number);
  const currentVelocity = calculateVelocity(completed, project.velocity_window);

  const storySelect =
    "id, title, story_type, state, points, position, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name)";

  const [{ data: labels }, { data: currentIterationStories }, { data: backlogRows }, { data: activity }] =
    await Promise.all([
      supabase.from("labels").select("id, name, color").eq("project_id", project.id),
      currentIteration
        ? supabase
            .from("stories")
            .select(storySelect)
            .eq("iteration_id", currentIteration.id)
            .order("position", { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase
        .from("stories")
        .select(storySelect)
        .eq("project_id", project.id)
        .is("iteration_id", null)
        .order("position", { ascending: true }),
      supabase
        .from("activity_logs")
        .select("id, action, payload, created_at, actor:profiles(display_name), story:stories(title)")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));

  function toStoryCards(rows: NonNullable<typeof currentIterationStories>): StoryCardData[] {
    return rows.map((story) => {
      const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
      const labelIds = story.story_labels.map((sl) => sl.label_id);
      return {
        id: story.id,
        title: story.title,
        story_type: story.story_type,
        state: story.state,
        points: story.points,
        assigneeName: assigneeProfile?.display_name ?? null,
        labels: labelIds
          .map((labelId) => labelById.get(labelId))
          .filter((l): l is NonNullable<typeof l> => l != null)
          .map((l) => ({ id: l.id, name: l.name, color: l.color })),
      };
    });
  }

  const currentStories = toStoryCards(currentIterationStories ?? []);
  const backlogStories = toStoryCards(backlogRows ?? []);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/dashboard" className="text-indigo-600 hover:underline">
            ← Projects
          </Link>
          <Link
            href={`/projects/${project.id}/board`}
            className="text-indigo-600 hover:underline"
          >
            Board
          </Link>
          <Link
            href={`/projects/${project.id}/epics`}
            className="text-indigo-600 hover:underline"
          >
            Epics
          </Link>
          <Link
            href={`/projects/${project.id}/settings`}
            className="text-indigo-600 hover:underline"
          >
            Settings
          </Link>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <span className="text-sm text-gray-500">Current velocity: {currentVelocity} pts</span>
        </div>
        {project.description && <p className="mt-1 text-sm text-gray-500">{project.description}</p>}
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Current Iteration</h2>
        {currentIteration ? (
          <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-medium">Iteration #{currentIteration.number}</h3>
              <span className="text-xs text-gray-500">
                {currentIteration.start_date} – {currentIteration.end_date}
              </span>
            </div>
            {currentIteration.goal && (
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">{currentIteration.goal}</p>
            )}
            {currentStories.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {currentStories.map((story) => (
                  <li key={story.id}>
                    <StoryCard story={story} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">No stories assigned yet.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No active iteration.{" "}
            <Link href={`/projects/${project.id}/board`} className="text-indigo-600 hover:underline">
              Go to the board to generate one
            </Link>
            .
          </p>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Backlog</h2>
          <Link
            href={`/projects/${project.id}/board`}
            className="text-sm text-indigo-600 hover:underline"
          >
            View full board →
          </Link>
        </div>
        {backlogStories.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {backlogStories.map((story) => (
              <li key={story.id}>
                <StoryCard story={story} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">Backlog is empty.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Activity</h2>
        {(activity ?? []).length > 0 ? (
          <ul className="flex flex-col gap-2">
            {(activity ?? []).map((log) => {
              const actor = Array.isArray(log.actor) ? log.actor[0] : log.actor;
              const storyRow = Array.isArray(log.story) ? log.story[0] : log.story;
              return (
                <li key={log.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {describeActivity({
                      action: log.action,
                      payload: log.payload,
                      actorName: actor?.display_name ?? "Someone",
                      storyTitle: storyRow?.title ?? null,
                    })}
                  </span>
                  <span className="shrink-0 text-xs text-gray-500">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No activity yet.</p>
        )}
      </section>
    </main>
  );
}
