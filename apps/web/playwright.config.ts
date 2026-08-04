import { defineConfig, devices } from "@playwright/test";

// Runs locally and on CI (web-ci.yml "Run E2E (web)"). Either way a Supabase
// stack must already be up — the specs talk to it directly for setup (see
// e2e/helpers/admin-client.ts) and the login shortcut needs the account
// supabase/seed.sql seeds. Locally that is `supabase start` plus .env.local;
// on CI the workflow exports the same three vars from `supabase status`.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Absent on CI, and optional locally when the env vars are set another way.
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  // Next.js dev mode compiles each route on first request (Turbopack), and
  // the iteration-rollover request in particular does several sequential
  // DB round-trips plus a Slack-notify attempt — both can comfortably
  // exceed Playwright's 30s/5s defaults on a cold local dev server.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // `next dev`, not `next start`: /auth/login's "Continue as dev user" button
  // renders only under NODE_ENV !== "production", and it is the only way in
  // without a real OAuth provider.
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    // A cold CI runner has to boot the server and compile the first route
    // before it answers; 60s was enough only for a warm local start.
    timeout: 120_000,
  },
});
