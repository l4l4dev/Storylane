import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // core-web-vitals ships only a subset of jsx-a11y (alt-text, aria-*, role-*).
  // The rest — label association, keyboard handlers on interactive elements — is
  // what an accessibility audit is actually looking for, so it runs in CI rather
  // than being re-audited by hand each time (TASK-217).
  //
  // Rules only, not the whole flat config: core-web-vitals already registers the
  // jsx-a11y plugin, and a second registration is a hard config error.
  {
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Every autoFocus here is on an input that does not exist until the user
      // clicks the affordance revealing it (quick-add, inline rename). Focus
      // following that click is the point — without it every inline edit costs
      // two clicks. The rule is aimed at autoFocus on load, which steals focus
      // from a user who asked for nothing; this codebase has none of those.
      "jsx-a11y/no-autofocus": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
