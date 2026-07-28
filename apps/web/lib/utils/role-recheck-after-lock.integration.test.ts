import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-211: every RPC that takes an advisory lock checked the caller's role
// BEFORE the lock and never after, so a caller demoted or removed while parked
// on it still wrote. These are all SECURITY DEFINER, so there is no RLS
// re-evaluation on their writes to fall back on (20260728073000).
//
// Same harness shape as finalize-iteration-role-recheck.integration.test.ts
// (TASK-142), generalised over the lock key: a raw pg connection holds the lock
// so the RPC parks after its pre-lock check, the caller's access is revoked
// while it waits, then the lock is released. supabase-js cannot do this — it
// cannot hold an advisory lock across statements.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/role-recheck-after-lock.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

// Each case parks a real RPC on a lock and polls for it, so the 5s default is
// too tight even when everything works.
const TIMEOUT = 30_000;

const LOCK_SQL = (fn: "pg_advisory_lock" | "pg_advisory_unlock", prefix: string) =>
  `select ${fn}(hashtext('${prefix}:' || $1))`;

describe.skipIf(!RUN)("role re-check after the advisory lock (TASK-211 integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  let otherId: string;
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
    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const auth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    ownerId = auth.data.user.id;

    const { data: made, error: makeError } = await admin.auth.admin.createUser({
      email: `role-recheck-${Date.now()}@storylane.local`,
      password: "integration-test-only-password",
      email_confirm: true,
    });
    if (makeError || !made.user) throw new Error(`Failed to create second user: ${makeError?.message}`);
    otherId = made.user.id;
  });

  // The dev user loses access during these tests, so cleanup goes through admin.
  afterAll(async () => {
    for (const id of createdProjectIds) {
      await admin.from("projects").delete().eq("id", id);
    }
    if (otherId) await admin.auth.admin.deleteUser(otherId);
  });

  async function createProject(name: string): Promise<string> {
    const { data, error } = await owner.from("projects").insert({ name }).select("id").single();
    if (error || !data) throw new Error(`Failed to create test project: ${error?.message}`);
    createdProjectIds.push(data.id);
    return data.id;
  }

  /**
   * Blocks until some OTHER backend is waiting on `prefix:<projectId>`, i.e.
   * the RPC really is parked past its pre-lock check. pg_locks reports the
   * advisory lock's key split across classid/objid as the high/low halves of
   * the bigint, and granted=false is the waiter.
   */
  async function waitForWaiter(holder: PgClient, prefix: string, projectId: string): Promise<void> {
    // Matched against the row for the lock THIS connection holds rather than by
    // recomputing the key: advisory keys are split across classid/objid as the
    // halves of a bigint, and hashtext returns a signed int, so reassembling it
    // in SQL is easy to get subtly wrong and would silently match nothing.
    const WAITER_SQL = `
      select count(*)::int as n
        from pg_locks w
        join pg_locks g
          on g.locktype = 'advisory' and g.granted and g.pid = pg_backend_pid()
         and w.classid = g.classid and w.objid = g.objid and w.objsubid = g.objsubid
       where w.locktype = 'advisory' and not w.granted`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { rows } = await holder.query(WAITER_SQL);
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`RPC never parked on ${prefix}:${projectId} — the test would be vacuous`);
  }

  /**
   * Blocks until another backend is waiting on a row THIS connection's open
   * transaction has locked. Scoped to the holder's own transaction id: an
   * unscoped count matches any blocked write in the cluster and would let the
   * revocation land before the RPC ever parked.
   */
  async function waitForRowWaiter(holder: PgClient): Promise<void> {
    const SQL = `
      select count(*)::int as n
        from pg_locks w
       where not w.granted
         and w.locktype in ('transactionid', 'tuple')
         and w.pid <> pg_backend_pid()
         and exists (
           select 1 from pg_locks h
            where h.granted and h.pid = pg_backend_pid()
              and h.locktype = 'transactionid'
              and h.transactionid = w.transactionid
         )`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { rows } = await holder.query(SQL);
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("nothing ever blocked on the held row — the test would be vacuous");
  }

  /**
   * Parks `call()` on `prefix:<lockProjectId>`, applies `revoke()` while it
   * waits, then releases the lock and returns what the call settled with.
   */
  async function callWhileRevoked<T>(
    prefix: string,
    lockProjectId: string,
    // PromiseLike, not Promise: supabase-js's query builder is a thenable that
    // only dispatches from its own .then(), and is not a real Promise.
    revoke: () => PromiseLike<unknown>,
    call: () => PromiseLike<T>,
  ): Promise<T> {
    const holder = new PgClient({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await holder.connect();
    try {
      await holder.query(LOCK_SQL("pg_advisory_lock", prefix), [lockProjectId]);
      // supabase-js's builder is lazy — it only issues the request from its own
      // .then(), so Promise.resolve is what actually dispatches it. Holding the
      // builder unawaited would let the revoke land before the RPC even started,
      // testing the pre-lock guard (which passes trivially) instead.
      const pending = Promise.resolve(call());

      // Wait for the RPC to actually PARK on the lock rather than sleeping a
      // fixed interval and hoping. If the revoke lands before the call reaches
      // its pre-lock check, the call fails at that check with the same error and
      // the assertion passes while testing nothing — and remove_member's two
      // guards raise identical messages, so nothing downstream could tell the
      // difference.
      await waitForWaiter(holder, prefix, lockProjectId);

      await revoke();

      await holder.query(LOCK_SQL("pg_advisory_unlock", prefix), [lockProjectId]);
      return await pending;
    } finally {
      await holder.end();
    }
  }

  // Both assert their own result and read the row back. supabase-js reports a
  // failed mutation through .error rather than rejecting, so a silently failed
  // revocation would leave the caller's access intact — and the positive
  // self-leave cases would then pass by performing an ordinary self-removal,
  // never exercising the branch they are named for.
  const demoteOwner = (projectId: string) => async () => {
    const { error } = await admin
      .from("project_members")
      .update({ role: "viewer" })
      .eq("project_id", projectId)
      .eq("user_id", ownerId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", ownerId)
      .single();
    expect(data!.role).toBe("viewer");
  };

  const deMemberOwner = (projectId: string) => async () => {
    const { error } = await admin
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .eq("user_id", ownerId);
    expect(error).toBeNull();
    const { data } = await admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", ownerId);
    expect(data ?? []).toHaveLength(0);
  };

  async function seedStory(projectId: string, fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("stories")
      .insert({ project_id: projectId, title: "s", story_type: "chore", created_by: ownerId, ...fields })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to seed story: ${error?.message}`);
    return data.id;
  }

  // ── membership RPCs (AC #2) ───────────────────────────────────────────────

  it("change_member_role rejects a caller demoted while blocked on the membership lock", async () => {
    const projectId = await createProject("TASK-211 change_member_role");
    await admin.from("project_members").insert({ project_id: projectId, user_id: otherId, role: "member" });

    const { error } = await callWhileRevoked("membership", projectId, demoteOwner(projectId), () =>
      owner.rpc("change_member_role", { p_project_id: projectId, p_user_id: otherId, p_role: "viewer" }),
    );

    expect(error?.code).toBe("42501"); // require_project_role: 'not authorized'

    const { data } = await admin
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", otherId)
      .single();
    expect(data!.role).toBe("member"); // unchanged
  }, TIMEOUT);

  it("remove_member rejects a caller demoted while blocked on the membership lock", async () => {
    const projectId = await createProject("TASK-211 remove_member");
    await admin.from("project_members").insert({ project_id: projectId, user_id: otherId, role: "member" });

    const { error } = await callWhileRevoked("membership", projectId, demoteOwner(projectId), () =>
      owner.rpc("remove_member", { p_project_id: projectId, p_user_id: otherId }),
    );

    expect(error?.message).toMatch(/only project owners can remove other members/i);

    const { data } = await admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", otherId);
    expect(data ?? []).toHaveLength(1); // still a member
  }, TIMEOUT);

  it("remove_member still lets a demoted caller remove THEMSELVES (the bespoke guard survives)", async () => {
    // The entry guard is deliberately not a plain role list: self-leave must
    // keep working for a non-owner, so the re-check re-runs the whole shape.
    const projectId = await createProject("TASK-211 self-leave");
    await admin.from("project_members").insert({ project_id: projectId, user_id: otherId, role: "member" });

    const { error } = await callWhileRevoked("membership", projectId, demoteOwner(projectId), () =>
      owner.rpc("remove_member", { p_project_id: projectId, p_user_id: ownerId }),
    );

    expect(error).toBeNull();
    const { data } = await admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", ownerId);
    expect(data ?? []).toHaveLength(0);
  }, TIMEOUT);

  it("remove_member stays idempotent when a self-leave is completed by someone else mid-wait", async () => {
    // The re-check must not turn a benign race into an error toast: the caller
    // asked to leave, and leaving is exactly what happened while they waited.
    const projectId = await createProject("TASK-211 self-leave race");
    await admin.from("project_members").insert({ project_id: projectId, user_id: otherId, role: "owner" });

    const { error } = await callWhileRevoked("membership", projectId, deMemberOwner(projectId), () =>
      owner.rpc("remove_member", { p_project_id: projectId, p_user_id: ownerId }),
    );

    expect(error).toBeNull();
  }, TIMEOUT);

  // ── board / story RPCs (AC #3) ────────────────────────────────────────────

  it("move_story_board rejects a caller de-membered while blocked on the positions lock", async () => {
    const projectId = await createProject("TASK-211 move_story_board");
    const { data: states } = await admin.from("project_states").select("id, category").eq("project_id", projectId);
    const unstarted = states!.find((s) => s.category === "unstarted")!.id;
    const storyId = await seedStory(projectId, { state_id: unstarted });

    const { error } = await callWhileRevoked("positions", projectId, deMemberOwner(projectId), () =>
      owner.rpc("move_story_board", {
        p_project_id: projectId,
        p_item: { kind: "story", id: storyId },
        p_view: "list",
        p_expected: { state_id: unstarted, iteration_id: null, parent_id: null },
        p_deltas: {},
        p_anchor: {},
      }),
    );

    expect(error?.code).toBe("42501");
  }, TIMEOUT);

  it("split_story rejects a caller de-membered while blocked on the story_number lock", async () => {
    const projectId = await createProject("TASK-211 split_story");
    const { data: states } = await admin.from("project_states").select("id, category").eq("project_id", projectId);
    const unstarted = states!.find((s) => s.category === "unstarted")!.id;
    const storyId = await seedStory(projectId, { state_id: unstarted });

    const { error } = await callWhileRevoked("story_number", projectId, deMemberOwner(projectId), () =>
      owner.rpc("split_story", {
        p_story_id: storyId,
        p_children: [{ title: "child", description: "", story_type: "chore", points: null, task_ids: [] }],
      }),
    );

    expect(error?.code).toBe("42501");

    const { data: kids } = await admin.from("stories").select("id").eq("parent_id", storyId);
    expect(kids ?? []).toHaveLength(0);
  }, TIMEOUT);

  // ── preconditions other than the role, re-read after the lock (AC #6) ─────
  // Without these, deleting the post-lock re-reads leaves every other test in
  // this file green — the role cases never touch archived_at or point_scale.

  // move and copy implement these guards independently, and each checks the
  // source and the target separately, so all four archive guards need their own
  // race — covering one leaves the other three removable without a failure.
  const CROSS_PROJECT_RPCS = ["move_story_to_project", "copy_story_to_project"] as const;

  for (const rpc of CROSS_PROJECT_RPCS) {
    for (const side of ["source", "target"] as const) {
      it(`${rpc} rejects a ${side} archived while the caller was blocked`, async () => {
        const source = await createProject(`TASK-211 ${rpc} ${side} archive source`);
        const target = await createProject(`TASK-211 ${rpc} ${side} archive target`);
        const storyId = await seedStory(source);
        const archived = side === "source" ? source : target;

        const { error } = await callWhileRevoked(
          "story_number",
          target,
          () => admin.from("projects").update({ archived_at: new Date().toISOString() }).eq("id", archived),
          () => owner.rpc(rpc, { p_story_id: storyId, p_target_project_id: target }),
        );

        expect(error?.message).toMatch(new RegExp(`${side} project is archived`, "i"));

        // Neither RPC may have written anything into the target.
        const { count } = await admin
          .from("stories")
          .select("id", { count: "exact", head: true })
          .eq("project_id", target);
        expect(count ?? 0).toBe(0);
        const { data } = await admin.from("stories").select("project_id").eq("id", storyId).single();
        expect(data!.project_id).toBe(source);

        // Leave them unarchived so afterAll's delete can still reach them.
        await admin.from("projects").update({ archived_at: null }).eq("id", archived);
      }, TIMEOUT);
    }

    it(`${rpc} clamps points against a scale WIDENED while the caller was blocked`, async () => {
      // Widening, not narrowing: 8 is off `linear` (0..3) but on `fibonacci`, so
      // the post-lock read must let it through. A narrowing test cannot prove
      // anything here — dropping the re-read leaves v_point_scale NULL, the CASE
      // yields NULL, and the story lands unpointed for the wrong reason, which
      // looks identical to a correct clamp.
      const source = await createProject(`TASK-211 ${rpc} scale source`);
      const target = await createProject(`TASK-211 ${rpc} scale target`);
      // Asserted: a project defaults to fibonacci, so a silently failed setup
      // update plus a silently failed mutation would leave 8 valid throughout
      // and the case would pass even reading the scale before the lock.
      const { error: setupError } = await admin.from("projects").update({ point_scale: "linear" }).eq("id", target);
      expect(setupError).toBeNull();
      const { data: states } = await admin.from("project_states").select("id, category").eq("project_id", source);
      const unstarted = states!.find((s) => s.category === "unstarted")!.id;
      const storyId = await seedStory(source, { story_type: "feature", points: 8, state_id: unstarted });

      const { error } = await callWhileRevoked(
        "story_number",
        target,
        async () => {
          const { error: mutateError } = await admin
            .from("projects")
            .update({ point_scale: "fibonacci" })
            .eq("id", target);
          expect(mutateError).toBeNull();
        },
        () => owner.rpc(rpc, { p_story_id: storyId, p_target_project_id: target }),
      );

      expect(error).toBeNull();

      const { data: landed } = await admin.from("stories").select("points").eq("project_id", target).single();
      expect(landed!.points).toBe(8); // kept, because the NEW scale allows it
    }, TIMEOUT);

    it(`${rpc} re-reads custom_points, not just point_scale, after the lock`, async () => {
      // point_scale stays 'custom' throughout, so only custom_points changes —
      // the scale-swap case above cannot detect a stale custom_points because
      // the CASE branch it exercises never reads that array.
      const source = await createProject(`TASK-211 ${rpc} custom source`);
      const target = await createProject(`TASK-211 ${rpc} custom target`);
      const { error: setupError } = await admin
        .from("projects")
        .update({ point_scale: "custom", custom_points: [1, 2] })
        .eq("id", target);
      expect(setupError).toBeNull();
      const { data: states } = await admin.from("project_states").select("id, category").eq("project_id", source);
      const unstarted = states!.find((s) => s.category === "unstarted")!.id;
      const storyId = await seedStory(source, { story_type: "feature", points: 7, state_id: unstarted });

      const { error } = await callWhileRevoked(
        "story_number",
        target,
        async () => {
          const { error: mutateError } = await admin
            .from("projects")
            .update({ custom_points: [1, 2, 7] })
            .eq("id", target);
          expect(mutateError).toBeNull();
        },
        () => owner.rpc(rpc, { p_story_id: storyId, p_target_project_id: target }),
      );

      expect(error).toBeNull();

      const { data: landed } = await admin.from("stories").select("points").eq("project_id", target).single();
      expect(landed!.points).toBe(7); // kept only if the WIDENED array was read
    }, TIMEOUT);
  }

  // Each cross-project RPC re-checks source and target membership
  // independently, so covering one side per RPC leaves the other two removable.
  for (const rpc of CROSS_PROJECT_RPCS) {
    for (const side of ["source", "target"] as const) {
      it(`${rpc} rejects a caller de-membered from the ${side.toUpperCase()} while blocked`, async () => {
        const source = await createProject(`TASK-211 ${rpc} ${side} role source`);
        const target = await createProject(`TASK-211 ${rpc} ${side} role target`);
        const storyId = await seedStory(source);
        const revoked = side === "source" ? source : target;

        const { error } = await callWhileRevoked("story_number", target, deMemberOwner(revoked), () =>
          owner.rpc(rpc, { p_story_id: storyId, p_target_project_id: target }),
        );

        expect(error?.code).toBe("42501");

        const { count } = await admin
          .from("stories")
          .select("id", { count: "exact", head: true })
          .eq("project_id", target);
        expect(count ?? 0).toBe(0);
        const { data } = await admin.from("stories").select("project_id").eq("id", storyId).single();
        expect(data!.project_id).toBe(source);
      }, TIMEOUT);
    }
  }

  it("move_story_board rejects a caller de-membered while it waited on the STORY ROW", async () => {
    // Its third wait: after both advisory locks it takes `select ... for update`
    // on the story. Parking on the positions lock alone cannot expose this.
    const projectId = await createProject("TASK-211 msb row-lock race");
    const { data: states } = await admin.from("project_states").select("id, category").eq("project_id", projectId);
    const unstarted = states!.find((st) => st.category === "unstarted")!.id;
    const storyId = await seedStory(projectId, { state_id: unstarted });

    const holder = new PgClient({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await holder.connect();
    let settled: { error: { code?: string } | null };
    try {
      await holder.query("begin");
      await holder.query("select id from public.stories where id = $1 for update", [storyId]);

      const pending = Promise.resolve(
        owner.rpc("move_story_board", {
          p_project_id: projectId,
          p_item: { kind: "story", id: storyId },
          p_view: "list",
          p_expected: { state_id: unstarted, iteration_id: null, parent_id: null },
          p_deltas: {},
          p_anchor: {},
        }),
      );

      await waitForRowWaiter(holder);
      await deMemberOwner(projectId)();
      await holder.query("commit");
      settled = await pending;
    } finally {
      await holder.end();
    }

    expect(settled.error?.code).toBe("42501");
  }, TIMEOUT);

  it("insert_board_item rejects a caller de-membered while the story INSERT waited on story_number", async () => {
    // The story branch waits a second time inside assign_story_number's trigger,
    // after the pre-insert check. The divider branch never reaches it.
    const projectId = await createProject("TASK-211 ibi story-number race");

    const { error } = await callWhileRevoked("story_number", projectId, deMemberOwner(projectId), () =>
      owner.rpc("insert_board_item", {
        p_project_id: projectId,
        p_kind: "story",
        p_payload: { title: "quick add" },
        p_anchor: {},
      }),
    );

    expect(error?.code).toBe("42501");

    const { count } = await admin
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    expect(count ?? 0).toBe(0); // the insert was rolled back
  }, TIMEOUT);

  it("insert_board_item rejects a caller de-membered while blocked on the positions lock", async () => {
    // Shares positions:<project> with move_story_board, so leaving quick-add
    // open while the drag path is closed would be an odd half-fix.
    const projectId = await createProject("TASK-211 insert_board_item");

    const { error } = await callWhileRevoked("positions", projectId, deMemberOwner(projectId), () =>
      owner.rpc("insert_board_item", {
        p_project_id: projectId,
        p_kind: "divider",
        p_payload: { label: "note", kind: "note" },
        p_anchor: {},
      }),
    );

    expect(error?.code).toBe("42501");
  }, TIMEOUT);

  it("create_project_state rejects a caller de-membered while blocked on the states lock", async () => {
    const projectId = await createProject("TASK-211 create_project_state");

    const { error } = await callWhileRevoked("project_states_positions", projectId, deMemberOwner(projectId), () =>
      owner.rpc("create_project_state", { p_project_id: projectId, p_name: "Nope", p_category: "unstarted" }),
    );

    expect(error?.code).toBe("42501");

    const { data } = await admin.from("project_states").select("id").eq("project_id", projectId).eq("name", "Nope");
    expect(data ?? []).toHaveLength(0);
  }, TIMEOUT);

  it("reorder_project_state rejects a caller de-membered while blocked on the states lock", async () => {
    const projectId = await createProject("TASK-211 reorder_project_state");
    const { data: states } = await admin
      .from("project_states")
      .select("id")
      .eq("project_id", projectId)
      .order("position");

    const { error } = await callWhileRevoked("project_states_positions", projectId, deMemberOwner(projectId), () =>
      owner.rpc("reorder_project_state", {
        p_project_id: projectId,
        p_state_id: states![states!.length - 1].id,
        p_direction: "up",
      }),
    );

    expect(error?.code).toBe("42501");
  }, TIMEOUT);

  it("finish_story_from_git honours an integration disabled while it waited on the STORY ROW", async () => {
    // The advisory lock is not the only unbounded wait in this RPC: the story's
    // own `select ... for update` is another. Parking on the advisory lock alone
    // leaves the config reads movable back above the row lock with the suite
    // still green, so this case blocks on the row itself.
    const projectId = await createProject("TASK-211 webhook row-lock race");
    const { data: states } = await admin.from("project_states").select("id, name").eq("project_id", projectId);
    const byName = Object.fromEntries(states!.map((s) => [s.name, s.id])) as Record<string, string>;
    const { error: fixtureError } = await admin.from("integrations").insert({
      project_id: projectId,
      provider: "github",
      config: { merge_target_state_id: byName.Finished },
      is_active: true,
    });
    expect(fixtureError).toBeNull();
    const { data: story } = await admin
      .from("stories")
      .insert({ project_id: projectId, title: "row-locked", story_type: "chore", state_id: byName.Unstarted, created_by: ownerId })
      .select("id, number")
      .single();

    const holder = new PgClient({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await holder.connect();
    let result: { data: unknown };
    try {
      await holder.query("begin");
      await holder.query("select id from public.stories where id = $1 for update", [story!.id]);

      const pending = Promise.resolve(
        admin.rpc("finish_story_from_git", {
          p_project_id: projectId,
          p_story_number: story!.number,
          p_provider: "github",
        }),
      );

      await waitForRowWaiter(holder);

      const { error: disableError } = await admin
        .from("integrations")
        .update({ is_active: false })
        .eq("project_id", projectId);
      expect(disableError).toBeNull();

      await holder.query("commit");
      result = await pending;
    } finally {
      await holder.end();
    }

    expect((result.data as { kind: string; reason?: string }[])[0]).toMatchObject({
      kind: "ignored",
      reason: "not_configured",
    });

    const { data: after } = await admin.from("stories").select("state_id").eq("id", story!.id).single();
    expect(after!.state_id).toBe(byName.Unstarted); // untouched
  }, TIMEOUT);

  it("finish_story_from_git honours an integration disabled while it was blocked", async () => {
    // The webhook path takes iteration_finalize:<project>. Its configuration is
    // a precondition enforced only inside the RPC, so it has to be read after
    // the wait — otherwise a disabled integration still transitions the story.
    const projectId = await createProject("TASK-211 webhook config race");
    const { data: states } = await admin.from("project_states").select("id, name").eq("project_id", projectId);
    const byName = Object.fromEntries(states!.map((s) => [s.name, s.id])) as Record<string, string>;
    // Asserted, not fire-and-forget: a failed insert makes the RPC return
    // ignored/not_configured for the wrong reason, and every assertion below
    // would still pass without the post-lock read ever running.
    const { error: fixtureError } = await admin.from("integrations").insert({
      project_id: projectId,
      provider: "github",
      config: { merge_target_state_id: byName.Finished },
      is_active: true,
    });
    expect(fixtureError).toBeNull();
    const { data: story } = await admin
      .from("stories")
      .insert({ project_id: projectId, title: "merged", story_type: "chore", state_id: byName.Unstarted, created_by: ownerId })
      .select("number")
      .single();

    const { data } = await callWhileRevoked(
      "iteration_finalize",
      projectId,
      () => admin.from("integrations").update({ is_active: false }).eq("project_id", projectId),
      () =>
        admin.rpc("finish_story_from_git", {
          p_project_id: projectId,
          p_story_number: story!.number,
          p_provider: "github",
        }),
    );

    expect((data as { kind: string; reason?: string }[])[0]).toMatchObject({
      kind: "ignored",
      reason: "not_configured",
    });

    const { data: after } = await admin
      .from("stories")
      .select("state_id")
      .eq("project_id", projectId)
      .eq("number", story!.number)
      .single();
    expect(after!.state_id).toBe(byName.Unstarted); // untouched
  }, TIMEOUT);

  // ── invite_member: no lock, but not waitless either (AC #4) ───────────────

  it("invite_member still takes no advisory lock", async () => {
    // Recorded as a test rather than a comment so a change that adds a lock here
    // has to confront the decision: holding membership:<project> from another
    // session would block this call indefinitely if it took the lock.
    const projectId = await createProject("TASK-211 invite_member no lock");
    const holder = new PgClient({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await holder.connect();
    try {
      await holder.query(LOCK_SQL("pg_advisory_lock", "membership"), [projectId]);
      const { error } = await owner.rpc("invite_member", {
        p_project_id: projectId,
        p_user_id: otherId,
        p_role: "member",
      });
      expect(error).toBeNull();
    } finally {
      await holder.query(LOCK_SQL("pg_advisory_unlock", "membership"), [projectId]);
      await holder.end();
    }
  }, TIMEOUT);

  it("invite_member rejects a caller demoted while its insert waited on a concurrent removal", async () => {
    // The insert is not waitless: `on conflict do nothing` blocks on a tuple an
    // in-flight remove_member is deleting. The re-check therefore sits AFTER the
    // insert, and raising there rolls it back.
    const projectId = await createProject("TASK-211 invite_member insert wait");
    await admin.from("project_members").insert({ project_id: projectId, user_id: otherId, role: "member" });

    const blocker = new PgClient({
      connectionString: process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await blocker.connect();
    try {
      // Hold a delete of the exact tuple the invite will conflict on.
      await blocker.query("begin");
      await blocker.query("delete from public.project_members where project_id = $1 and user_id = $2", [
        projectId,
        otherId,
      ]);

      const pending = Promise.resolve(
        owner.rpc("invite_member", { p_project_id: projectId, p_user_id: otherId, p_role: "member" }),
      );
      // Wait for the invite's insert to actually block on that tuple. Detected
      // by lock type rather than by matching query text, which PostgREST
      // rewrites: a speculative insert waiting on an uncommitted delete shows up
      // as an ungranted transactionid/tuple lock.
      await waitForRowWaiter(blocker);

      await admin
        .from("project_members")
        .update({ role: "viewer" })
        .eq("project_id", projectId)
        .eq("user_id", ownerId);
      await blocker.query("commit");

      const { error } = await pending;
      expect(error?.code).toBe("42501");

      const { data } = await admin
        .from("project_members")
        .select("user_id")
        .eq("project_id", projectId)
        .eq("user_id", otherId);
      expect(data ?? []).toHaveLength(0); // the insert was rolled back
    } finally {
      await blocker.end();
    }
  }, TIMEOUT);
});
