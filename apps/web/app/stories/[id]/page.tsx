import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryDetailPanel } from "@/components/features/story/story-detail-panel";
import { StoryPeekMenu } from "@/components/features/story/story-peek-menu";
import { getStoryDetail } from "./actions";

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
      <div className="mb-6 flex items-start justify-between gap-2">
        <div>
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
        <StoryPeekMenu key={detail.id} detail={detail} />
      </div>

      <StoryDetailPanel detail={detail} />
    </main>
  );
}
