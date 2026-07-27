import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";
import { groupStoriesByIteration } from "@/lib/utils/board";
import { formatDate } from "@/lib/utils/format";
import { iterationLabel } from "@/lib/utils/iterations";
import { currentIterationOf } from "@/lib/utils/kanban";
import { buildBurndown } from "@/lib/utils/burndown";
import { fetchAllRows } from "@/lib/utils/supabase-pagination";
import { resolvePlanningCapacity, startPlanningCapacityFetch } from "@/lib/utils/planning-capacity";
import { utcTodayKey } from "@/lib/utils/format";
import { StoryCard, type StoryCardData } from "@/components/features/board/story-card";
import { IterationRetroNotesBar } from "@/components/features/board/kanban-board";
import { BurndownChart } from "@/components/features/iterations/burndown-chart";
import { Badge } from "@/components/ui/badge";
import { forecastPoints, velocityRate } from "@storylane/core";
import { ensureCurrentIteration } from "../board/actions";

// Current and past iteration reporting (spec/screens.md): the board remains
// the execution view; this page owns the across-time burndown artifact.
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
      .select("id, name, iteration_length, iteration_term, velocity_window, working_weekdays")
      .eq("id", id)
      .maybeSingle(),
  );

  if (!project) {
    notFound();
  }

  // Runs the lazy rollover first so an iteration whose end_date just passed
  // shows up here instead of lingering on the board (spec/velocity.md).
  await ensureCurrentIteration(project.id);

  // getUser() and the iterations query are independent — run them together
  // rather than paying for a sequential round trip before the iterations
  // query even starts. The membership lookup depends on user.id, so it stays
  // after (mirrors the storiesResult/labelsResult/statesResult Promise.all
  // below for the same reason).
  const [
    {
      data: { user },
    },
    iterationsResult,
    membersResult,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("iterations")
      .select("id, number, goal, retro_notes, start_date, end_date, velocity, capacity, state, skipped")
      .eq("project_id", id)
      .order("number", { ascending: false }),
    supabase.from("project_members").select("user_id, role").eq("project_id", id),
  ]);
  const iterations = assertReadOk(iterationsResult);
  const members = assertReadOk(membersResult) ?? [];
  const membership = members.find((member) => member.user_id === user?.id) ?? null;
  const canEditRetroNotes = membership?.role === "owner" || membership?.role === "member";

  const allIterations = iterations ?? [];
  const currentIteration = currentIterationOf(allIterations);
  const iterationIds = allIterations.map((iteration) => iteration.id);
  const today = utcTodayKey();
  const capacityMembers = members.map((member) => ({ userId: member.user_id, role: member.role }));
  // 0: this page only ever needs the current iteration's own budget
  // (projectedSprints: [] below), never a backlog forecast — the board's
  // wide default horizon would fetch calendar/time-off rows far past what
  // this page uses.
  const capacityFetch = startPlanningCapacityFetch(
    supabase,
    id,
    capacityMembers.map((member) => member.userId),
    today,
    project.iteration_length,
    0,
  );
  const earliestStart = allIterations.at(-1)?.start_date ?? today;

  const [storiesResult, labelsResult, statesResult, activityLogs, rolloverLogs] =
    iterationIds.length > 0
      ? await Promise.all([
          supabase
            .from("stories")
            .select(
              "id, number, title, description, story_type, state_id, points, position, iteration_id, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name, is_agent)",
            )
            .eq("is_container", false)
            .in("iteration_id", iterationIds)
            .order("position", { ascending: true }),
          supabase.from("labels").select("id, name, color").eq("project_id", id),
          supabase.from("project_states").select("id, name, category").eq("project_id", id),
          // Tiebreaker on id (after created_at): range()-based pagination
          // needs a fully deterministic order across separate page requests,
          // and created_at alone doesn't guarantee uniqueness — two rows
          // sharing a timestamp could otherwise land on either side of a
          // page boundary inconsistently between requests, silently
          // dropping one.
          fetchAllRows((from, to) =>
            supabase
              .from("activity_logs")
              .select("id, story_id, payload, created_at")
              .eq("project_id", id)
              .eq("action", "story.state_changed")
              .gte("created_at", `${earliestStart}T00:00:00Z`)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to),
          ),
          // A past iteration's burndown must count a story that rolled over
          // to the next iteration before it finished (finalize_iteration
          // moves iteration_id forward for incomplete stories on rollover) —
          // otherwise the story's points silently drop out of that iteration's
          // history the moment it rolls over. This log is the only record of
          // "which iteration a story used to belong to" once that happens.
          fetchAllRows((from, to) =>
            supabase
              .from("activity_logs")
              .select("id, story_id, payload")
              .eq("project_id", id)
              .eq("action", "story.iteration_rolled_over")
              .order("id", { ascending: true })
              .range(from, to),
          ),
        ])
      : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, [], []];
  const stories = assertReadOk(storiesResult);
  const labels = assertReadOk(labelsResult);
  const states = assertReadOk(statesResult);

  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const categoryByStateName = new Map((states ?? []).map((state) => [state.name, state.category]));
  const categoryByStateId = new Map((states ?? []).map((state) => [state.id, state.category]));
  // storyId set that rolled OUT of each iteration — unioned with the
  // current-iteration_id filter below to recover a past iteration's true
  // story membership after rollover has moved some of them onward.
  const rolledOutOf = new Map<string, Set<string>>();
  for (const log of rolloverLogs as Array<{ story_id: string | null; payload: unknown }>) {
    const payload = (log.payload ?? {}) as { from_iteration_id?: string };
    if (!log.story_id || !payload.from_iteration_id) continue;
    const set = rolledOutOf.get(payload.from_iteration_id) ?? new Set<string>();
    set.add(log.story_id);
    rolledOutOf.set(payload.from_iteration_id, set);
  }
  // Grouped once so each rendered iteration's buildBurndown call only scans
  // the handful of logs for its own stories, not the whole project's history.
  const activityLogsByStory = new Map<string, typeof activityLogs>();
  for (const log of activityLogs) {
    if (!log.story_id) continue;
    const list = activityLogsByStory.get(log.story_id) ?? [];
    list.push(log);
    activityLogsByStory.set(log.story_id, list);
  }
  const cards = (stories ?? []).map((story) => {
    const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
    const card: StoryCardData & { iteration_id: string | null } = {
      id: story.id,
      number: story.number,
      title: story.title,
      description: story.description,
      story_type: story.story_type,
      isDone: story.state_id !== null && categoryByStateId.get(story.state_id) === "done",
      points: story.points,
      iteration_id: story.iteration_id,
      assigneeName: assigneeProfile?.display_name ?? null,
      assigneeIsAgent: assigneeProfile?.is_agent ?? false,
      labels: story.story_labels
        .map((sl) => labelById.get(sl.label_id))
        .filter((l): l is NonNullable<typeof l> => l != null)
        .map((l) => ({ id: l.id, name: l.name, color: l.color })),
    };
    return card;
  });
  const { byIteration } = groupStoriesByIteration(cards);
  const doneIterations = allIterations.filter((iteration) => iteration.state === "done");
  const currentRate = velocityRate(doneIterations, project.velocity_window);
  const { currentBudget } = await resolvePlanningCapacity(supabase, id, capacityFetch, {
    rate: currentRate,
    workingWeekdays: project.working_weekdays,
    capacityMembers,
    currentIteration: currentIteration && { start: currentIteration.start_date, end: currentIteration.end_date },
    projectedSprints: [],
  });
  const targetByIteration = new Map(
    allIterations.map((iteration) => [
      iteration.id,
      iteration.id === currentIteration?.id
        ? currentBudget
        : forecastPoints(
            velocityRate(
              doneIterations.filter((candidate) => candidate.number < iteration.number),
              project.velocity_window,
            ),
            iteration.capacity ?? 0,
          ),
    ]),
  );

  const renderIteration = (iteration: (typeof allIterations)[number]) => {
    const iterationStories = byIteration.get(iteration.id) ?? [];
    const rolledOut = rolledOutOf.get(iteration.id);
    const chartStories = (stories ?? []).filter(
      (story) => story.iteration_id === iteration.id || rolledOut?.has(story.id),
    );
    const chart = buildBurndown({
      startDate: iteration.start_date,
      endDate: iteration.id === currentIteration?.id && today < iteration.end_date ? today : iteration.end_date,
      idealEndDate: iteration.end_date,
      targetPoints: targetByIteration.get(iteration.id) ?? 1,
      categoryByStateName,
      // Current iteration_id alone misses a story that rolled onward before
      // finishing — union with the rollover log so a past iteration's chart
      // still counts it (see rolledOutOf above).
      stories: chartStories.map((story) => ({
        id: story.id,
        points: story.points,
        storyType: story.story_type,
        currentCategory: story.state_id ? (categoryByStateId.get(story.state_id) ?? null) : null,
      })),
      // Only this iteration's own stories' logs, not the whole project's
      // history — buildBurndown filters whatever it's handed, so keeping the
      // input small keeps that filter cheap across many rendered iterations.
      logs: chartStories.flatMap((story) => activityLogsByStory.get(story.id) ?? []),
    });
    return (
      <article key={iteration.id} className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-semibold">
            {iterationLabel(project.iteration_term, iteration.number, project.iteration_length, iteration.start_date)}
          </h3>
          {iteration.id === currentIteration?.id ? (
            <Badge>Current</Badge>
          ) : iteration.skipped ? (
            <Badge variant="secondary" className="text-muted-foreground">Skipped</Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground">
              {iteration.velocity ?? 0} pts
              {iteration.capacity != null && iteration.capacity > 0 && (
                <span className="ml-1 font-normal">/ {iteration.capacity} person-days</span>
              )}
            </Badge>
          )}
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          {formatDate(iteration.start_date)} – {formatDate(iteration.end_date)}
        </p>
        {iteration.goal && <p className="mb-3 text-sm text-muted-foreground">{iteration.goal}</p>}
        {canEditRetroNotes ? (
          <div className="mb-3">
            <IterationRetroNotesBar
              projectId={project.id}
              iterationId={iteration.id}
              initialRetroNotes={iteration.retro_notes ?? ""}
            />
          </div>
        ) : (
          iteration.retro_notes && <p className="mb-3 text-sm text-muted-foreground">{iteration.retro_notes}</p>
        )}
        <BurndownChart coverage={chart.coverage} points={chart.points} />
        {iterationStories.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {iterationStories.map((story) => <li key={story.id}><StoryCard story={story} /></li>)}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No stories in this iteration.</p>
        )}
      </article>
    );
  };

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl font-bold">{project.iteration_term} reporting</h1>

      {allIterations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No iterations yet.
        </p>
      )}

      {currentIteration && (
        <section aria-labelledby="current-iteration-heading" className="mb-6">
          <h2 id="current-iteration-heading" className="mb-2 text-lg font-semibold">Current</h2>
          {renderIteration(currentIteration)}
        </section>
      )}
      {allIterations.length > 0 && (
        <section aria-labelledby="iteration-history-heading">
          <h2 id="iteration-history-heading" className="mb-2 text-lg font-semibold">History</h2>
          <div className="flex flex-col gap-4">
            {doneIterations.length > 0
              ? doneIterations.map(renderIteration)
              : (
                  <p className="text-sm text-muted-foreground">
                    No completed iterations yet — finished iterations appear here once their end date passes.
                  </p>
                )}
          </div>
        </section>
      )}
    </main>
  );
}
