import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BACKLOG_CONTAINER_ID, groupStoriesByIteration, ICEBOX_CONTAINER_ID, partitionIcebox } from "@/lib/utils/board";
import { epicProgress } from "@/lib/utils/epics";
import { filterStories, pointScaleValues } from "@/lib/utils/stories";
import { calculateVelocity } from "@/lib/utils/velocity";
import { BoardFilters } from "@/components/features/board/board-filters";
import { CreateStoryDialog } from "@/components/features/board/create-story-dialog";
import { EpicPanel } from "@/components/features/board/epic-panel";
import { SprintBoard, type IterationMeta } from "@/components/features/board/sprint-board";
import type { StoryCardData } from "@/components/features/board/story-card";
import { createIteration } from "./actions";

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string; assignee?: string; label?: string }>;
}) {
  const { id } = await params;
  const { type, assignee, label } = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, velocity_window, point_scale, custom_points")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const [{ data: iterations }, { data: stories }, { data: epics }, { data: labels }, { data: members }] =
    await Promise.all([
      supabase
        .from("iterations")
        .select("id, number, goal, start_date, end_date, velocity, state")
        .eq("project_id", id)
        .order("number", { ascending: true }),
      supabase
        .from("stories")
        .select(
          "id, title, story_type, state, points, position, iteration_id, epic_id, assignee_id, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name)",
        )
        .eq("project_id", id)
        .order("position", { ascending: true }),
      supabase.from("epics").select("id, name, color").eq("project_id", id).order("position"),
      supabase.from("labels").select("id, name, color").eq("project_id", id).order("name"),
      supabase
        .from("project_members")
        .select("user_id, profiles(display_name)")
        .eq("project_id", id),
    ]);

  const allIterations: IterationMeta[] = iterations ?? [];
  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));

  const cards = (stories ?? []).map((story) => {
    const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
    const labelIds = story.story_labels.map((sl) => sl.label_id);
    const card: StoryCardData & {
      labelIds: string[];
      assignee_id: string | null;
      iteration_id: string | null;
      epic_id: string | null;
    } = {
      id: story.id,
      title: story.title,
      story_type: story.story_type,
      state: story.state,
      points: story.points,
      iteration_id: story.iteration_id,
      epic_id: story.epic_id,
      assignee_id: story.assignee_id,
      assigneeName: assigneeProfile?.display_name ?? null,
      labels: labelIds
        .map((labelId) => labelById.get(labelId))
        .filter((l): l is NonNullable<typeof l> => l != null)
        .map((l) => ({ id: l.id, name: l.name, color: l.color })),
      labelIds,
    };
    return card;
  });

  const { icebox, rest } = partitionIcebox(cards);
  const { byIteration, backlog } = groupStoriesByIteration(rest);
  const filteredBacklog = filterStories(backlog, { type, assigneeId: assignee, labelId: label });

  const initialContainers: Record<string, StoryCardData[]> = {
    [BACKLOG_CONTAINER_ID]: filteredBacklog,
    [ICEBOX_CONTAINER_ID]: icebox,
  };
  const doneIterationStories: Record<string, StoryCardData[]> = {};
  for (const iteration of allIterations) {
    const bucket = byIteration.get(iteration.id) ?? [];
    if (iteration.state === "done") {
      doneIterationStories[iteration.id] = bucket;
    } else {
      initialContainers[iteration.id] = bucket;
    }
  }

  const completed = allIterations
    .filter((iteration) => iteration.state === "done")
    .sort((a, b) => b.number - a.number);
  const currentVelocity = calculateVelocity(completed, project.velocity_window);

  const assigneeOptions = (members ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.user_id, name: profile?.display_name ?? m.user_id.slice(0, 8) };
  });

  const storiesByEpic = new Map<string, { state: string }[]>();
  for (const card of cards) {
    if (!card.epic_id) continue;
    const bucket = storiesByEpic.get(card.epic_id) ?? [];
    bucket.push({ state: card.state });
    storiesByEpic.set(card.epic_id, bucket);
  }
  const epicsWithProgress = (epics ?? []).map((epic) => ({
    id: epic.id,
    name: epic.name,
    color: epic.color,
    progress: epicProgress(storiesByEpic.get(epic.id) ?? []),
  }));

  return (
    <main className="mx-auto max-w-[100rem] p-6">
      <div className="mb-4">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/dashboard" className="text-indigo-600 hover:underline">
            ← Projects
          </Link>
          <Link href={`/projects/${project.id}`} className="text-indigo-600 hover:underline">
            Home
          </Link>
          <Link href={`/projects/${project.id}/epics`} className="text-indigo-600 hover:underline">
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
          <h1 className="text-2xl font-bold">{project.name} · Board</h1>
          <span className="text-sm text-gray-500">Current velocity: {currentVelocity} pts</span>
        </div>
      </div>

      <SprintBoard
        projectId={project.id}
        today={todayDateOnly()}
        iterations={allIterations}
        initialContainers={initialContainers}
        doneIterationStories={doneIterationStories}
        currentToolbar={
          <form action={createIteration} className="flex flex-col gap-2">
            <input type="hidden" name="project_id" value={project.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span>Sprint goal (optional, for the new iteration)</span>
              <input
                name="goal"
                className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800"
              />
            </label>
            <button
              type="submit"
              className="self-start rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Generate next iteration
            </button>
          </form>
        }
        backlogToolbar={
          <CreateStoryDialog
            projectId={project.id}
            pointScale={pointScaleValues(project.point_scale, project.custom_points)}
            epics={epics ?? []}
            labels={(labels ?? []).map((l) => ({ id: l.id, name: l.name }))}
            members={assigneeOptions}
          />
        }
        backlogFilters={
          <BoardFilters
            assignees={assigneeOptions}
            labels={(labels ?? []).map((l) => ({ id: l.id, name: l.name }))}
          />
        }
        epicsPanel={<EpicPanel projectId={project.id} epics={epicsWithProgress} />}
      />
    </main>
  );
}
