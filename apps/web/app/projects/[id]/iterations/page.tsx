import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { groupStoriesByIteration } from "@/lib/utils/board";
import { StoryCard, type StoryCardData } from "@/components/features/board/story-card";
import { ensureCurrentIteration } from "../board/actions";

// Iteration history (spec/screens.md): past (done) iterations with their
// stored velocity and stories. The board only shows the current iteration —
// finalized ones live here.
export default async function IterationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  // Runs the lazy rollover first so an iteration whose end_date just passed
  // shows up here instead of lingering on the board (spec/velocity.md).
  await ensureCurrentIteration(project.id);

  const { data: iterations } = await supabase
    .from("iterations")
    .select("id, number, goal, start_date, end_date, velocity, state")
    .eq("project_id", id)
    .eq("state", "done")
    .order("number", { ascending: false });

  const doneIterations = iterations ?? [];
  const doneIds = doneIterations.map((iteration) => iteration.id);

  const [{ data: stories }, { data: labels }, { data: epics }] =
    doneIds.length > 0
      ? await Promise.all([
          supabase
            .from("stories")
            .select(
              "id, number, title, description, story_type, state, points, position, iteration_id, epic_id, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name)",
            )
            .in("iteration_id", doneIds)
            .order("position", { ascending: true }),
          supabase.from("labels").select("id, name, color").eq("project_id", id),
          supabase.from("epics").select("id, name, color").eq("project_id", id),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const epicById = new Map((epics ?? []).map((e) => [e.id, e]));
  const cards = (stories ?? []).map((story) => {
    const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
    const epic = story.epic_id ? epicById.get(story.epic_id) : undefined;
    const card: StoryCardData & { iteration_id: string | null } = {
      id: story.id,
      number: story.number,
      title: story.title,
      description: story.description,
      story_type: story.story_type,
      state: story.state,
      points: story.points,
      iteration_id: story.iteration_id,
      assigneeName: assigneeProfile?.display_name ?? null,
      labels: story.story_labels
        .map((sl) => labelById.get(sl.label_id))
        .filter((l): l is NonNullable<typeof l> => l != null)
        .map((l) => ({ id: l.id, name: l.name, color: l.color })),
      epic: epic ? { id: epic.id, name: epic.name, color: epic.color } : null,
    };
    return card;
  });
  const { byIteration } = groupStoriesByIteration(cards);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Iterations</h1>

      {doneIterations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No completed iterations yet — finished iterations appear here once their end date passes.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {doneIterations.map((iteration) => {
          const iterationStories = byIteration.get(iteration.id) ?? [];
          return (
            <section key={iteration.id} className="rounded-lg border border-border bg-muted/40 p-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-semibold">Iteration #{iteration.number}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {iteration.velocity ?? 0} pts
                </span>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                {iteration.start_date} – {iteration.end_date}
              </p>
              {iteration.goal && (
                <p className="mb-3 text-sm text-muted-foreground">{iteration.goal}</p>
              )}
              {iterationStories.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {iterationStories.map((story) => (
                    <li key={story.id}>
                      <StoryCard story={story} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No stories were completed.</p>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
