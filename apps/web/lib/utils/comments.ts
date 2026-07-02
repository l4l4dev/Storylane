// Pure, framework-free helpers for comment bodies. Kept side-effect free so
// they can be unit-tested without a Supabase client or React.

const MENTION_PATTERN = /@([a-z0-9_]{3,30})/gi;

export type CommentSegment = { type: "text" | "mention"; value: string };

/** Splits a comment body into plain-text and @mention segments for rendering. */
export function parseCommentBody(body: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let lastIndex = 0;

  for (const match of body.matchAll(MENTION_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: body.slice(lastIndex, index) });
    }
    segments.push({ type: "mention", value: match[1].toLowerCase() });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", value: body.slice(lastIndex) });
  }

  return segments;
}

/** Distinct usernames mentioned in a comment body, lowercased. */
export function extractMentions(body: string): string[] {
  const usernames = parseCommentBody(body)
    .filter((segment) => segment.type === "mention")
    .map((segment) => segment.value);
  return Array.from(new Set(usernames));
}
