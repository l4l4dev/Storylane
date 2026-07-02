import { parseCommentBody } from "@/lib/utils/comments";

export function CommentBody({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm">
      {parseCommentBody(body).map((segment, index) =>
        segment.type === "mention" ? (
          <span key={index} className="font-medium text-indigo-600 dark:text-indigo-400">
            @{segment.value}
          </span>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </p>
  );
}
