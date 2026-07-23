import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/utils/format";

// TASK-147 AC#6: a dev-only window into the hidden personal project's raw
// data, now that every tracker surface for it is sealed/redirected — the
// owner otherwise has no way to inspect it at all. 404s in production
// (matches app/projects/[id]/layout.tsx's own notFound() convention for an
// inaccessible project) rather than just hiding its link, since a direct URL
// must be blocked too. Uses the ordinary RLS-scoped client (never
// service-role): the viewer's own personal project's rows are exactly what
// RLS already scopes stories/my_work_story_state to, so no extra filtering
// logic is needed here beyond finding that project's id.
export default async function DevMyTasksPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    notFound();
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("is_personal", true)
    .eq("created_by", user.id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [{ data: stories }, { data: marks }] = await Promise.all([
    supabase
      .from("stories")
      .select("id, number, title, state_id, iteration_id, assignee_id, completed_at, project_states(name, category)")
      .eq("project_id", project.id)
      .order("number"),
    supabase
      .from("my_work_story_state")
      .select("story_id, column_id, today_date, today_position, column_position, todo_position, done_position, updated_at")
      .eq("user_id", user.id),
  ]);

  const markByStoryId = new Map((marks ?? []).map((m) => [m.story_id, m]));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 rounded-lg border border-dashed border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Debug: My Tasks — development only, never available in production.
      </div>
      <h1 className="mb-1 text-2xl font-bold">Debug: My Tasks</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Raw data for the hidden personal project ({project.name}, {project.id}).
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">Stories ({(stories ?? []).length})</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Iteration</th>
                <th className="px-3 py-2">Completed at</th>
                <th className="px-3 py-2">column_id</th>
                <th className="px-3 py-2">today_date</th>
                <th className="px-3 py-2">positions (t/c/todo/done)</th>
              </tr>
            </thead>
            <tbody>
              {(stories ?? []).map((s) => {
                const state = Array.isArray(s.project_states) ? s.project_states[0] : s.project_states;
                const mark = markByStoryId.get(s.id);
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-2">{s.number}</td>
                    <td className="px-3 py-2">{s.title}</td>
                    <td className="px-3 py-2">
                      {state ? `${state.name} (${state.category})` : "— (Icebox)"}
                    </td>
                    <td className="px-3 py-2">{s.iteration_id ?? "—"}</td>
                    <td className="px-3 py-2">{s.completed_at ? formatDateTime(s.completed_at) : "—"}</td>
                    <td className="px-3 py-2">{mark?.column_id ?? "—"}</td>
                    <td className="px-3 py-2">{mark?.today_date ?? "—"}</td>
                    <td className="px-3 py-2">
                      {mark?.today_position ?? "—"}/{mark?.column_position ?? "—"}/{mark?.todo_position ?? "—"}/
                      {mark?.done_position ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
