import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-219: the config an RPC is the only enforcement of is pinned with
// `select ... for share` (spec/rls.md "Pin the config a SECURITY DEFINER RPC
// enforces itself"), replacing the per-value re-reads at the exit.
//
// A two-transaction race cannot test this either (doc-25): the outcome depends on
// which side commits first, so it passes against an unpinned body too. What is
// asserted instead is the observable property the pin creates — while a third
// session holds the config row EXCLUSIVELY, the RPC must park on it. Remove any
// `for share` and the RPC sails past, waitUntilBlocked times out, and the case
// fails. The last test is the mirror image: a session holding the same row in
// SHARE must NOT block the RPC, which is what would break if a `for share` were
// ever written as `for update` and quietly serialized every call in the project.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/config-pin-for-share.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

const TIMEOUT = 30_000;
const DB_URL = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe.skipIf(!RUN)("RPC config pinned with FOR SHARE (integration)", () => {
  let asOwner: SupabaseClient;
  let asService: SupabaseClient;
  let ownerId: string;
  let secondUserId: string;
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
    asOwner = createClient(url, anonKey, { auth: { persistSession: false } });
    const auth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    ownerId = auth.data.user.id;

    const { data: made, error: makeError } = await asService.auth.admin.createUser({
      email: `config-pin-assignee-${Date.now()}@storylane.local`,
      password: "integration-test-only-password",
      email_confirm: true,
    });
    if (makeError || !made.user) throw new Error(`Failed to create second user: ${makeError?.message}`);
    secondUserId = made.user.id;

    // Warm the PostgREST path. A cold first round trip in this file can take
    // seconds, and every test below spends that budget waiting for the RPC to
    // park on a held row — a cold call looks exactly like a missing pin.
    // point_scale_values is a pure function, so it also checks its own grant.
    const warm = await asOwner.rpc("point_scale_values", { p_scale: "fibonacci", p_custom: [] });
    expect(warm.error).toBeNull();
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await asService.from("projects").delete().eq("id", id);
    }
    if (secondUserId) await asService.auth.admin.deleteUser(secondUserId);
  });

  async function createProject(name: string): Promise<string> {
    const { data, error } = await asOwner.from("projects").insert({ name }).select("id").single();
    if (error || !data) throw new Error(`Failed to create test project: ${error?.message}`);
    createdProjectIds.push(data.id);
    return data.id;
  }

  /**
   * Blocks until some other backend is waiting on a lock this connection holds.
   * pg_blocking_pids is exact: it names the holder, so an unrelated waiter
   * elsewhere in the suite cannot make the assertion pass by accident.
   */
  async function waitUntilBlocked(
    holder: PgClient,
    holderPid: number,
    // Reports the RPC's result once it has one. An RPC that returns while the row
    // is still held never blocked, and saying so with its payload separates a
    // missing pin from a call that failed on its way in.
    settled: () => unknown,
  ): Promise<void> {
    // Under the `authenticated` role's 8s statement_timeout: give up well inside
    // it, or a slow detection kills the RPC first and the failure reads as a
    // spurious 57014 instead of naming the missing pin.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { rows } = await holder.query(
        `select count(*)::int as n from pg_stat_activity
          where pid <> $1 and $1 = any(pg_blocking_pids(pid))`,
        [holderPid],
      );
      if (rows[0].n > 0) return;
      const early = settled();
      if (early !== undefined) {
        throw new Error(`the RPC returned while the row was held, so it never pinned it: ${JSON.stringify(early)}`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    const { rows: activity } = await holder.query(
      `select pid, state, wait_event_type, wait_event, left(query, 60) as query
         from pg_stat_activity where datname = current_database() and pid <> $1`,
      [holderPid],
    );
    throw new Error(
      `the RPC never parked on the pinned row — its \`for share\` is gone. activity=${JSON.stringify(activity)}`,
    );
  }

  /**
   * Asserts `sql` cannot run right now: a short statement_timeout turns the wait
   * on a lock the RPC under test holds into 57014. Its own connection, since the
   * caller's is already holding a lock that RPC is parked on.
   */
  async function expectBlocked(sql: string, params: unknown[]): Promise<void> {
    const probe = new PgClient({ connectionString: DB_URL() });
    await probe.connect();
    try {
      await probe.query("begin");
      await probe.query("set local statement_timeout = '750ms'");
      await probe.query(sql, params);
      throw new Error(`the RPC does not hold this lock yet: ${sql}`);
    } catch (e) {
      if ((e as { code?: string }).code !== "57014") throw e;
    } finally {
      await probe.query("rollback").catch(() => {});
      await probe.end();
    }
  }

  /** Holds `sql`'s rows locked, runs `whileBlocked` once the RPC it fires is blocked, commits. */
  async function whileRowLocked<T>(
    lockSql: string,
    params: unknown[],
    // PromiseLike, not Promise: supabase-js's query builder is a thenable that
    // only dispatches from its own .then(), and is not a real Promise.
    fire: () => PromiseLike<T>,
    whileBlocked?: () => Promise<void>,
  ): Promise<T> {
    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    try {
      const { rows } = await holder.query("select pg_backend_pid() as pid");
      const holderPid = rows[0].pid as number;
      await holder.query("begin");
      const locked = await holder.query(lockSql, params);
      if (locked.rowCount !== 1) {
        throw new Error(`the row to lock was not found (${locked.rowCount} rows) — the test would be vacuous`);
      }
      let early: unknown;
      const pending = Promise.resolve(fire()).then((r) => {
        early = r ?? null;
        return r;
      });
      await waitUntilBlocked(holder, holderPid, () => early);
      if (whileBlocked) await whileBlocked();
      await holder.query("commit");
      return await pending;
    } finally {
      await holder.end();
    }
  }

  it("reshape_current_iteration parks on the pinned projects row (iteration_length)", async () => {
    const projectId = await createProject("config pin: reshape");

    const settled = await whileRowLocked(
      "select id from public.projects where id = $1 for no key update",
      [projectId],
      () => asOwner.rpc("reshape_current_iteration", { p_project_id: projectId }),
    );

    // Asserted as one object so a failure names the cause instead of just "not
    // noop". A fresh project has no iteration yet, which is the benign no-op —
    // enough to show the call ran its body rather than being refused before the
    // pin.
    expect({
      error: settled.error?.message ?? null,
      kind: (settled.data as { kind?: string } | null)?.kind,
    }).toEqual({ error: null, kind: "noop" });
  }, TIMEOUT);

  /** A project wired for finish_story_from_git: iteration, github integration onto Finished, one Unstarted story. */
  async function seedGitProject(name: string) {
    const projectId = await createProject(name);
    // service_role: authenticated clients cannot INSERT iterations (TASK-110).
    const { error: iterationError } = await asService
      .from("iterations")
      .insert({ project_id: projectId, number: 1, start_date: "2026-07-15", end_date: "2026-07-28" });
    expect(iterationError).toBeNull();

    const { data: stateRows } = await asOwner.from("project_states").select("id, name").eq("project_id", projectId);
    const states = Object.fromEntries((stateRows ?? []).map((s) => [s.name, s.id])) as Record<string, string>;
    const { error: integrationError } = await asOwner.from("integrations").insert({
      project_id: projectId,
      provider: "github",
      config: { merge_target_state_id: states.Finished },
      is_active: true,
    });
    expect(integrationError).toBeNull();

    const { data: story } = await asOwner
      .from("stories")
      .insert({ project_id: projectId, title: "merged elsewhere", state_id: states.Unstarted, points: 2 })
      .select("id, number")
      .single();
    return { projectId, states, story: story! };
  }

  const finishFromGit = (projectId: string, storyNumber: number) =>
    asService.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: storyNumber,
      p_provider: "github",
    });

  // The forward-only test compares the positions of TWO state rows — the merge
  // target and the story's own — and both are covered by the one whole-set pin,
  // so holding either row must park the call.
  for (const [which, holdState] of [
    ["target", "Finished"],
    ["story's own", "Unstarted"],
  ] as const) {
    it(`finish_story_from_git parks on the pinned ${which} project_states row (position)`, async () => {
      const { projectId, states, story } = await seedGitProject(`config pin: finish from git (${which})`);

      const settled = await whileRowLocked(
        "select id from public.project_states where id = $1 for no key update",
        [states[holdState]],
        () => finishFromGit(projectId, story.number),
      );

      expect(settled.error).toBeNull();
      expect((settled.data as { kind: string }[])[0].kind).toBe("finished");
    }, TIMEOUT);
  }

  it("finish_story_from_git pins the project and its state rows ABOVE the story row lock", async () => {
    // Two deadlocks live below that lock. A state row pinned under it loses to a
    // routine column delete: `delete from project_states` holds the state row and
    // then waits FOR KEY SHARE on the stories referencing it, because
    // stories_state_project_fkey is NO ACTION. And a `projects` row merely probed
    // loses to a project delete, whose cascade reaches stories before the other
    // children. Asserted as the lock order rather than as either race, whose
    // outcome depends on the interleaving: park the RPC on the story row and show
    // it ALREADY holds both — the project row, and the story's own state row,
    // whose identity is only known from the story read.
    const { projectId, states, story } = await seedGitProject("config pin: finish lock order");

    const settled = await whileRowLocked(
      "select id from public.stories where id = $1 for update",
      [story.id],
      () => finishFromGit(projectId, story.number),
      async () => {
        await expectBlocked("select id from public.projects where id = $1 for update", [projectId]);
        await expectBlocked("select id from public.project_states where id = $1 for update", [states.Unstarted]);
      },
    );

    expect(settled.error).toBeNull();
    expect((settled.data as { kind: string }[])[0].kind).toBe("finished");
  }, TIMEOUT);

  it("split_story parks on the pinned projects row (point scale)", async () => {
    const projectId = await createProject("config pin: split");
    const { data: story, error: seedError } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "to be split", story_type: "feature", created_by: ownerId })
      .select("id")
      .single();
    expect(seedError).toBeNull();

    const settled = await whileRowLocked(
      "select id from public.projects where id = $1 for no key update",
      [projectId],
      () =>
        asOwner.rpc("split_story", {
          p_story_id: story!.id,
          p_children: [{ title: "first half", points: 2 }, { title: "second half" }],
        }),
    );

    expect(settled.error).toBeNull();
    expect((settled.data as { child_ids: string[] }).child_ids).toHaveLength(2);
  }, TIMEOUT);

  for (const rpc of ["move_story_to_project", "copy_story_to_project"] as const) {
    it(`${rpc} holds the retained assignee's project_members row through the FK`, async () => {
      const source = await createProject(`config pin: ${rpc} source`);
      const target = await createProject(`config pin: ${rpc} target`);
      // The assignee is kept only if they are a member of the TARGET
      // (spec/features.md), so that is the row the RPC has to hold. TASK-219
      // held it with an explicit `for share`; TASK-221's composite FK took that
      // job over, so the holder below locks FOR UPDATE rather than FOR NO KEY
      // UPDATE — the latter does not conflict with the KEY SHARE an FK check
      // takes, and asserting against it would only re-test the removed clause.
      await asService.from("project_members").insert([
        { project_id: source, user_id: secondUserId, role: "member" },
        { project_id: target, user_id: secondUserId, role: "member" },
      ]);
      const { data: story, error: seedError } = await asService
        .from("stories")
        .insert({
          project_id: source,
          title: "assigned across projects",
          story_type: "chore",
          assignee_id: secondUserId,
          created_by: ownerId,
        })
        .select("id")
        .single();
      expect(seedError).toBeNull();

      const settled = await whileRowLocked(
        "select user_id from public.project_members where project_id = $1 and user_id = $2 for update",
        [target, secondUserId],
        () => asOwner.rpc(rpc, { p_story_id: story!.id, p_target_project_id: target }),
      );

      expect(settled.error).toBeNull();
      const { data: landed } = await asService
        .from("stories")
        .select("assignee_id")
        .eq("id", (settled.data as { story_id: string }).story_id)
        .single();
      expect(landed?.assignee_id).toBe(secondUserId);
    }, TIMEOUT);

    // Both project rows, because both carry something enforced only inside the
    // RPC: archived_at on each side, plus the target's point scale. The archive
    // cases in role-recheck-after-lock park the caller on the advisory lock, which
    // is taken BEFORE these reads, so they stay green without any pin.
    for (const side of ["source", "target"] as const) {
      it(`${rpc} parks on the pinned ${side} projects row`, async () => {
        const source = await createProject(`config pin: ${rpc} ${side} pin source`);
        const target = await createProject(`config pin: ${rpc} ${side} pin target`);
        const { data: story, error: seedError } = await asService
          .from("stories")
          .insert({ project_id: source, title: "crosses projects", story_type: "chore", created_by: ownerId })
          .select("id")
          .single();
        expect(seedError).toBeNull();

        const settled = await whileRowLocked(
          "select id from public.projects where id = $1 for no key update",
          [side === "source" ? source : target],
          () => asOwner.rpc(rpc, { p_story_id: story!.id, p_target_project_id: target }),
        );

        expect(settled.error).toBeNull();
        expect((settled.data as { project_id: string }).project_id).toBe(target);
      }, TIMEOUT);
    }
  }

  it("does not block a concurrent reader of the same config row", async () => {
    // The pin is SHARED. If any of them were written `for update`, two ordinary
    // calls touching one project would serialize on it — this fails then, either
    // by timing out or by the statement timeout PostgREST puts on the call.
    const source = await createProject("config pin: shared source");
    const target = await createProject("config pin: shared target");
    const { data: story } = await asService
      .from("stories")
      .insert({ project_id: source, title: "moves while another call reads", story_type: "chore", created_by: ownerId })
      .select("id")
      .single();

    const reader = new PgClient({ connectionString: DB_URL() });
    await reader.connect();
    try {
      await reader.query("begin");
      await reader.query("select id from public.projects where id = $1 for share", [target]);

      const settled = await Promise.race([
        asOwner.rpc("move_story_to_project", { p_story_id: story!.id, p_target_project_id: target }),
        new Promise<"blocked">((r) => setTimeout(() => r("blocked"), 6_000)),
      ]);
      await reader.query("rollback");

      expect(settled).not.toBe("blocked");
      expect((settled as { error: unknown }).error).toBeNull();
    } finally {
      await reader.end();
    }
  }, TIMEOUT);
});
