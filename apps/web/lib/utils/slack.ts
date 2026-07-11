// Pure, framework-free Slack message formatting (see spec/integrations.md
// "Slack Notifications"). Kept side-effect free so the wording can be
// unit-tested without an integrations row or fetch.

export type SlackStory = { number: number; title: string };

// Slack's mrkdwn text uses &, <, > for entities/links — an
// unescaped title or status name containing them renders mangled (or is
// silently dropped) once notifySlack posts the text raw. `&` must be
// escaped first so it doesn't double-escape the `&` this function itself
// introduces for `<`/`>`.
function escapeSlackText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Message for a story state change (transition buttons / kanban drag / webhook). */
export function storyStateChangeMessage(story: SlackStory, newState: string): string {
  return `#${story.number} "${escapeSlackText(story.title)}" is now *${escapeSlackText(newState)}*`;
}

/** Message for an iteration being finalized by the lazy rollover. */
export function iterationDoneMessage(iterationNumber: number, velocity: number): string {
  return `Iteration #${iterationNumber} is done — velocity ${velocity} pts`;
}

/** Message for a new iteration being created by the lazy rollover. */
export function iterationStartedMessage(iterationNumber: number, startDate: string, endDate: string): string {
  return `Iteration #${iterationNumber} started (${startDate} – ${endDate})`;
}
