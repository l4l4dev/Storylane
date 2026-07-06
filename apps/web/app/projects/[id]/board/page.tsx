import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  BACKLOG_COLUMN_ID,
  ICEBOX_COLUMN_ID,
  columnForStory,
} from "@/lib/utils/kanban";
import { isCurrentIteration } from "@/lib/utils/iterations";
import { filterStories, pointScaleValues } from "@/lib/utils/stories";
import { calculateVelocity } from "@/lib/utils/velocity";
import { BoardFilters } from "@/components/features/board/board-filters";
import { CreateStoryDialog } from "@/components/features/board/create-story-dialog";
import { KanbanBoard, type BoardStory, type IterationMeta } from "@/components/features/board/kanban-board";
import { ensureCurrentIteration } from "./actions";

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

  // Lazily creates/rolls over the current iteration before reading it (see
  // spec/velocity.md "Automatic scheduling & rollover") — must run before the
  // iterations query below.
  await ensureCurrentIteration(project.id);

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
          "id, title, description, story_type, state, points, position, iteration_id, epic_id, assignee_id, story_labels(label_id), assignee:profiles!stories_assignee_id_fkey(display_name)",
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
  const today = todayDateOnly();
  const currentIteration =
    allIterations.find((iteration) => iteration.state !== "done" && isCurrentIteration(iteration, today)) ??
    null;
  const doneIterationIds = new Set(
    allIterations.filter((iteration) => iteration.state === "done").map((iteration) => iteration.id),
  );
  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));

  const cards = (stories ?? [])
    // Stories of finalized iterations belong to the history view
    // (/projects/[id]/iterations), not the board.
    .filter((story) => !(story.iteration_id && doneIterationIds.has(story.iteration_id)))
    .map((story) => {
      const assigneeProfile = Array.isArray(story.assignee) ? story.assignee[0] : story.assignee;
      const labelIds = story.story_labels.map((sl) => sl.label_id);
      const card: BoardStory & { labelIds: string[]; assignee_id: string | null } = {
        id: story.id,
        title: story.title,
        description: story.description,
        story_type: story.story_type,
        state: story.state,
        points: story.points,
        iteration_id: story.iteration_id,
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

  // Filters apply board-wide (kanban convention), then stories are bucketed
  // into their columns.
  const visible = filterStories(cards, { type, assigneeId: assignee, labelId: label });
  const initialContainers: Record<string, BoardStory[]> = {
    [BACKLOG_COLUMN_ID]: [],
    [ICEBOX_COLUMN_ID]: [],
    unstarted: [],
    started: [],
    finished: [],
    delivered: [],
    accepted: [],
    rejected: [],
  };
  for (const card of visible) {
    const column = columnForStory(card, currentIteration?.id ?? null);
    initialContainers[column].push(card);
  }

  const completed = allIterations
    .filter((iteration) => iteration.state === "done")
    .sort((a, b) => b.number - a.number);
  const currentVelocity = calculateVelocity(completed, project.velocity_window);
  const nextVirtualIterationNumber =
    allIterations.reduce((max, iteration) => Math.max(max, iteration.number), 0) + 1;

  const assigneeOptions = (members ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.user_id, name: profile?.display_name ?? m.user_id.slice(0, 8) };
  });

  return (
    <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Board</h1>
        <span className="text-sm text-muted-foreground">Current velocity: {currentVelocity} pts</span>
      </div>

      <KanbanBoard
        projectId={project.id}
        currentIteration={currentIteration}
        initialContainers={initialContainers}
        velocity={currentVelocity}
        nextVirtualIterationNumber={nextVirtualIterationNumber}
        toolbar={
          <>
            <BoardFilters
              assignees={assigneeOptions}
              labels={(labels ?? []).map((l) => ({ id: l.id, name: l.name }))}
            />
            <CreateStoryDialog
              projectId={project.id}
              pointScale={pointScaleValues(project.point_scale, project.custom_points)}
              epics={epics ?? []}
              labels={(labels ?? []).map((l) => ({ id: l.id, name: l.name }))}
              members={assigneeOptions}
            />
          </>
        }
      />
    </main>
  );
}
