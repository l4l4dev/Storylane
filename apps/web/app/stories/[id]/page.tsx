import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryDetailPanel } from "@/components/features/story/story-detail-panel";
import { StoryPeekMenu } from "@/components/features/story/story-peek-menu";
import { StoryPeekHost } from "@/components/features/board/story-peek-host";
import { getStoryDetail } from "./actions";

export default async function StoryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ story?: string }>;
}) {
  const { id } = await params;
  const { story: peekStoryId } = await searchParams;
  const detail = await getStoryDetail(id);

  if (!detail) {
    notFound();
  }

  // A container's "Child stories" section (doc-20 §6) uses the same
  // EpicChildRow the board and /epics do, which opens its target via
  // ?story=<id> (useOpenPeek) — this page needs the same StoryPeekHost they
  // both already render, or that click would just add a stray query param
  // and do nothing (/code-review).
  const peekDetail = peekStoryId ? await getStoryDetail(peekStoryId) : null;

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

      <StoryPeekHost peekStoryId={peekStoryId} detail={peekDetail} />
    </main>
  );
}
