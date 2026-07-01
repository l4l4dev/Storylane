import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { STORY_STATES, STORY_TYPES } from "@/lib/utils/stories";
import { deleteStory, updateStory } from "./actions";

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: story } = await supabase
    .from("stories")
    .select("*, story_labels(label_id)")
    .eq("id", id)
    .single();

  if (!story) {
    notFound();
  }

  const [{ data: epics }, { data: labels }, { data: members }] = await Promise.all([
    supabase.from("epics").select("id, name").eq("project_id", story.project_id).order("position"),
    supabase.from("labels").select("id, name").eq("project_id", story.project_id).order("name"),
    supabase
      .from("project_members")
      .select("user_id, profiles(display_name)")
      .eq("project_id", story.project_id),
  ]);

  const storyLabelIds = new Set(story.story_labels.map((sl) => sl.label_id));
  const assigneeOptions = (members ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.user_id, name: profile?.display_name ?? m.user_id.slice(0, 8) };
  });

  const inputClass =
    "rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-zinc-800";

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <Link
          href={`/projects/${story.project_id}/board`}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Board
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{story.title}</h1>
      </div>

      <form action={updateStory} className="flex flex-col gap-4">
        <input type="hidden" name="story_id" value={story.id} />
        <input type="hidden" name="project_id" value={story.project_id} />

        <label className="flex flex-col gap-1 text-sm">
          <span>Title</span>
          <input name="title" defaultValue={story.title} required className={inputClass} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Description</span>
          <textarea
            name="description"
            defaultValue={story.description ?? ""}
            rows={4}
            className={inputClass}
          />
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Type</span>
            <select name="story_type" defaultValue={story.story_type} className={inputClass}>
              {STORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>State</span>
            <select name="state" defaultValue={story.state} className={inputClass}>
              {STORY_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="flex w-24 flex-col gap-1 text-sm">
            <span>Points</span>
            <input
              name="points"
              type="number"
              min={0}
              defaultValue={story.points ?? ""}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Epic</span>
            <select name="epic_id" defaultValue={story.epic_id ?? ""} className={inputClass}>
              <option value="">None</option>
              {(epics ?? []).map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span>Assignee</span>
            <select
              name="assignee_id"
              defaultValue={story.assignee_id ?? ""}
              className={inputClass}
            >
              <option value="">Unassigned</option>
              {assigneeOptions.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {(labels ?? []).length > 0 && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <span>Labels</span>
            <div className="flex flex-wrap gap-2">
              {(labels ?? []).map((label) => (
                <label key={label.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="label_ids"
                    value={label.id}
                    defaultChecked={storyLabelIds.has(label.id)}
                  />
                  {label.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="mt-2 flex items-center justify-between">
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Save changes
          </button>
        </div>
      </form>

      <form action={deleteStory} className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
        <input type="hidden" name="story_id" value={story.id} />
        <input type="hidden" name="project_id" value={story.project_id} />
        <button
          type="submit"
          className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
        >
          Delete story
        </button>
      </form>
    </main>
  );
}
