import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";
import { epicProgress } from "@/lib/utils/epics";
import type { StateCategory } from "@storylane/core";
import { EpicDeleteMenu } from "@/components/features/epics/epic-delete-menu";
import { EpicFormDialog } from "@/components/features/epics/epic-form-dialog";
import { EpicProgressBar } from "@/components/features/epics/epic-progress-bar";
import { Button } from "@/components/ui/button";

export default async function EpicsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const project = assertReadOk(await supabase.from("projects").select("id, name").eq("id", id).maybeSingle());

  if (!project) {
    notFound();
  }

  const [epicsResult, storiesResult, statesResult] = await Promise.all([
    supabase
      .from("epics")
      .select("id, name, description, color, position")
      .eq("project_id", id)
      .order("position", { ascending: true }),
    supabase.from("stories").select("epic_id, state_id").eq("project_id", id),
    supabase.from("project_states").select("id, category").eq("project_id", id),
  ]);
  const epics = assertReadOk(epicsResult);
  const stories = assertReadOk(storiesResult);
  const states = assertReadOk(statesResult);

  const categoryByStateId = new Map((states ?? []).map((s) => [s.id, s.category as StateCategory]));
  const storiesByEpic = new Map<string, { category: StateCategory | null }[]>();
  for (const story of stories ?? []) {
    if (!story.epic_id) continue;
    const bucket = storiesByEpic.get(story.epic_id) ?? [];
    bucket.push({ category: story.state_id ? (categoryByStateId.get(story.state_id) ?? null) : null });
    storiesByEpic.set(story.epic_id, bucket);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Epics</h1>
          <EpicFormDialog
            projectId={project.id}
            trigger={<Button size="sm">New epic</Button>}
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
                id={epic.id}
                // TASK-41: anchor target for the "View epic" link on the
                // post-promote board banner (promoted-epic-banner.tsx).
                className="rounded-lg border border-border p-4"
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
                        <Button variant="outline" size="xs">
                          Edit
                        </Button>
                      }
                    />
                    <EpicDeleteMenu epicId={epic.id} epicName={epic.name} projectId={project.id} />
                  </div>
                </div>
                {epic.description && (
                  <p className="mb-3 text-sm text-muted-foreground">{epic.description}</p>
                )}
                <EpicProgressBar progress={progress} color={epic.color} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No epics yet.</p>
      )}
    </main>
  );
}
