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
    // TASK-172: this is the peek's "expand to full view" destination, so it
    // needs to read as more than the same narrow panel re-centered — a real
    // two-column layout (StoryDetailPanel layout="split") rather than the
    // peek's single column just stretched wider.
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-start justify-between gap-2">
        <div>
          <Link
            href={detail.isPersonalProject ? "/my-work" : `/projects/${detail.projectId}/board`}
            className="text-sm text-primary hover:underline"
          >
            {detail.isPersonalProject ? "← My Work" : "← Board"}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">
            <span className="mr-2 font-normal text-muted-foreground">#{detail.number}</span>
            {detail.title}
          </h1>
        </div>
        <StoryPeekMenu key={detail.id} detail={detail} />
      </div>

      <StoryDetailPanel detail={detail} layout="split" />
    </main>
  );
}
