import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { epicProgress } from "@/lib/utils/epics";
import { EpicFormDialog } from "@/components/features/epics/epic-form-dialog";
import { EpicProgressBar } from "@/components/features/epics/epic-progress-bar";
import { deleteEpic } from "./actions";

export default async function EpicsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("id, name").eq("id", id).single();

  if (!project) {
    notFound();
  }

  const [{ data: epics }, { data: stories }] = await Promise.all([
    supabase
      .from("epics")
      .select("id, name, description, color, position")
      .eq("project_id", id)
      .order("position", { ascending: true }),
    supabase.from("stories").select("epic_id, state").eq("project_id", id),
  ]);

  const storiesByEpic = new Map<string, { state: string }[]>();
  for (const story of stories ?? []) {
    if (!story.epic_id) continue;
    const bucket = storiesByEpic.get(story.epic_id) ?? [];
    bucket.push({ state: story.state });
    storiesByEpic.set(story.epic_id, bucket);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Epics</h1>
          <EpicFormDialog
            projectId={project.id}
            trigger={
              <button
                type="button"
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                New epic
              </button>
            }
          />
        </div>
      </div>

      {(epics ?? []).length > 0 ? (
        <ul className="flex flex-col gap-3">
          {(epics ?? []).map((epic) => {
            const progress = epicProgress(storiesByEpic.get(epic.id) ?? []);
            return (
              <li
                key={epic.id}
                className="rounded-lg border border-gray-200 p-4 dark:border-gray-800"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: epic.color }}
                    />
                    <h2 className="font-medium">{epic.name}</h2>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <EpicFormDialog
                      projectId={project.id}
                      epic={epic}
                      trigger={
                        <button
                          type="button"
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-700"
                        >
                          Edit
                        </button>
                      }
                    />
                    <form action={deleteEpic}>
                      <input type="hidden" name="epic_id" value={epic.id} />
                      <input type="hidden" name="project_id" value={project.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
                {epic.description && (
                  <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
                    {epic.description}
                  </p>
                )}
                <EpicProgressBar progress={progress} color={epic.color} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">No epics yet.</p>
      )}
    </main>
  );
}
