import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-54 AC #1/#2/#3: exercises the membership-admin RPCs and the
// last-owner invariant (supabase/migrations/20260715000004_membership_admin_rpcs.sql)
// against a running local Supabase. Needs two real users, so it creates a
// second one via the service-role admin API. Same opt-in gate as the other
// integration tests:
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/membership.integration.test.ts
//
// Requires `supabase start` running locally with the seeded dev user.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const SECOND_EMAIL = "task54-member@storylane.local";
const SECOND_PASSWORD = "task54-local-only-password";

describe.skipIf(!RUN)("membership admin RPCs (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asMember: SupabaseClient; // the second user
  let asService: SupabaseClient; // service role: admin.createUser + cleanup
  let ownerId: string;
  let memberId: string;
  let projectId: string;

  async function roleOf(userId: string): Promise<string | null> {
    const { data } = await asService
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    return data?.role ?? null;
  }

  // Reset to the canonical state (dev = sole owner, second user = member) so
  // each test starts from a known membership regardless of order.
  async function resetMembership() {
    await asService.from("project_members").delete().eq("project_id", projectId).neq("user_id", ownerId);
    await asService
      .from("project_members")
      .update({ role: "owner" })
      .eq("project_id", projectId)
      .eq("user_id", ownerId);
    await asService
      .from("project_members")
      .insert({ project_id: projectId, user_id: memberId, role: "member" });
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

    // Second user (admin-create is idempotent enough for a local box: if it
    // already exists from a prior run, look it up instead).
    const created = await asService.auth.admin.createUser({
      email: SECOND_EMAIL,
      password: SECOND_PASSWORD,
      email_confirm: true,
    });
    if (created.data.user) {
      memberId = created.data.user.id;
    } else {
      const { data: list } = await asService.auth.admin.listUsers();
      const existing = list.users.find((u) => u.email === SECOND_EMAIL);
      if (!existing) {
        throw new Error(`Could not create or find the second test user: ${created.error?.message}`);
      }
      memberId = existing.id;
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

    asMember = createClient(url, anonKey);
    const memberAuth = await asMember.auth.signInWithPassword({
      email: SECOND_EMAIL,
      password: SECOND_PASSWORD,
    });
    if (memberAuth.error) {
      throw new Error(`Second-user sign-in failed: ${memberAuth.error.message}`);
    }

    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name: "membership RPC integration test" })
      .select("id")
      .single();
    if (projectError || !project) {
      throw new Error(`Failed to create test project: ${projectError?.message}`);
    }
    projectId = project.id;
    await resetMembership();
  });

  afterAll(async () => {
    if (projectId) {
      await asService.from("projects").delete().eq("id", projectId);
    }
    if (memberId) {
      await asService.auth.admin.deleteUser(memberId);
    }
  });

  it("owner can change a member's role", async () => {
    await resetMembership();
    const { error } = await asOwner.rpc("change_member_role", {
      p_project_id: projectId,
      p_user_id: memberId,
      p_role: "viewer",
    });
    expect(error).toBeNull();
    expect(await roleOf(memberId)).toBe("viewer");
  });

  it("the last owner cannot demote themselves (AC #1)", async () => {
    await resetMembership();
    const { error } = await asOwner.rpc("change_member_role", {
      p_project_id: projectId,
      p_user_id: ownerId,
      p_role: "member",
    });
    expect(error?.message).toMatch(/last owner/i);
    expect(await roleOf(ownerId)).toBe("owner");
  });

  it("the last owner cannot remove themselves (AC #1)", async () => {
    await resetMembership();
    const { error } = await asOwner.rpc("remove_member", { p_project_id: projectId, p_user_id: ownerId });
    expect(error?.message).toMatch(/last owner/i);
    expect(await roleOf(ownerId)).toBe("owner");
  });

  it("a co-owner CAN be demoted while another owner remains", async () => {
    await resetMembership();
    // Promote the member to owner → two owners.
    await asOwner.rpc("change_member_role", { p_project_id: projectId, p_user_id: memberId, p_role: "owner" });
    expect(await roleOf(memberId)).toBe("owner");
    // Now demoting one of the two is allowed.
    const { error } = await asOwner.rpc("change_member_role", {
      p_project_id: projectId,
      p_user_id: memberId,
      p_role: "member",
    });
    expect(error).toBeNull();
    expect(await roleOf(memberId)).toBe("member");
  });

  it("a non-owner cannot change roles (AC #1 — no takeover path)", async () => {
    await resetMembership();
    const { error } = await asMember.rpc("change_member_role", {
      p_project_id: projectId,
      p_user_id: ownerId,
      p_role: "member",
    });
    expect(error?.message).toMatch(/only project owners/i);
    expect(await roleOf(ownerId)).toBe("owner");
  });

  it("a member can remove themselves (self-leave)", async () => {
    await resetMembership();
    const { error } = await asMember.rpc("remove_member", { p_project_id: projectId, p_user_id: memberId });
    expect(error).toBeNull();
    expect(await roleOf(memberId)).toBeNull();
  });

  it("an owner can remove another member", async () => {
    await resetMembership();
    const { error } = await asOwner.rpc("remove_member", { p_project_id: projectId, p_user_id: memberId });
    expect(error).toBeNull();
    expect(await roleOf(memberId)).toBeNull();
  });

  it("direct UPDATE/DELETE on project_members is denied for an owner (AC #2)", async () => {
    await resetMembership();
    // RLS UPDATE/DELETE policies were dropped, so these affect zero rows.
    await asOwner.from("project_members").update({ role: "viewer" }).eq("project_id", projectId).eq("user_id", memberId);
    expect(await roleOf(memberId)).toBe("member"); // unchanged

    await asOwner.from("project_members").delete().eq("project_id", projectId).eq("user_id", memberId);
    expect(await roleOf(memberId)).toBe("member"); // still there
  });

  it("re-inviting an existing member is rejected and never changes their role (AC #1)", async () => {
    await resetMembership();
    // Make the member an owner, then a re-invite as 'member' must NOT demote them.
    await asOwner.rpc("change_member_role", { p_project_id: projectId, p_user_id: memberId, p_role: "owner" });
    const { error } = await asOwner.rpc("invite_member", {
      p_project_id: projectId,
      p_user_id: memberId,
      p_role: "member",
    });
    expect(error?.message).toMatch(/already a member/i);
    expect(await roleOf(memberId)).toBe("owner"); // role untouched
  });
});
