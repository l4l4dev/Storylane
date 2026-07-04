import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryDetailPanel } from "@/components/features/story/story-detail-panel";
import { deleteStory, getStoryDetail } from "./actions";

export default async function StoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getStoryDetail(id);

  if (!detail) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <Link
          href={`/projects/${detail.projectId}/board`}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Board
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{detail.title}</h1>
      </div>

      <StoryDetailPanel detail={detail} />

      <form action={deleteStory} className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">
        <input type="hidden" name="story_id" value={detail.id} />
        <input type="hidden" name="project_id" value={detail.projectId} />
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
