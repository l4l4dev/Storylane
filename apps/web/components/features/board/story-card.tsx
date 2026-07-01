import Link from "next/link";
import {
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

export function StoryCard({ story }: { story: StoryCardData }) {
  const typeMeta = STORY_TYPE_META[story.story_type as StoryType];
  const stateMeta = STORY_STATE_META[story.state as StoryState];

  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex items-center gap-3 rounded-md border border-gray-200 bg-white p-3 hover:border-indigo-400 dark:border-gray-800 dark:bg-zinc-900"
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
          {story.points}
        </span>
      )}

      {story.assigneeName && (
        <span className="shrink-0 text-xs text-gray-500">{story.assigneeName}</span>
      )}
    </Link>
  );
}
