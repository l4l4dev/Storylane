import Link from "next/link";
import { notFound } from "next/navigation";
import { SplitStudio } from "@/components/features/story/split-studio";
import { getStoryDetail } from "../actions";

// The Split Studio (doc-18 §7): splitting only applies to a normal, top-level
// story. A container is already split (is_container=true — has no board
// state to split from); a child can't be split (single-level nesting,
// doc-18 §3, and split_story rejects it server-side too); a personal-project
// story is never offered Split at all (owner decision, TASK-181/184 notes —
// splitting would containerize it, dropping it out of My Work with
// unassigned children also invisible there). All three 404 rather than
// silently redirecting, matching this app's other illegal-state guards.
export default async function SplitStudioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getStoryDetail(id);

  if (!detail || detail.isContainer || detail.parentId !== null || detail.isPersonalProject) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href={`/stories/${detail.id}`} className="text-sm text-primary hover:underline">
        ← Cancel
      </Link>
      <SplitStudio
        storyId={detail.id}
        projectId={detail.projectId}
        title={detail.title}
        description={detail.description}
        points={detail.points}
        tasks={detail.tasks}
        pointScale={detail.pointScale}
      />
    </main>
  );
}
