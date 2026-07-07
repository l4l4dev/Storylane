// Pure, framework-free Slack message formatting (Task 12 — see
// spec/integrations.md "Slack Notifications"). Kept side-effect free so the
// wording can be unit-tested without an integrations row or fetch.

export type SlackStory = { number: number; title: string };

/** Message for a story state change (transition buttons / kanban drag / webhook). */
export function storyStateChangeMessage(story: SlackStory, newState: string): string {
  return `#${story.number} "${story.title}" is now *${newState}*`;
}

/** Message for an iteration being finalized by the lazy rollover. */
export function iterationDoneMessage(iterationNumber: number, velocity: number): string {
  return `Iteration #${iterationNumber} is done — velocity ${velocity} pts`;
}

/** Message for a new iteration being created by the lazy rollover. */
export function iterationStartedMessage(iterationNumber: number, startDate: string, endDate: string): string {
  return `Iteration #${iterationNumber} started (${startDate} – ${endDate})`;
}
