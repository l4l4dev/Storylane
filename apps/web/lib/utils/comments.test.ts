import { describe, expect, it } from "vitest";
import { extractMentions, parseCommentBody } from "./comments";

describe("parseCommentBody", () => {
  it("splits plain text with no mentions into a single text segment", () => {
    expect(parseCommentBody("just a comment")).toEqual([
      { type: "text", value: "just a comment" },
    ]);
  });

  it("extracts a mention in the middle of text", () => {
    expect(parseCommentBody("hey @dev_user can you look?")).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", value: "dev_user" },
      { type: "text", value: " can you look?" },
    ]);
  });

  it("handles a mention at the very start and end", () => {
    expect(parseCommentBody("@alice and @bob_2")).toEqual([
      { type: "mention", value: "alice" },
      { type: "text", value: " and " },
      { type: "mention", value: "bob_2" },
    ]);
  });

  it("lowercases mentions", () => {
    expect(parseCommentBody("@Dev_User")).toEqual([{ type: "mention", value: "dev_user" }]);
  });

  it("ignores an email-like @ that isn't a valid username shape", () => {
    expect(parseCommentBody("contact me @ noon")).toEqual([
      { type: "text", value: "contact me @ noon" },
    ]);
  });

  // TASK-23: MENTION_PATTERN had no left boundary, so the @ inside an email
  // address matched — "mika@storylane.dev" produced a false "storylane"
  // mention (and a mention chip rendered mid-address).
  it("does not treat the @ inside an email address as a mention", () => {
    expect(parseCommentBody("reach me at mika@storylane.dev")).toEqual([
      { type: "text", value: "reach me at mika@storylane.dev" },
    ]);
  });

  it("still recognizes a mention right after an email, separated by a space", () => {
    expect(parseCommentBody("cc mika@storylane.dev @alice")).toEqual([
      { type: "text", value: "cc mika@storylane.dev " },
      { type: "mention", value: "alice" },
    ]);
  });
});

describe("extractMentions", () => {
  it("returns distinct lowercased usernames", () => {
    expect(extractMentions("@Alice ping @alice and @bob")).toEqual(["alice", "bob"]);
  });

  it("returns an empty array when there are no mentions", () => {
    expect(extractMentions("no mentions here")).toEqual([]);
  });

  it("does not extract a false mention from an email address", () => {
    expect(extractMentions("reach me at mika@storylane.dev")).toEqual([]);
  });
});
