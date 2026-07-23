import Link from "next/link";
import { addDays } from "@storylane/core";
import { createClient } from "@/lib/supabase/server";
import { formatDate, utcTodayKey } from "@/lib/utils/format";
import { DEFAULT_DONE_WINDOW_DAYS, groupDoneByDate } from "@/lib/utils/my-work";
import { fetchAllRows } from "@/lib/utils/supabase-pagination";
import { storyStateBadge } from "@/lib/utils/stories";
import type { ProjectState } from "@/lib/types";
import { MyWorkRow, type MyWorkRowData } from "@/components/features/my-work/my-work-row";

// Read-only view of everything that fell out of My Work's Done column once it
// passed the viewer's configured retention window (TASK-155 AC#5) — Done itself
// only ever shows the last N days; this is where the rest still lives. Done is
// now a status column, not a log (TASK-176), so this reads the viewer's own
// done-category stories older than the window straight from `stories`, the same
// source the main Done column reads (no story_completions). No drag/DnD here,
// just a dated list, same row component as My Work.
type ArchiveEntry = { completedAt: string; row: MyWorkRowData };

export default async function MyWorkArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profileRow } = user
    ? await supabase.from("profiles").select("my_work_done_window_days").eq("id", user.id).single()
    : { data: null };
  const doneWindowDays = profileRow?.my_work_done_window_days ?? DEFAULT_DONE_WINDOW_DAYS;
  const archivedBefore = `${addDays(utcTodayKey(), -doneWindowDays)}T00:00:00.000Z`;

  const { data: projectRows } = await supabase.from("projects").select("id, name, is_personal, created_by");
  const projectById = new Map(
    (projectRows ?? []).map((p) => [p.id, { name: p.name, isPersonal: p.is_personal && p.created_by === user?.id }]),
  );

  const { data: statesRows } = await supabase
    .from("project_states")
    .select("id, project_id, name, action_label, category, position, created_at")
    .in("project_id", [...projectById.keys()]);
  const statesByProject = new Map<string, ProjectState[]>();
  const doneStateIds = new Set<string>();
  for (const state of (statesRows ?? []) as ProjectState[]) {
    const bucket = statesByProject.get(state.project_id);
    if (bucket) bucket.push(state);
    else statesByProject.set(state.project_id, [state]);
    if (state.category === "done") doneStateIds.add(state.id);
  }

  // The viewer's own done-category stories completed before the window cutoff.
  // ponytail: unbounded — fine while archives are small (fable-advisor review);
  // add a .limit()/"load more" once a viewer's archive grows large enough for
  // this to matter.
  const storyRows = user
    ? await fetchAllRows((from, to) =>
        supabase
          .from("stories")
          .select("id, project_id, number, title, story_type, points, state_id, completed_at")
          .eq("assignee_id", user.id)
          .not("completed_at", "is", null)
          .lt("completed_at", archivedBefore)
          .order("completed_at", { ascending: false })
          .range(from, to),
      )
    : [];

  const entries: ArchiveEntry[] = storyRows.flatMap((s) => {
    // Only real-done stories (a stale completed_at on a since-reopened story is
    // possible in principle; gate on the live done category to be safe).
    if (!s.state_id || !doneStateIds.has(s.state_id) || !s.completed_at) return [];
    const known = projectById.get(s.project_id);
    const projectName = known?.name ?? "Left project";
    const row: MyWorkRowData = {
      id: s.id,
      number: s.number,
      title: s.title,
      storyType: s.story_type,
      points: s.points,
      projectId: s.project_id,
      projectName,
      isPersonal: known?.isPersonal ?? false,
      stateBadge: storyStateBadge(s.state_id, statesByProject.get(s.project_id) ?? []),
    };
    return [{ completedAt: s.completed_at, row }];
  });

  const groups = groupDoneByDate(entries);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <Link href="/my-work" className="text-sm text-primary hover:underline">
          ← My Work
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Done archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Completions older than your Done column&apos;s {doneWindowDays}-day window. Read-only — change the window in{" "}
          <Link href="/settings" className="text-primary hover:underline">
            account settings
          </Link>
          .
        </p>
      </div>

      {groups.length === 0 && <p className="text-sm text-muted-foreground">Nothing archived yet.</p>}

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <div key={group.dateKey}>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">{formatDate(group.dateKey)}</h2>
            <ul className="flex flex-col gap-2">
              {group.stories.map((entry, i) => (
                <li key={`${entry.row.id}:${i}`}>
                  <MyWorkRow story={entry.row} completedAt={entry.completedAt} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
