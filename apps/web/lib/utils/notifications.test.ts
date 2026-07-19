import { describe, expect, it } from "vitest";
import { mentionNotification, storyChangeNotification, type StoryNotificationRow } from "./notifications";

const ME = "user-1";
const STATES = [
  { id: "unstarted-id", name: "Unstarted" },
  { id: "started-id", name: "Started" },
];

function story(overrides: Partial<StoryNotificationRow> = {}): StoryNotificationRow {
  return { id: "s1", title: "Fix login bug", state_id: "unstarted-id", assignee_id: null, ...overrides };
}

describe("storyChangeNotification", () => {
  it("notifies on a brand-new story created assigned to me", () => {
    const result = storyChangeNotification(null, story({ assignee_id: ME }), ME, STATES);
    expect(result).toEqual({ title: "Assigned to you", body: '"Fix login bug" was assigned to you' });
  });

  it("notifies when assignee_id newly becomes me", () => {
    const oldRow = story({ assignee_id: "someone-else" });
    const newRow = story({ assignee_id: ME });
    expect(storyChangeNotification(oldRow, newRow, ME, STATES)).toEqual({
      title: "Assigned to you",
      body: '"Fix login bug" was assigned to you',
    });
  });

  it("notifies on a state change for a story I'm already assigned to, resolving the state's name", () => {
    const oldRow = story({ assignee_id: ME, state_id: "unstarted-id" });
    const newRow = story({ assignee_id: ME, state_id: "started-id" });
    expect(storyChangeNotification(oldRow, newRow, ME, STATES)).toEqual({
      title: "Story updated",
      body: '"Fix login bug" is now Started',
    });
  });

  it("names the Icebox when state_id becomes null", () => {
    const oldRow = story({ assignee_id: ME, state_id: "unstarted-id" });
    const newRow = story({ assignee_id: ME, state_id: null });
    expect(storyChangeNotification(oldRow, newRow, ME, STATES)).toEqual({
      title: "Story updated",
      body: '"Fix login bug" is now Icebox',
    });
  });

  it("falls back to a generic body when the new state_id isn't in the given states list (e.g. no project context, per useNotificationsRealtime)", () => {
    const oldRow = story({ assignee_id: ME, state_id: "unstarted-id" });
    const newRow = story({ assignee_id: ME, state_id: "some-other-project-state" });
    expect(storyChangeNotification(oldRow, newRow, ME, [])).toEqual({
      title: "Story updated",
      body: '"Fix login bug" was updated',
    });
  });

  it("does not notify for an unrelated field edit on my story (same state, still assignee)", () => {
    const oldRow = story({ assignee_id: ME, state_id: "unstarted-id", title: "Old title" });
    const newRow = story({ assignee_id: ME, state_id: "unstarted-id", title: "New title" });
    expect(storyChangeNotification(oldRow, newRow, ME, STATES)).toBeNull();
  });

  it("does not notify when the story isn't assigned to me", () => {
    const oldRow = story({ assignee_id: "someone-else", state_id: "unstarted-id" });
    const newRow = story({ assignee_id: "someone-else", state_id: "started-id" });
    expect(storyChangeNotification(oldRow, newRow, ME, STATES)).toBeNull();
  });

  it("does not notify when I'm unassigned from a story", () => {
    const oldRow = story({ assignee_id: ME });
    const newRow = story({ assignee_id: null });
    expect(storyChangeNotification(oldRow, newRow, ME, STATES)).toBeNull();
  });
});

describe("mentionNotification", () => {
  it("notifies when my username is mentioned", () => {
    expect(mentionNotification("hey @dev_user can you look?", "dev_user")).toEqual({
      title: "You were mentioned",
      body: "hey @dev_user can you look?",
    });
  });

  it("matches mentions case-insensitively", () => {
    expect(mentionNotification("@Dev_User please review", "dev_user")).not.toBeNull();
  });

  it("does not notify when my username isn't mentioned", () => {
    expect(mentionNotification("hey @someone_else can you look?", "dev_user")).toBeNull();
  });

  it("does not notify on a comment with no mentions", () => {
    expect(mentionNotification("just a comment", "dev_user")).toBeNull();
  });
});
