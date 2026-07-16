import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-58 item 4 (AC#4): create_project (20260716000008) commits the project row
// and its free-mode template columns in one transaction, so a free project can
// never exist without board columns. Runs against a local Supabase instance.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/create-project.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("create_project RPC (integration)", () => {
  let asOwner: SupabaseClient;
  let asService: SupabaseClient;
  const createdProjectIds: string[] = [];

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
    const auth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error.message}`);
    }
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await asService.from("projects").delete().eq("id", id);
    }
  });

  async function create(statuses: { name: string; color: string; is_done: boolean }[], mode: string) {
    const { data, error } = await asOwner.rpc("create_project", {
      p_name: "create_project integration test",
      p_iteration_length: 14,
      p_point_scale: "fibonacci",
      p_velocity_window: 3,
      p_workflow_mode: mode,
      p_statuses: statuses,
    });
    if (data) createdProjectIds.push(data as string);
    return { data, error };
  }

  it("creates the project, registers the caller as owner, and seeds the template columns in order", async () => {
    const { data: projectId, error } = await create(
      [
        { name: "To do", color: "#6b7280", is_done: false },
        { name: "Doing", color: "#3b82f6", is_done: false },
        { name: "Done", color: "#22c55e", is_done: true },
      ],
      "free",
    );
    expect(error).toBeNull();
    expect(projectId).toBeTruthy();

    const { data: membership } = await asService
      .from("project_members")
      .select("role")
      .eq("project_id", projectId as string)
      .single();
    expect(membership?.role).toBe("owner");

    const { data: columns } = await asService
      .from("custom_statuses")
      .select("name, position")
      .eq("project_id", projectId as string)
      .order("position");
    expect(columns?.map((c) => c.name)).toEqual(["To do", "Doing", "Done"]);
  });

  it("creates a tracker project with no columns when the status list is empty", async () => {
    const { data: projectId, error } = await create([], "tracker");
    expect(error).toBeNull();

    const { count } = await asService
      .from("custom_statuses")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId as string);
    expect(count).toBe(0);
  });

  it("rolls the project back when a template column is invalid (atomicity)", async () => {
    // A null name violates custom_statuses.name NOT NULL; the whole call must
    // fail with no orphaned project row left behind.
    const { data, error } = await asOwner.rpc("create_project", {
      p_name: "atomicity probe",
      p_iteration_length: 14,
      p_point_scale: "fibonacci",
      p_velocity_window: 3,
      p_workflow_mode: "free",
      p_statuses: [{ color: "#000000", is_done: false }], // name missing
    });
    if (data) createdProjectIds.push(data as string);
    expect(error).not.toBeNull();

    const { count } = await asService
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("name", "atomicity probe");
    expect(count).toBe(0);
  });
});
