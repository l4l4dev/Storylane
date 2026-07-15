import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-63: integrations.webhook_secret must never be readable by an
// authenticated client, only writable, while service_role (the git-webhook
// Edge Function) can still read it. RLS gates rows, not columns, so this is
// enforced by column-level SELECT privilege (20260715000007). This test is the
// backstop: it proves the owner can set the secret but not read it back, and
// that service_role can.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/webhook-secret-redaction.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const SECRET = "hmac-secret-do-not-leak";

describe.skipIf(!RUN)("webhook_secret redaction (integration)", () => {
  let asOwner: SupabaseClient; // dev user, authenticated (project owner)
  let asService: SupabaseClient; // service role: reads the secret, cleanup
  let projectId: string;

  beforeAll(async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // fall through; missing env fails loudly below.
      }
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set");
    }

    asService = createClient(url, serviceKey, { auth: { persistSession: false } });

    asOwner = createClient(url, anonKey);
    const ownerAuth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }

    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name: "webhook_secret redaction test" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await asService.from("projects").delete().eq("id", projectId);
    }
  });

  it("owner can write the secret on create (no representation read-back trap)", async () => {
    const { error } = await asOwner.from("integrations").insert({
      project_id: projectId,
      provider: "github",
      config: { repo_url: "https://example.test/owner/repo" },
      is_active: true,
      webhook_secret: SECRET,
    });
    expect(error).toBeNull();
  });

  it("owner can read the non-secret columns", async () => {
    const { data, error } = await asOwner
      .from("integrations")
      .select("id, provider, config, is_active")
      .eq("project_id", projectId)
      .eq("provider", "github")
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.provider).toBe("github");
  });

  it("authenticated cannot SELECT webhook_secret (AC #1)", async () => {
    const { error } = await asOwner
      .from("integrations")
      .select("webhook_secret")
      .eq("project_id", projectId)
      .eq("provider", "github")
      .maybeSingle();
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied|webhook_secret/i);
  });

  it("service_role can read webhook_secret (AC #3 — Edge Function path)", async () => {
    const { data, error } = await asService
      .from("integrations")
      .select("webhook_secret")
      .eq("project_id", projectId)
      .eq("provider", "github")
      .maybeSingle();
    expect(error).toBeNull();
    expect((data as { webhook_secret?: string } | null)?.webhook_secret).toBe(SECRET);
  });

  it("blank secret on edit keeps the stored one (set/rotate semantics, AC #2)", async () => {
    // Update without webhook_secret in the payload — the unlisted column is left
    // untouched, mirroring saveIntegration's blank-on-edit path.
    const { error } = await asOwner
      .from("integrations")
      .update({ config: { repo_url: "https://example.test/owner/repo-renamed" }, is_active: true })
      .eq("project_id", projectId)
      .eq("provider", "github");
    expect(error).toBeNull();

    const { data } = await asService
      .from("integrations")
      .select("webhook_secret, config")
      .eq("project_id", projectId)
      .eq("provider", "github")
      .maybeSingle();
    expect((data as { webhook_secret?: string } | null)?.webhook_secret).toBe(SECRET);
  });
});
