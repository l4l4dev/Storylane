import { defineConfig, devices } from "@playwright/test";

// Local-only E2E config (Task 13, TASK-2). Requires `supabase start` to
// already be running (the test talks to the local Supabase instance
// directly for setup — see e2e/helpers/admin-client.ts) and reads
// SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL from .env.local.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local is optional if the env vars are already set some other way.
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
