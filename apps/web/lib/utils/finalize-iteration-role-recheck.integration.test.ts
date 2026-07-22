import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-142 (found during TASK-116): finalize_iteration checked the caller's
// role BEFORE taking the iteration_finalize advisory lock but never after, so
// a caller de-membered while blocked on that lock still finalized. It is
// SECURITY DEFINER, so it can't lean on the RLS re-evaluation set_story_state's
// final UPDATE gets — the fix is an explicit require_project_role re-check
// after the lock (20260722000010).
//
// Same deterministic shape as TASK-116's tests: a raw pg connection holds the
// lock so the RPC parks after its pre-lock check, membership is revoked while
// it waits, then the lock is released. supabase-js can't do this — it can't
// hold an advisory lock across statements.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/finalize-iteration-role-recheck.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const LOCK_SQL = (fn: "pg_advisory_lock" | "pg_advisory_unlock") =>
  `select ${fn}(hashtext('iteration_finalize:' || $1))`;

describe.skipIf(!RUN)("finalize_iteration role re-check after the lock (TASK-142 integration)", () => {
  let supabase: SupabaseClient;
  let admin: SupabaseClient;
  let ownerId: string;
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
    admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    supabase = createClient(url, anonKey);
    const { data: auth, error } = await supabase.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (error || !auth.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${error?.message}`);
    }
    ownerId = auth.user.id;
  });

  // The dev user is de-membered by these tests, so cleanup goes through admin.
  afterAll(async () => {
    for (const id of createdProjectIds) {
      await admin.from("projects").delete().eq("id", id);
    }
  });

  async function createProject(name: string): Promise<string> {
    const { data, error } = await supabase.from("projects").insert({ name }).select("id").single();
    if (error || !data) throw new Error(`Failed to create test project: ${error?.message}`);
    createdProjectIds.push(data.id);
    return data.id;
  }

  async function iterationsOf(projectId: string) {
    const { data } = await admin
      .from("iterations")
      .select("id, number, state")
      .eq("project_id", projectId)
      .order("number");
    return data ?? [];
  }

  /**
   * Parks `call()` on the project's iteration_finalize lock, revokes
   * `userId`'s membership while it waits, then releases the lock and returns
   * whatever the call settled with.
   */
  async function callWhileDeMembered<T>(projectId: string, userId: string, call: () => PromiseLike<T>): Promise<T> {
    const holder = new PgClient({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await holder.connect();
    try {
      await holder.query(LOCK_SQL("pg_advisory_lock"), [projectId]);
      // Promise.resolve assimilates the thenable, which is what actually
      // dispatches the request: supabase-js's builder is LAZY — it only issues
      // the HTTP call from its own .then(). Calling rpc() and holding the
      // builder unawaited would send nothing, so the revoke below would land
      // before the RPC even started and we'd be testing the PRE-lock guard
      // (which passes trivially) instead of the post-lock re-check.
      const pending = Promise.resolve(call());
      await new Promise((r) => setTimeout(r, 400)); // let it park on the lock

      const { error: revokeError } = await admin
        .from("project_members")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", userId);
      expect(revokeError).toBeNull();

      await holder.query(LOCK_SQL("pg_advisory_unlock"), [projectId]);
      return await pending;
    } finally {
      await holder.end();
    }
  }

  // AC #2: the manual-finish path (owner/member).
  it("rejects a manual finish when the caller is de-membered while blocked on the lock", async () => {
    const projectId = await createProject("finalize-iteration TOCTOU manual");
    const seed = await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seed.error).toBeNull();
    const [iter1] = await iterationsOf(projectId);
    expect(iter1.state).not.toBe("done");

    const { error } = await callWhileDeMembered(projectId, ownerId, () =>
      supabase.rpc("finalize_iteration", {
        p_project_id: projectId,
        p_manual: true,
        p_iteration_id: iter1.id,
      }),
    );

    expect(error?.code).toBe("42501"); // require_project_role: 'not authorized'

    // No side effects: #1 is untouched and no successor was started.
    const after = await iterationsOf(projectId);
    expect(after).toHaveLength(1);
    expect(after[0].state).toBe(iter1.state);
  });

  // The lazy-rollover path takes the same lock and needs the same re-check.
  it("rejects a lazy rollover when the caller is de-membered while blocked on the lock", async () => {
    const projectId = await createProject("finalize-iteration TOCTOU lazy");
    const seed = await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seed.error).toBeNull();
    const before = await iterationsOf(projectId);

    const { error } = await callWhileDeMembered(projectId, ownerId, () =>
      supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false }),
    );

    expect(error?.code).toBe("42501");
    expect(await iterationsOf(projectId)).toHaveLength(before.length);
  });

  // Guards the regression risk of TASK-142's guard conversion: the lazy path's
  // old guard was is_project_member(), true for ANY role, so the re-check must
  // accept 'viewer' too. Gating lazy rollover to writers would leave a viewer
  // looking at a stale iteration forever.
  it("still lets a VIEWER trigger the lazy rollover (role set preserved)", async () => {
    const projectId = await createProject("finalize-iteration viewer rollover");
    const seed = await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seed.error).toBeNull();

    const email = `finalize-viewer-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: created!.user!.id, role: "viewer" });

    const viewer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await viewer.auth.signInWithPassword({ email, password });

    const { error } = await viewer.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(error).toBeNull(); // not 42501 — viewers are still allowed here
  });

  // And the writer-only half of the split is preserved: a viewer must NOT be
  // able to manually finish an iteration.
  it("still refuses a manual finish from a VIEWER", async () => {
    const projectId = await createProject("finalize-iteration viewer manual");
    const seed = await supabase.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seed.error).toBeNull();
    const [iter1] = await iterationsOf(projectId);

    const email = `finalize-viewer-manual-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: created!.user!.id, role: "viewer" });

    const viewer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await viewer.auth.signInWithPassword({ email, password });

    const { error } = await viewer.rpc("finalize_iteration", {
      p_project_id: projectId,
      p_manual: true,
      p_iteration_id: iter1.id,
    });
    expect(error?.code).toBe("42501");
  });
});
