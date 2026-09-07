import { describe, expect, it } from "bun:test";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "../eslint-rules/no-project-tx-escape.js";

const linter = new Linter({ configType: "flat" });
const config = [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { local: { rules: { "no-project-tx-escape": rule } } },
    rules: { "local/no-project-tx-escape": "error" },
  },
];
const lint = (code: string) => linter.verify(code, config as never, "x.ts");

describe("local/no-project-tx-escape", () => {
  it("flags tx.tx member access", () => {
    const out = lint(`export const r = (tx) => tx.tx.select().from(t).all();`);
    expect(out).toHaveLength(1);
    expect(out[0]!.messageId).toBe("noEscape");
  });

  it("flags a renamed handle", () => {
    expect(lint(`const ptx = get(); ptx.tx.run("x");`)).toHaveLength(1);
  });

  it("flags computed access spelled as a literal", () => {
    expect(lint(`const ptx = get(); ptx["tx"].run("x");`)).toHaveLength(1);
  });

  it("allows this.tx inside the class that owns the handle", () => {
    expect(lint(`class P { get tx() { return this.#tx; } }`)).toHaveLength(0);
  });

  it("allows an unrelated property named txId", () => {
    expect(lint(`const a = row.txId;`)).toHaveLength(0);
  });
});
