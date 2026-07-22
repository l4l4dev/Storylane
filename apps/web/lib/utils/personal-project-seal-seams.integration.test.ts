import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// TASK-147 (owner decision 2026-07-22): the hidden personal project's
// remaining seams — promote_story_to_epic and invite_member both must reject
// is_personal projects (migration 20260722000014_personal_project_seal_seams.sql),
// and project_members' direct client INSERT is locked to RPC-only.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/personal-project-seal-seams.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("personal project seal-the-seams (TASK-147 integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  let ownerId: string;
  let personalProjectId: string;
  let teamProjectId: string;
  const createdStoryIds: string[] = [];

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
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
    supabase = createClient(url, anonKey);
    const auth = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    ownerId = auth.data.user.id;

    // Every user gets exactly one personal project at signup (handle_new_user)
    // — use the dev user's own, rather than fabricating a second one (the
    // partial unique index on (created_by) WHERE is_personal only allows one).
    const { data: personal, error: personalError } = await supabase
      .from("projects")
      .select("id")
      .eq("is_personal", true)
      .eq("created_by", ownerId)
      .single();
    if (personalError || !personal) throw new Error(`Failed to find the dev user's personal project: ${personalError?.message}`);
    personalProjectId = personal.id;

    const { data: team, error: teamError } = await supabase
      .from("projects")
      .insert({ name: "seal-seams team project" })
      .select("id")
      .single();
    if (teamError || !team) throw new Error(`Failed to create test team project: ${teamError?.message}`);
    teamProjectId = team.id;
  });

  afterEach(async () => {
    for (const id of createdStoryIds.splice(0)) {
      await admin.from("stories").delete().eq("id", id);
    }
  });

  afterAll(async () => {
    if (teamProjectId) await admin.from("projects").delete().eq("id", teamProjectId);
  });

  async function createPersonalStory(): Promise<string> {
    const { data, error } = await admin
      .from("stories")
      .insert({ project_id: personalProjectId, title: "Personal task", story_type: "feature", created_by: ownerId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed personal story: ${error?.message}`);
    createdStoryIds.push(data.id);
    return data.id;
  }

  describe("promote_story_to_epic", () => {
    it("rejects promoting a personal-project story", async () => {
      const storyId = await createPersonalStory();
      const { error } = await supabase.rpc("promote_story_to_epic", { p_story_id: storyId });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/cannot be promoted to an epic/i);

      // Nothing happened: the story is untouched, no epic was created.
      const { data: stillThere } = await admin.from("stories").select("id").eq("id", storyId).maybeSingle();
      expect(stillThere).not.toBeNull();
    });

    it("still allows promoting a normal team-project story", async () => {
      const { data: unstarted } = await admin
        .from("project_states")
        .select("id")
        .eq("project_id", teamProjectId)
        .eq("category", "unstarted")
        .single();
      const { data: story } = await admin
        .from("stories")
        .insert({ project_id: teamProjectId, title: "Team story", story_type: "feature", state_id: unstarted!.id, created_by: ownerId })
        .select("id")
        .single();
      const { error, data } = await supabase.rpc("promote_story_to_epic", { p_story_id: story!.id });
      expect(error).toBeNull();
      expect((data as { epic_id: string }).epic_id).toBeTruthy();
    });
  });

  describe("invite_member", () => {
    it("rejects inviting anyone to the personal project", async () => {
      const email = `seal-seams-invitee-${Date.now()}@storylane.local`;
      const { data: created } = await admin.auth.admin.createUser({ email, password: "integration-test-only-password", email_confirm: true });
      const { error } = await supabase.rpc("invite_member", {
        p_project_id: personalProjectId,
        p_user_id: created!.user!.id,
        p_role: "member",
      });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/cannot have members invited/i);

      const { data: members } = await admin.from("project_members").select("user_id").eq("project_id", personalProjectId);
      expect(members).toHaveLength(1); // only the owner — no invite landed
    });

    it("still allows inviting to a normal team project", async () => {
      const email = `seal-seams-team-invitee-${Date.now()}@storylane.local`;
      const { data: created } = await admin.auth.admin.createUser({ email, password: "integration-test-only-password", email_confirm: true });
      const { error } = await supabase.rpc("invite_member", {
        p_project_id: teamProjectId,
        p_user_id: created!.user!.id,
        p_role: "member",
      });
      expect(error).toBeNull();
    });
  });

  describe("project_members direct INSERT lockdown", () => {
    it("rejects a direct client INSERT even by the project's owner", async () => {
      const email = `seal-seams-direct-insert-${Date.now()}@storylane.local`;
      const { data: created } = await admin.auth.admin.createUser({ email, password: "integration-test-only-password", email_confirm: true });
      const { error } = await supabase
        .from("project_members")
        .insert({ project_id: teamProjectId, user_id: created!.user!.id, role: "member" });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501"); // grant revoked — RPC-only now
    });
  });
});
