import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";
import { buildContainerListItems, buildEpicBandChildren, DEFAULT_EPIC_COLOR } from "@/lib/utils/epics-list";
import { EpicProgressBar } from "@/components/features/epics/epic-progress-bar";
import { EpicChildRow } from "@/components/features/epics/epic-child-row";
import { getStoryDetail } from "@/app/stories/[id]/actions";
import { StoryPeekHost } from "@/components/features/board/story-peek-host";
import { EpicsPageAddButton } from "./epics-page-add-button";
import { ensureCurrentIteration } from "@/app/projects/[id]/board/actions";
import { currentIterationOf } from "@/lib/utils/kanban";
import type { StateCategory } from "@storylane/core";

// doc-20 §6: two panes — the epic list (with roll-up progress) on the left,
// the selected epic's children on the right. Replaces the old single-pane
// link-out list; route and "Epics" nav label kept.
export default async function EpicsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ epic?: string; story?: string }>;
}) {
  const { id } = await params;
  const { epic: selectedEpicId, story: peekStoryId } = await searchParams;
  const supabase = await createClient();

  const project = assertReadOk(
    await supabase.from("projects").select("id, name").eq("id", id).maybeSingle(),
  );

  if (!project) {
    notFound();
  }

  // Lazily creates/rolls over the current iteration before reading it (see
  // spec/velocity.md "Automatic scheduling & rollover") — must run before the
  // iterations query below, same as board/page.tsx. Without it, a visitor who
  // lands on /epics first (never having opened /board) sees location dots
  // classified against a stale, not-yet-rolled-over current iteration.
  await ensureCurrentIteration(project.id);

  const [{ data: containerRows }, { data: childRows }, { data: statesData }, { data: iterationsData }, peekDetail] =
    await Promise.all([
      // Ordered by position (not number) — doc-18 §2: a container shares the
      // single stories.position space like any top-level story, so its order
      // here must match the List view's Epics band (board/page.tsx).
      supabase
        .from("stories")
        .select("id, number, title, epic_color")
        .eq("project_id", id)
        .eq("is_container", true)
        .order("position"),
      // Every child in the project, in one query — the right pane needs every
      // zone, not just Icebox (doc-20 §3's mirror-row model).
      supabase
        .from("stories")
        .select("id, parent_id, number, title, points, state_id, iteration_id, position")
        .eq("project_id", id)
        .not("parent_id", "is", null),
      supabase.from("project_states").select("id, category").eq("project_id", id),
      // Just enough to derive the current iteration id for the location dot's
      // "done wins over zone" rule — same derivation as board/page.tsx.
      supabase.from("iterations").select("id, number, state").eq("project_id", id),
      // Independent of the four queries above — launched alongside them
      // rather than awaited afterward, since getStoryDetail batches its own
      // ~11-query Promise.all and awaiting it serially would double
      // server-render latency on any /epics?story=<id> load (TASK-199).
      peekStoryId ? getStoryDetail(peekStoryId) : Promise.resolve(null),
    ]);

  // `category` is a generic `string` in the generated Row type (the DB CHECK
  // constrains it, not the generator) — same cast convention as ProjectState
  // (lib/types.ts).
  const categoryById = new Map((statesData ?? []).map((s) => [s.id, s.category as StateCategory]));
  const currentIterationId = currentIterationOf(iterationsData ?? [])?.id ?? null;

  const items = buildContainerListItems(
    (containerRows ?? []).map((c) => ({ id: c.id, number: c.number, title: c.title, epicColor: c.epic_color })),
    (childRows ?? []).map((c) => ({
      parentId: c.parent_id as string,
      category: c.state_id ? (categoryById.get(c.state_id) ?? null) : null,
      points: c.points,
    })),
  );
  const childrenByEpic = buildEpicBandChildren(
    (childRows ?? []).map((c) => ({
      id: c.id,
      parentId: c.parent_id as string,
      number: c.number,
      title: c.title,
      points: c.points,
      stateId: c.state_id,
      iterationId: c.iteration_id,
      category: c.state_id ? (categoryById.get(c.state_id) ?? null) : null,
      position: c.position,
    })),
    currentIterationId,
  );

  const selectedEpic = selectedEpicId ? (items.find((item) => item.id === selectedEpicId) ?? null) : null;

  return (
    <main className="p-6">
      {/* Stacked below md: the epic list's fixed 20rem is wider than the whole
          content column on a phone, and shrink-0 turned that into page-level
          horizontal overflow. Side by side from md up, as doc-20 §6 describes. */}
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-3 md:w-80">
          <header className="flex items-center gap-2">
            <h1 className="flex-1 text-xl font-bold">Epics</h1>
            <span className="text-xs text-muted-foreground">{items.length}</span>
            <EpicsPageAddButton projectId={project.id} />
          </header>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No epics yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const color = item.epicColor ?? DEFAULT_EPIC_COLOR;
                const selected = item.id === selectedEpicId;
                return (
                  <li key={item.id}>
                    <Link
                      // Preserves an open peek (?story=<id>) across an epic
                      // switch, same "keep the rest of the query" convention
                      // every other link/nav in the app follows (useOpenPeek,
                      // board-filters.tsx) — selecting a different epic must
                      // not silently close a story someone is reading
                      // (ux-principles principle 8).
                      href={`/projects/${project.id}/epics?epic=${item.id}${peekStoryId ? `&story=${peekStoryId}` : ""}`}
                      className={`flex flex-col gap-2 rounded-lg border p-3 hover:bg-accent/50 ${
                        selected ? "border-primary" : "border-border"
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        #{item.number} {item.title}
                      </span>
                      <EpicProgressBar rollup={item.rollup} color={color} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {selectedEpic ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{selectedEpic.title}</h2>
              <EpicProgressBar rollup={selectedEpic.rollup} color={selectedEpic.epicColor ?? DEFAULT_EPIC_COLOR} />
              {(childrenByEpic[selectedEpic.id] ?? []).length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {(childrenByEpic[selectedEpic.id] ?? []).map((child) => (
                    <EpicChildRow key={child.id} child={child} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No stories yet.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {items.length === 0 ? "Create an epic to get started." : "Select an epic to see its stories."}
            </p>
          )}
        </div>
      </div>

      <StoryPeekHost peekStoryId={peekStoryId} detail={peekDetail} />
    </main>
  );
}
