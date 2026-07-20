import { describe, expect, it } from "vitest";
import { writeErrorMessage } from "./write-error";

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
});
