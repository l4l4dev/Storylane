import tseslint from "typescript-eslint";
import noAwaitInTransaction from "./eslint-rules/no-await-in-transaction.js";

export default tseslint.config(
  { ignores: ["src/db/migrations/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    plugins: { local: { rules: { "no-await-in-transaction": noAwaitInTransaction } } },
    rules: { "local/no-await-in-transaction": "error" },
  },
);
