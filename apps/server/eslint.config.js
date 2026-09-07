import tseslint from "typescript-eslint";
import noAwaitInTransaction from "./eslint-rules/no-await-in-transaction.js";
import noProjectTxEscape from "./eslint-rules/no-project-tx-escape.js";

const local = {
  rules: {
    "no-await-in-transaction": noAwaitInTransaction,
    "no-project-tx-escape": noProjectTxEscape,
  },
};

export default tseslint.config(
  { ignores: ["src/db/migrations/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "eslint-rules/**/*.js"],
    plugins: { local },
    rules: { "local/no-await-in-transaction": "error" },
  },
  {
    // Only the layers that legitimately hold the handle are exempt. Tests are exempt too:
    // test/tx.test.ts asserts the helpers' behaviour through it on purpose.
    files: ["src/**/*.ts"],
    ignores: ["src/db/**", "src/services/**"],
    plugins: { local },
    rules: { "local/no-project-tx-escape": "error" },
  },
);
