import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryDetailPanel } from "@/components/features/story/story-detail-panel";
import { Button } from "@/components/ui/button";
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
          className="text-sm text-primary hover:underline"
        >
          ← Board
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          <span className="mr-2 font-normal text-muted-foreground">#{detail.number}</span>
          {detail.title}
        </h1>
      </div>

      <StoryDetailPanel detail={detail} />

      <form action={deleteStory} className="mt-6 border-t border-border pt-4">
        <input type="hidden" name="story_id" value={detail.id} />
        <input type="hidden" name="project_id" value={detail.projectId} />
        <Button type="submit" variant="destructive">
          Delete story
        </Button>
      </form>
    </main>
  );
}
