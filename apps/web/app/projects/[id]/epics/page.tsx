import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";
import { buildContainerListItems, DEFAULT_EPIC_COLOR } from "@/lib/utils/epics-list";
import { EpicProgressBar } from "@/components/features/epics/epic-progress-bar";
import type { StateCategory } from "@storylane/core";

// doc-18 §9: the container list — every is_container story with its
// read-side roll-up progress (doc-18 §5), linking to the story detail.
// Replaces the old epics-table list; route and "Epics" nav label kept.
export default async function EpicsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const project = assertReadOk(
    await supabase.from("projects").select("id, name").eq("id", id).maybeSingle(),
  );

  if (!project) {
    notFound();
  }

  const [{ data: containerRows }, { data: childRows }, { data: statesData }] = await Promise.all([
    // Ordered by position (not number) — doc-18 §2: a container shares the
    // single stories.position space like any top-level story, so its order
    // here must match the List view's Icebox accordion (board/page.tsx).
    supabase
      .from("stories")
      .select("id, number, title, epic_color")
      .eq("project_id", id)
      .eq("is_container", true)
      .order("position"),
    // Every child in the project, in one query — cheaper than one query per
    // container, and children are a small fraction of a project's stories.
    supabase
      .from("stories")
      .select("parent_id, points, state_id")
      .eq("project_id", id)
      .not("parent_id", "is", null),
    supabase.from("project_states").select("id, category").eq("project_id", id),
  ]);

  // `category` is a generic `string` in the generated Row type (the DB CHECK
  // constrains it, not the generator) — same cast convention as ProjectState
  // (lib/types.ts).
  const categoryById = new Map((statesData ?? []).map((s) => [s.id, s.category as StateCategory]));
  const items = buildContainerListItems(
    (containerRows ?? []).map((c) => ({ id: c.id, number: c.number, title: c.title, epicColor: c.epic_color })),
    (childRows ?? []).map((c) => ({
      parentId: c.parent_id as string,
      category: c.state_id ? (categoryById.get(c.state_id) ?? null) : null,
      points: c.points,
    })),
  );

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Epics</h1>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No epics yet. Split an oversized story from its detail&apos;s &ldquo;⋯&rdquo; menu to create one.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/stories/${item.id}`}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 hover:bg-accent/50"
              >
                <span className="text-sm font-medium">
                  #{item.number} {item.title}
                </span>
                <EpicProgressBar rollup={item.rollup} color={item.epicColor ?? DEFAULT_EPIC_COLOR} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
