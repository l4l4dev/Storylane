import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertReadOk } from "@/lib/supabase/assert";

// doc-18: the epics table is gone — an epic is now a story with children
// (is_container). This page becomes the container list (every is_container
// story with its roll-up progress) in TASK-184; until then it's a placeholder
// so the route and nav link stay valid.
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

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Epics</h1>
      <p className="text-sm text-muted-foreground">
        Epics are now stories with children. Split an oversized story to create
        one; this list of container stories is coming soon.
      </p>
    </main>
  );
}
