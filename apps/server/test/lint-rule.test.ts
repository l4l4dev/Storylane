import { describe, expect, it } from "bun:test";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "../eslint-rules/no-await-in-transaction.js";

const linter = new Linter({ configType: "flat" });
const config = [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { local: { rules: { "no-await-in-transaction": rule } } },
    rules: { "local/no-await-in-transaction": "error" },
  },
];
const lint = (code: string) => linter.verify(code, config as never, "x.ts");

describe("local/no-await-in-transaction", () => {
  it("flags await inside db.transaction(async () => …)", () => {
    const out = lint(`db.transaction(async (tx) => { await fetch("x"); tx.run(); });`);
    expect(out).toHaveLength(1);
    expect(out[0]!.messageId).toBe("noAwait");
  });
  it("flags await inside a nested block of the callback", () => {
    expect(lint(`db.transaction(async (tx) => { if (a) { for (const x of y) { await x; } } });`)).toHaveLength(1);
  });
  it("allows await outside", () => {
    expect(lint(`await db.transaction((tx) => { tx.run(); });`)).toHaveLength(0);
  });
  it("allows await in a function defined inside but not the callback itself", () => {
    expect(lint(`db.transaction((tx) => { const later = async () => { await x; }; tx.run(); });`)).toHaveLength(0);
  });
});
