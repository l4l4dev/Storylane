import Link from "next/link";
import { transitionStory } from "@/app/projects/[id]/board/actions";
import {
  availableTransitions,
  transitionLabel,
  type StoryState as StoryLifecycleState,
} from "@/lib/utils/story-state";
import {
  formatPoints,
  STORY_STATE_META,
  STORY_TYPE_META,
  type StoryState,
  type StoryType,
} from "@/lib/utils/stories";

export type StoryCardData = {
  id: string;
  title: string;
  story_type: string;
  state: string;
  points: number | null;
  assigneeName: string | null;
  labels: { id: string; name: string; color: string }[];
};

// `release` stories render as a milestone marker row (flag + horizontal
// rule) instead of a regular card — see spec/screens.md "Story card UX".
function ReleaseMarkerRow({ story }: { story: StoryCardData }) {
  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex items-center gap-2 py-1 text-sm hover:opacity-80"
    >
      <span title={STORY_TYPE_META.release.label}>{STORY_TYPE_META.release.icon}</span>
      <span className="font-medium">{story.title}</span>
      <span className="h-px flex-1 bg-indigo-300 dark:bg-indigo-700" />
    </Link>
  );
}

// `projectId` is optional because the project home page (spec/screens.md:
// "backlog + current iteration, read-only summary") renders cards without
// the one-click transition buttons — omitting it suppresses them.
export function StoryCard({
  story,
  projectId,
}: {
  story: StoryCardData;
  projectId?: string;
}) {
  if (story.story_type === "release") {
    return <ReleaseMarkerRow story={story} />;
  }

  const typeMeta = STORY_TYPE_META[story.story_type as StoryType];
  const stateMeta = STORY_STATE_META[story.state as StoryState];
  const actions = projectId ? availableTransitions(story.state as StoryLifecycleState) : [];
  const isAccepted = story.state === "accepted";

  return (
    <div
      className={`rounded-md border border-gray-200 p-3 dark:border-gray-800 ${
        isAccepted ? "bg-green-50 dark:bg-green-950/40" : "bg-white dark:bg-zinc-900"
      }`}
    >
      <Link
        href={`/stories/${story.id}`}
        className="flex items-center gap-3 hover:opacity-80"
      >
        {typeMeta && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${typeMeta.className}`}
            title={typeMeta.label}
          >
            {typeMeta.icon}
          </span>
        )}

        <span className="flex-1 truncate text-sm">{story.title}</span>

        {story.labels.map((label) => (
          <span
            key={label.id}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs"
            style={{ backgroundColor: `${label.color}22`, color: label.color }}
          >
            {label.name}
          </span>
        ))}

        {stateMeta && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${stateMeta.className}`}>
            {stateMeta.label}
          </span>
        )}

        {story.points != null && (
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-zinc-800 dark:text-gray-300">
            {formatPoints(story.points)}
          </span>
        )}

        {story.assigneeName && (
          <span className="shrink-0 text-xs text-gray-500">{story.assigneeName}</span>
        )}
      </Link>

      {actions.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          {actions.map((action) => (
            <form key={action} action={transitionStory}>
              <input type="hidden" name="project_id" value={projectId ?? ""} />
              <input type="hidden" name="story_id" value={story.id} />
              <input type="hidden" name="action" value={action} />
              <button
                type="submit"
                className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-zinc-800"
              >
                {transitionLabel(action)}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
