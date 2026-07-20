import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-88 AC #1/#3: story_pins RLS (no cross-user visibility, member-only
// INSERT) and the two lifecycle writes that live in SECURITY DEFINER RPCs —
// move_story_to_project's pin carry-over and remove_member's pin purge
// (supabase/migrations/20260720000004_story_pins.sql, 20260720000005_pin_lifecycle.sql).
// Needs two real users, so it creates the second one via the service-role
// admin API. Same opt-in gate as the other integration tests:
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/story-pins.integration.test.ts
//
// Requires `supabase start` running locally with the seeded dev user.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const SECOND_EMAIL = "task88-pinner@storylane.local";
const SECOND_PASSWORD = "task88-local-only-password";

describe.skipIf(!RUN)("story_pins RLS and lifecycle (integration)", () => {
  let asOwner: SupabaseClient; // dev user — member of both projects
  let asPinner: SupabaseClient; // second user — member of SHARED only
  let asService: SupabaseClient; // service role: the only cross-user read
  let ownerId: string;
  let pinnerId: string;
  let sharedProjectId: string; // both users are members
  let ownerOnlyProjectId: string; // the move destination; pinner is not a member

  async function createStory(projectId: string, title: string): Promise<string> {
    const { data, error } = await asOwner
      .from("stories")
      .insert({ project_id: projectId, title, story_type: "feature" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to create story: ${error?.message}`);
    return data.id;
  }

  // Pins are invisible across users by design, so every assertion about
  // another user's pins has to come from the service role.
  async function pinnedUserIds(storyId: string): Promise<string[]> {
    const { data } = await asService.from("story_pins").select("user_id").eq("story_id", storyId);
    return (data ?? []).map((row) => row.user_id as string).sort();
  }

  async function addPinnerAsMember() {
    await asOwner.rpc("invite_member", {
      p_project_id: sharedProjectId,
      p_user_id: pinnerId,
      p_role: "member",
    });
  }

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

    const created = await asService.auth.admin.createUser({
      email: SECOND_EMAIL,
      password: SECOND_PASSWORD,
      email_confirm: true,
    });
    if (created.data.user) {
      pinnerId = created.data.user.id;
    } else {
      const { data: list } = await asService.auth.admin.listUsers();
      const existing = list.users.find((u) => u.email === SECOND_EMAIL);
      if (!existing) {
        throw new Error(`Could not create or find the second test user: ${created.error?.message}`);
      }
      pinnerId = existing.id;
    }

    asOwner = createClient(url, anonKey);
    const ownerAuth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }
    ownerId = ownerAuth.data.user.id;

    asPinner = createClient(url, anonKey);
    const pinnerAuth = await asPinner.auth.signInWithPassword({
      email: SECOND_EMAIL,
      password: SECOND_PASSWORD,
    });
    if (pinnerAuth.error) {
      throw new Error(`Second-user sign-in failed: ${pinnerAuth.error.message}`);
    }

    const { data: shared, error: sharedError } = await asOwner
      .from("projects")
      .insert({ name: "story_pins shared project" })
      .select("id")
      .single();
    if (sharedError || !shared) throw new Error(`Failed to create shared project: ${sharedError?.message}`);
    sharedProjectId = shared.id;

    const { data: ownerOnly, error: ownerOnlyError } = await asOwner
      .from("projects")
      .insert({ name: "story_pins owner-only project" })
      .select("id")
      .single();
    if (ownerOnlyError || !ownerOnly) {
      throw new Error(`Failed to create owner-only project: ${ownerOnlyError?.message}`);
    }
    ownerOnlyProjectId = ownerOnly.id;

    await addPinnerAsMember();
  });

  afterAll(async () => {
    for (const id of [sharedProjectId, ownerOnlyProjectId]) {
      if (id) await asService.from("projects").delete().eq("id", id);
    }
    if (pinnerId) await asService.auth.admin.deleteUser(pinnerId);
  });

  it("a member can pin a story in their own project", async () => {
    const storyId = await createStory(sharedProjectId, "pin me");

    const { error } = await asPinner.from("story_pins").insert({ user_id: pinnerId, story_id: storyId });

    expect(error).toBeNull();
    expect(await pinnedUserIds(storyId)).toEqual([pinnerId]);
  });

  it("one user's pins are invisible to another user (AC #1)", async () => {
    const storyId = await createStory(sharedProjectId, "privately pinned");
    await asPinner.from("story_pins").insert({ user_id: pinnerId, story_id: storyId });

    const { data, error } = await asOwner.from("story_pins").select("user_id, story_id").eq("story_id", storyId);

    // Not an error — RLS filters the row out, so the owner simply sees nothing.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await pinnedUserIds(storyId)).toEqual([pinnerId]);
  });

  it("a user cannot create a pin on someone else's behalf", async () => {
    const storyId = await createStory(sharedProjectId, "not yours to pin");

    const { error } = await asPinner.from("story_pins").insert({ user_id: ownerId, story_id: storyId });

    expect(error).not.toBeNull();
    expect(await pinnedUserIds(storyId)).toEqual([]);
  });

  it("a user cannot pin a story in a project they are not a member of (AC #1)", async () => {
    const storyId = await createStory(ownerOnlyProjectId, "out of reach");

    const { error } = await asPinner.from("story_pins").insert({ user_id: pinnerId, story_id: storyId });

    expect(error).not.toBeNull();
    expect(await pinnedUserIds(storyId)).toEqual([]);
  });

  it("a user can remove their own pin", async () => {
    const storyId = await createStory(sharedProjectId, "unpin me");
    await asPinner.from("story_pins").insert({ user_id: pinnerId, story_id: storyId });

    const { error } = await asPinner.from("story_pins").delete().eq("story_id", storyId);

    expect(error).toBeNull();
    expect(await pinnedUserIds(storyId)).toEqual([]);
  });

  it("move carries a pin only for pinners who are members of the destination (AC #3)", async () => {
    const storyId = await createStory(sharedProjectId, "moving with pins");
    await asOwner.from("story_pins").insert({ user_id: ownerId, story_id: storyId });
    await asPinner.from("story_pins").insert({ user_id: pinnerId, story_id: storyId });
    expect(await pinnedUserIds(storyId)).toEqual([ownerId, pinnerId].sort());

    const { data, error } = await asOwner.rpc("move_story_to_project", {
      p_story_id: storyId,
      p_target_project_id: ownerOnlyProjectId,
    });
    expect(error).toBeNull();

    const movedId = (data as { story_id: string }).story_id;
    expect(await pinnedUserIds(movedId)).toEqual([ownerId]);
    // The source story is deleted by the move; its pins cascade with it.
    expect(await pinnedUserIds(storyId)).toEqual([]);
  });

  it("remove_member deletes the removed user's pins in that project (AC #3)", async () => {
    const storyId = await createStory(sharedProjectId, "pinned by a leaver");
    await asPinner.from("story_pins").insert({ user_id: pinnerId, story_id: storyId });
    await asOwner.from("story_pins").insert({ user_id: ownerId, story_id: storyId });

    const { error } = await asOwner.rpc("remove_member", {
      p_project_id: sharedProjectId,
      p_user_id: pinnerId,
    });
    expect(error).toBeNull();

    expect(await pinnedUserIds(storyId)).toEqual([ownerId]);

    // A re-invite must not revive the pins.
    await addPinnerAsMember();
    expect(await pinnedUserIds(storyId)).toEqual([ownerId]);
  });
});
