import { describe, expect, it } from "vitest";
import { isNonMemberAssigneeError, writeErrorMessage } from "./write-error";

describe("writeErrorMessage", () => {
  it("replaces an RLS refusal with the caller's plain message", () => {
    const error = {
      code: "42501",
      message: 'new row violates row-level security policy for table "user_time_off"',
    };
    expect(writeErrorMessage(error, "You can only book your own time off.")).toBe(
      "You can only book your own time off.",
    );
  });

  it("keeps any other error's own message, which is the actionable one", () => {
    expect(writeErrorMessage({ code: "22007", message: 'invalid input syntax for type date: "x"' }, "nope")).toBe(
      'invalid input syntax for type date: "x"',
    );
  });

  it("keeps the message when there is no code at all", () => {
    expect(writeErrorMessage({ message: "network error" }, "nope")).toBe("network error");
  });

  it("names the recovery for a non-member assignee instead of the constraint", () => {
    const error = {
      code: "23503",
      message:
        'insert or update on table "stories" violates foreign key constraint "stories_assignee_project_fkey"',
    };
    expect(writeErrorMessage(error, "nope")).toBe(
      "That person is no longer a member of this project — pick a different assignee.",
    );
  });

  it("leaves an unrelated foreign-key violation alone", () => {
    const error = {
      code: "23503",
      message: 'update or delete on table "project_states" violates foreign key constraint "stories_state_project_fkey"',
    };
    expect(writeErrorMessage(error, "nope")).toBe(error.message);
  });

  it("turns a deadlock abort into a retry prompt", () => {
    const error = { code: "40P01", message: "deadlock detected" };
    expect(writeErrorMessage(error, "nope")).toBe("Someone else was changing this at the same time — try again.");
  });
});

// Move/Copy words this one itself, so the predicate has to separate the assignee
// FK from every other 23503 on its own rather than through the message map.
describe("isNonMemberAssigneeError", () => {
  it("matches only the assignee FK", () => {
    expect(
      isNonMemberAssigneeError({
        code: "23503",
        message:
          'insert or update on table "stories" violates foreign key constraint "stories_assignee_project_fkey"',
      }),
    ).toBe(true);
    expect(
      isNonMemberAssigneeError({
        code: "23503",
        message: 'violates foreign key constraint "stories_state_project_fkey"',
      }),
    ).toBe(false);
    expect(isNonMemberAssigneeError({ code: "42501", message: "stories_assignee_project_fkey" })).toBe(false);
  });
});
