import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";
import { groupStoriesByIteration } from "@/lib/utils/board";
import { formatDate } from "@/lib/utils/format";
import { iterationLabel } from "@/lib/utils/iterations";
import { currentIterationOf } from "@/lib/utils/kanban";
import { buildBurndown, storiesByTouchedIteration } from "@/lib/utils/burndown";
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

  const STORY_COLUMNS =
    "id, number, title, description, story_type, state_id, points, position, iteration_id, created_at, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name, is_agent)";

  const [labelsResult, statesResult] =
    iterationIds.length > 0
      ? await Promise.all([
          supabase.from("labels").select("id, name, color").eq("project_id", id),
          supabase.from("project_states").select("id, name, category").eq("project_id", id),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

  const storiesByIteration =
    iterationIds.length > 0
      ? await fetchAllRows((from, to) =>
          supabase
            .from("stories")
            .select(STORY_COLUMNS)
            .eq("is_container", false)
            .in("iteration_id", iterationIds)
            .order("position", { ascending: true })
            .range(from, to),
        )
      : [];

  // Everything buildBurndown replays, in one paginated pass:
  //  - story.state_changed  — the done/not-done transitions the chart burns down
  //  - story.points_changed — so a re-estimation steps on its own date instead
  //    of rewriting every day with today's points
  //  - story.iteration_changed — a past iteration's burndown must count a story
  //    that has since moved on (a rollover, or an ordinary Backlog<->Current
  //    reschedule) before it finished; this is the only record of which
  //    iteration a story used to belong to once iteration_id changes.
  //    story.iteration_rolled_over is the pre-rename action (20260727120000)
  //    and must still be read, or already-deployed rows vanish from history.
  //
  // Read AFTER the stories, never concurrently with them. buildBurndown rewinds
  // from each story's current row, and every patch it applies is an assignment:
  // a log newer than the snapshot only re-asserts the older value, which is
  // harmless. The other order is not — a change landing between the two reads
  // would be in the snapshot with no log to rewind it, so its new points or
  // state would be projected across the whole chart. That is the defect this
  // replay exists to remove, so the ordering is load-bearing.
  const burndownLogs =
    iterationIds.length > 0
      ? // Tiebreaker on id (after created_at): range()-based pagination needs a
        // fully deterministic order across separate page requests, and
        // created_at alone doesn't guarantee uniqueness — two rows sharing a
        // timestamp could otherwise land on either side of a page boundary
        // inconsistently between requests, silently dropping one.
        await fetchAllRows((from, to) =>
          supabase
            .from("activity_logs")
            .select("id, story_id, action, payload, created_at")
            .eq("project_id", id)
            .in("action", [
              "story.state_changed",
              "story.points_changed",
              "story.iteration_changed",
              "story.iteration_rolled_over",
            ])
            .gte("created_at", `${earliestStart}T00:00:00Z`)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        )
      : [];
  const labels = assertReadOk(labelsResult);
  const states = assertReadOk(statesResult);

  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const categoryByStateName = new Map((states ?? []).map((state) => [state.name, state.category]));
  const categoryByStateId = new Map((states ?? []).map((state) => [state.id, state.category]));
  // Every story any log says entered or left each iteration, unioned below with
  // the current-iteration_id filter to recover an iteration's true membership
  // when a story's row no longer agrees with the window being charted.
  const touchedIterations = storiesByTouchedIteration(burndownLogs);
  const everMovedStoryIds = new Set([...touchedIterations.values()].flatMap((set) => [...set]));

  // Filtering by CURRENT iteration_id alone misses one case: Current ->
  // Backlog/Icebox sets iteration_id to NULL, which is never in
  // iterationIds. touchedIterations already knows such a story belongs to a past
  // iteration's history; without also fetching its row here, that knowledge
  // has no points/state_id to attach to and the story is silently absent
  // from that iteration's chart despite being tracked. Fetched as a second,
  // separately batched query rather than one big .or(...) — PostgREST sends
  // filters in the URL, and a long-lived project's full moved-story history
  // interpolated into one query string could exceed a proxy's request-line
  // limit.
  //
  // These necessarily read AFTER the logs, since the logs are what name them —
  // so unlike storiesByIteration above they keep the narrow read-skew window: a
  // story edited between the two reads has no log to rewind the edit. It only
  // touches stories that have already left every charted iteration, and a
  // reload clears it.
  const coveredIds = new Set(storiesByIteration.map((s) => s.id));
  const extraIds = [...everMovedStoryIds].filter((storyId) => !coveredIds.has(storyId));
  const EXTRA_BATCH_SIZE = 200;
  const extraStories: typeof storiesByIteration = [];
  for (let i = 0; i < extraIds.length; i += EXTRA_BATCH_SIZE) {
    const batch = extraIds.slice(i, i + EXTRA_BATCH_SIZE);
    const { data, error } = await supabase.from("stories").select(STORY_COLUMNS).in("id", batch);
    if (error) throw new Error(error.message);
    extraStories.push(...(data ?? []));
  }
  const stories = [...storiesByIteration, ...extraStories];

  // Grouped once so each rendered iteration's buildBurndown call only scans
  // the handful of logs for its own stories, not the whole project's history.
  const activityLogsByStory = new Map<string, typeof burndownLogs>();
  for (const log of burndownLogs) {
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
    const touched = touchedIterations.get(iteration.id);
    const chartStories = (stories ?? []).filter(
      (story) => story.iteration_id === iteration.id || touched?.has(story.id),
    );
    const chart = buildBurndown({
      startDate: iteration.start_date,
      endDate: iteration.id === currentIteration?.id && today < iteration.end_date ? today : iteration.end_date,
      idealEndDate: iteration.end_date,
      targetPoints: targetByIteration.get(iteration.id) ?? 1,
      iterationId: iteration.id,
      categoryByStateName,
      // Candidate set only — buildBurndown decides per day whether each story
      // was actually in this iteration then. Current iteration_id alone misses
      // a story that rolled onward before finishing, so it is unioned with the
      // move log, either side (see touchedIterations above).
      stories: chartStories.map((story) => ({
        id: story.id,
        points: story.points,
        storyType: story.story_type,
        currentCategory: story.state_id ? (categoryByStateId.get(story.state_id) ?? null) : null,
        currentIterationId: story.iteration_id,
        createdAt: story.created_at,
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
