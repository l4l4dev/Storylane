import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Dot reporter keeps local (AI-driven) runs terse; CI keeps the readable default.
    reporters: process.env.CI ? "default" : "dot",
    // e2e/ holds Playwright specs (run via `pnpm test:e2e`), not Vitest ones —
    // exclude them (on top of Vitest's own defaults, which this list
    // replaces rather than merges with) so Vitest doesn't try to run them
    // with the wrong test().
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/e2e/**",
    ],
  },
});
