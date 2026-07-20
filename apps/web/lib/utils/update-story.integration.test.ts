import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Calls the REAL update_story RPC against the local stack. The 2026-07-20
// full-schema audit found the RPC referencing columns dropped a day earlier
// (custom_status_id, state) — every autosave failed at runtime while the
// unit suite stayed green, because unit tests mock the RPC and
// grant-lockdown only checks EXECUTE grants. This file exists so an RPC
// body that no longer compiles against the current schema fails CI.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/update-story.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("update_story RPC (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
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
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    owner = createClient(url, anonKey);
    const ownerAuth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }

    const { data: project, error } = await owner
      .from("projects")
      .insert({ name: "update-story rpc test" })
      .select("id")
      .single();
    if (error || !project) {
      throw new Error(`Project setup failed: ${error?.message}`);
    }
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await admin.from("projects").delete().eq("id", projectId);
    }
  });

  async function createStory(title: string): Promise<string> {
    const { data, error } = await owner
      .from("stories")
      .insert({ project_id: projectId, title, story_type: "feature" })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Story setup failed: ${error?.message}`);
    }
    return data.id;
  }

  it("saves fields and replaces labels transactionally", async () => {
    const storyId = await createStory("before edit");
    const { data: label } = await owner
      .from("labels")
      .insert({ project_id: projectId, name: "rpc-test-label" })
      .select("id")
      .single();

    const { data, error } = await owner.rpc("update_story", {
      p_story_id: storyId,
      p_title: "after edit",
      p_description: "edited via RPC" as string,
      p_story_type: "bug",
      p_points: 3,
      p_epic_id: null as unknown as string,
      p_assignee_id: null as unknown as string,
      p_label_ids: [label!.id],
    });

    expect(error).toBeNull();
    const row = data?.[0];
    expect(row).toBeDefined();
    expect(row!.title).toBe("after edit");
    expect(row!.story_type).toBe("bug");
    expect(row!.points).toBe(3);
    expect(row!.label_ids).toEqual([label!.id]);
  });

  it("nulls points outside the project point scale instead of failing", async () => {
    const storyId = await createStory("odd points");
    const { data, error } = await owner.rpc("update_story", {
      p_story_id: storyId,
      p_title: "odd points",
      p_description: null as unknown as string,
      p_story_type: "feature",
      p_points: 4,
      p_epic_id: null as unknown as string,
      p_assignee_id: null as unknown as string,
      p_label_ids: [],
    });
    expect(error).toBeNull();
    expect(data?.[0]!.points).toBeNull();
  });

  it("returns zero rows for a story the caller cannot see", async () => {
    const { data, error } = await owner.rpc("update_story", {
      p_story_id: "00000000-0000-0000-0000-000000000000",
      p_title: "ghost",
      p_description: null as unknown as string,
      p_story_type: "feature",
      p_points: null as unknown as number,
      p_epic_id: null as unknown as string,
      p_assignee_id: null as unknown as string,
      p_label_ids: [],
    });
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
