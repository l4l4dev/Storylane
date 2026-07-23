import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";
import { groupStoriesByIteration } from "@/lib/utils/board";
import { formatDate } from "@/lib/utils/format";
import { iterationLabel } from "@/lib/utils/iterations";
import { StoryCard, type StoryCardData } from "@/components/features/board/story-card";
import { Badge } from "@/components/ui/badge";
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

  const project = assertReadOk(
    await supabase
      .from("projects")
      .select("id, name, iteration_length, iteration_term")
      .eq("id", id)
      .maybeSingle(),
  );

  if (!project) {
    notFound();
  }

  // Runs the lazy rollover first so an iteration whose end_date just passed
  // shows up here instead of lingering on the board (spec/velocity.md).
  await ensureCurrentIteration(project.id);

  const iterations = assertReadOk(
    await supabase
      .from("iterations")
      .select("id, number, goal, start_date, end_date, velocity, capacity, state, skipped")
      .eq("project_id", id)
      .eq("state", "done")
      .order("number", { ascending: false }),
  );

  const doneIterations = iterations ?? [];
  const doneIds = doneIterations.map((iteration) => iteration.id);

  const [storiesResult, labelsResult, epicsResult, statesResult] =
    doneIds.length > 0
      ? await Promise.all([
          supabase
            .from("stories")
            .select(
              "id, number, title, description, story_type, state_id, points, position, iteration_id, epic_id, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name, is_agent)",
            )
            .in("iteration_id", doneIds)
            .order("position", { ascending: true }),
          supabase.from("labels").select("id, name, color").eq("project_id", id),
          supabase.from("epics").select("id, name, color").eq("project_id", id),
          supabase.from("project_states").select("id, category").eq("project_id", id),
        ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const stories = assertReadOk(storiesResult);
  const labels = assertReadOk(labelsResult);
  const epics = assertReadOk(epicsResult);
  const states = assertReadOk(statesResult);

  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const epicById = new Map((epics ?? []).map((e) => [e.id, e]));
  const doneStateIds = new Set((states ?? []).filter((s) => s.category === "done").map((s) => s.id));
  const cards = (stories ?? []).map((story) => {
    const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
    const epic = story.epic_id ? epicById.get(story.epic_id) : undefined;
    const card: StoryCardData & { iteration_id: string | null } = {
      id: story.id,
      number: story.number,
      title: story.title,
      description: story.description,
      story_type: story.story_type,
      isDone: story.state_id !== null && doneStateIds.has(story.state_id),
      points: story.points,
      iteration_id: story.iteration_id,
      assigneeName: assigneeProfile?.display_name ?? null,
      assigneeIsAgent: assigneeProfile?.is_agent ?? false,
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
      <h1 className="mb-4 text-2xl font-bold">{project.iteration_term} history</h1>

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
                <h2 className="font-semibold">
                  {iterationLabel(
                    project.iteration_term,
                    iteration.number,
                    project.iteration_length,
                    iteration.start_date,
                  )}
                </h2>
                {iteration.skipped ? (
                  <Badge variant="secondary" className="text-muted-foreground">
                    Skipped
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-muted-foreground">
                    {iteration.velocity ?? 0} pts
                    {/* The snapshotted person-days the points were earned
                        over (spec/velocity.md) — without it a point total
                        can't be compared across sprints of different size.
                        Absent on anything finalized before the snapshot
                        existed, and on capacity-0 catch-up rows. */}
                    {iteration.capacity != null && iteration.capacity > 0 && (
                      <span className="ml-1 font-normal">/ {iteration.capacity} person-days</span>
                    )}
                  </Badge>
                )}
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                {formatDate(iteration.start_date)} – {formatDate(iteration.end_date)}
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
