import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-212: create_draft_story (20260729050000) — the draft card's save as one
// transaction, replacing the server action's insert-then-reposition-then-apply
// sequence. What that sequence could not do is what these prove:
//
//  - a failure after the insert leaves NO row (AC #1); the old path left a
//    title-only story that a retry duplicated
//  - the reposition's failure reaches the caller (AC #2); the old path
//    discarded it deliberately
//  - `unstarted` resolves the current iteration under iteration_finalize, so a
//    finalize landing mid-save cannot put the story into a closed iteration
//
// The three targets' landing zones are covered here too. They used to be left
// to insert_board_item's suite, but the `backlog` target no longer goes anywhere
// near insert_board_item — it now routes through move_story_board's two-table
// backlog splice — and the unit tests only assert which arguments the action
// builds, so nothing else holds this behaviour any more.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/create-draft-story.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

// The lock cases park a real RPC and poll for it, so the 5s default is too tight
// even when everything works.
const TIMEOUT = 30_000;

const DB_URL = () => process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe.skipIf(!RUN)("create_draft_story RPC (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asService: SupabaseClient; // service role: fixtures + reads that must bypass RLS
  let asOutsider: SupabaseClient; // signed in, member of nothing
  let ownerId: string;
  let outsiderId: string;
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
    const ownerAuth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }
    ownerId = ownerAuth.data.user.id;

    const email = `create-draft-outsider-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: made, error: makeError } = await asService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (makeError || !made.user) throw new Error(`Failed to create outsider: ${makeError?.message}`);
    outsiderId = made.user.id;
    asOutsider = createClient(url, anonKey, { auth: { persistSession: false } });
    const outsiderAuth = await asOutsider.auth.signInWithPassword({ email, password });
    if (outsiderAuth.error) throw new Error(`Outsider sign-in failed: ${outsiderAuth.error.message}`);
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await asService.from("projects").delete().eq("id", id);
    }
    if (outsiderId) await asService.auth.admin.deleteUser(outsiderId);
  });

  async function createProject(name: string): Promise<string> {
    const { data, error } = await asOwner.from("projects").insert({ name }).select("id").single();
    if (error || !data) throw new Error(`Failed to create test project: ${error?.message}`);
    createdProjectIds.push(data.id);
    return data.id;
  }

  async function storyCount(projectId: string): Promise<number> {
    const { count } = await asService
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    return count ?? 0;
  }

  /**
   * Blocks until some other backend is waiting on a row THIS connection's open
   * transaction has locked. Scoped to the holder's own transaction id: an
   * unscoped count matches any blocked write in the cluster and would let the
   * mutation land before the RPC ever parked. Same shape as
   * role-recheck-after-lock's.
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

  /** The advisory-lock equivalent: matched against the row for the lock this connection holds. */
  async function waitForLockWaiter(holder: PgClient): Promise<void> {
    const SQL = `
      select count(*)::int as n
        from pg_locks w
        join pg_locks g
          on g.locktype = 'advisory' and g.granted and g.pid = pg_backend_pid()
         and w.classid = g.classid and w.objid = g.objid and w.objsubid = g.objsubid
       where w.locktype = 'advisory' and not w.granted`;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { rows } = await holder.query(SQL);
      if (rows[0].n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the RPC never parked on the advisory lock — the test would be vacuous");
  }

  // ── the three targets' landing zones (AC #3) ──────────────────────────────

  it("lands a backlog draft in the lowest unstarted state with no iteration, spliced at its anchor", async () => {
    // The target whose route changed completely: it used to be insert_board_item
    // and is now move_story_board's backlog splice, which resequences stories and
    // dividers together. Nothing else in the suite exercises that any more.
    const projectId = await createProject("TASK-212 backlog landing");
    const { data: states } = await asService
      .from("project_states")
      .select("id, category, position")
      .eq("project_id", projectId)
      .order("position");
    const lowestUnstarted = states!.find((s) => s.category === "unstarted")!.id;

    const first = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "backlog",
      p_title: "backlog first",
    });
    expect(first.error).toBeNull();
    // A divider between them, so the splice has to renumber across both tables
    // rather than just the stories — the part a stories-only reorder gets wrong.
    const { error: dividerError } = await asOwner
      .from("backlog_dividers")
      .insert({ project_id: projectId, label: "a note", kind: "note" });
    expect(dividerError).toBeNull();

    const second = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "backlog",
      p_title: "backlog second, on top",
      p_anchor: { before: { kind: "story", id: first.data! } },
    });
    expect(second.error).toBeNull();

    const { data: landed } = await asService
      .from("stories")
      .select("state_id, iteration_id")
      .eq("id", second.data!)
      .single();
    // In the backlog zone, not the Icebox and not the current iteration — the
    // zone predicate is `iteration_id is null and state_id is not null`.
    expect(landed).toEqual({ state_id: lowestUnstarted, iteration_id: null });

    const { data: stories } = await asService
      .from("stories")
      .select("id, title, position")
      .eq("project_id", projectId);
    const { data: dividers } = await asService
      .from("backlog_dividers")
      .select("id, label, position")
      .eq("project_id", projectId);
    const ordered = [
      ...stories!.map((s) => ({ label: s.title, position: s.position })),
      ...dividers!.map((d) => ({ label: d.label, position: d.position })),
    ]
      .sort((a, b) => a.position - b.position)
      .map((r) => r.label);
    expect(ordered).toEqual(["backlog second, on top", "backlog first", "a note"]);
  }, TIMEOUT);

  it("lands an unstarted draft in the current iteration's lowest unstarted state", async () => {
    const projectId = await createProject("TASK-212 unstarted landing");
    const seeded = await asOwner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seeded.error).toBeNull();
    const { data: current } = await asService
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .single();
    const { data: states } = await asService
      .from("project_states")
      .select("id, category, position")
      .eq("project_id", projectId)
      .order("position");

    const { data: id, error } = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "unstarted",
      p_title: "in the iteration",
    });

    expect(error).toBeNull();
    const { data: landed } = await asService
      .from("stories")
      .select("state_id, iteration_id")
      .eq("id", id!)
      .single();
    expect(landed).toEqual({
      state_id: states!.find((s) => s.category === "unstarted")!.id,
      iteration_id: current!.id,
    });
  }, TIMEOUT);

  it("lands an icebox draft with neither a state nor an iteration", async () => {
    const projectId = await createProject("TASK-212 icebox landing");

    const { data: id, error } = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "icebox",
      p_title: "on ice",
    });

    expect(error).toBeNull();
    const { data: landed } = await asService
      .from("stories")
      .select("state_id, iteration_id")
      .eq("id", id!)
      .single();
    expect(landed).toEqual({ state_id: null, iteration_id: null });
  }, TIMEOUT);

  it("rejects a null target instead of quietly filing it in the Icebox", async () => {
    // `NULL not in (...)` is NULL, which `if` reads as false, so a null target
    // used to pass validation and then read false at every branch below it —
    // producing a state-less, iteration-less row, i.e. a silent Icebox create.
    // Not reachable from the draft card (its target is a union type), but the
    // RPC is granted to `authenticated` and callable directly.
    const projectId = await createProject("TASK-212 null target");

    const { error } = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: null as unknown as string,
      p_title: "null target",
    });

    expect(error?.message).toMatch(/invalid target/i);
    expect(await storyCount(projectId)).toBe(0);
  }, TIMEOUT);

  // ── the entry guard, and its null-safety ──────────────────────────────────

  for (const target of ["backlog", "unstarted", "icebox"] as const) {
    it(`tells a non-member they are not authorized for target ${target}, not a lie about iterations`, async () => {
      // project_role() returns NULL for a non-member, and `NULL not in (...)` is
      // NULL, which `if` treats as false — so a guard written the obvious way
      // never fires and the caller falls through to the lookups below it. Those
      // read `iterations` and `project_states`, both invisible to a non-member,
      // so the reported failure became "No active iteration": a plausible,
      // wrong, and unactionable message. This is the same NULL-vs-false trap
      // assert_points_on_scale documents for `= any(array[...])`.
      const projectId = await createProject(`TASK-212 outsider ${target}`);

      const { error } = await asOutsider.rpc("create_draft_story", {
        p_project_id: projectId,
        p_target: target,
        p_title: "not mine to create",
      });

      expect(error?.code).toBe("42501");
      expect(error?.message).toMatch(/not authorized/i);
      expect(await storyCount(projectId)).toBe(0);
    }, TIMEOUT);
  }

  // ── AC #1: no orphan on a mid-flow failure ────────────────────────────────

  it("leaves no row when a foreign-project label is rejected mid-save", async () => {
    // The exact reproduction from the bug report: the label belongs to another
    // project, story_labels' RLS WITH CHECK rejects it, and under the old
    // three-step path the title-only story had already been committed by then.
    const projectId = await createProject("TASK-212 orphan");
    const otherId = await createProject("TASK-212 orphan foreign label");
    const { data: label, error: labelError } = await asOwner
      .from("labels")
      .insert({ project_id: otherId, name: "not-ours" })
      .select("id")
      .single();
    // Asserted rather than assumed: a label that silently failed to exist would
    // make the RPC succeed and the count assertion below pass for the wrong
    // reason — a create that was never rejected also leaves no orphan.
    expect(labelError).toBeNull();

    const before = await storyCount(projectId);

    const { error } = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "icebox",
      p_title: "should not survive",
      p_label_ids: [label!.id],
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501"); // RLS WITH CHECK on story_labels
    expect(await storyCount(projectId)).toBe(before);
    const { data: survivors } = await asService
      .from("stories")
      .select("id")
      .eq("project_id", projectId)
      .eq("title", "should not survive");
    expect(survivors ?? []).toHaveLength(0);
  }, TIMEOUT);

  it("leaves no row when the points are off the project's scale", async () => {
    // A second, non-RLS failure mode: the label case above rolls back inside an
    // RLS policy, this one inside update_story's own validation. Both have to
    // take the story with them, and only one code path proves only one of them.
    const projectId = await createProject("TASK-212 orphan off-scale");
    const { error: scaleError } = await asService
      .from("projects")
      .update({ point_scale: "custom", custom_points: [1, 2] })
      .eq("id", projectId);
    expect(scaleError).toBeNull();

    // 7 is off the custom scale, so update_story nulls it rather than raising —
    // which means the create SUCCEEDS and the story must be unpointed, not
    // absent. Recorded because it is the behaviour the old path had too (the
    // draft card's Save went through the same update_story), and a future
    // change to raise instead would be a user-visible break of quick-add.
    const { data: id, error } = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "icebox",
      p_title: "off-scale estimate",
      p_story_type: "feature",
      p_points: 7,
    });

    expect(error).toBeNull();
    const { data: story } = await asService.from("stories").select("points").eq("id", id!).single();
    expect(story!.points).toBeNull();
  }, TIMEOUT);

  it("nulls the points of a non-pointed story type, as a later edit would", async () => {
    // The draft card lets you pick points and then switch the type to chore; the
    // old path routed the field save through update_story, which drops them.
    // Open-coding the insert here would silently start storing them.
    const projectId = await createProject("TASK-212 chore points");

    const { data: id, error } = await asOwner.rpc("create_draft_story", {
      p_project_id: projectId,
      p_target: "icebox",
      p_title: "chore with points",
      p_story_type: "chore",
      p_points: 3,
    });

    expect(error).toBeNull();
    const { data: story } = await asService.from("stories").select("story_type, points").eq("id", id!).single();
    expect(story).toMatchObject({ story_type: "chore", points: null });
  }, TIMEOUT);

  it("leaves no row when the caller is demoted to viewer mid-transaction", async () => {
    // The subtle half of AC #1, and the one per-statement RLS does NOT close on
    // its own. The INSERT is safe: a WITH CHECK violation always raises. But
    // update_story's writes are an UPDATE and a DELETE, and a failed RLS USING
    // clause there matches zero rows and raises NOTHING — update_story says so
    // in its own comment. So a demotion landing between the insert and the field
    // save used to return success while silently discarding every field,
    // recreating exactly the title-only row this RPC exists to prevent.
    //
    // The window is forced open by holding the PROJECT row: log_story_activity's
    // activity_logs INSERT takes FOR KEY SHARE on it to check its foreign key,
    // which FOR UPDATE conflicts with, so the story INSERT's trigger parks there
    // with the row already inserted. No anchor is passed on purpose — that is
    // the common append case, where move_story_board (the only other hard gate)
    // is never reached.
    const projectId = await createProject("TASK-212 demotion mid-transaction");

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let settled: { data: string | null; error: { code?: string } | null };
    try {
      await holder.query("begin");
      await holder.query("select id from public.projects where id = $1 for update", [projectId]);

      const pending = Promise.resolve(
        asOwner.rpc("create_draft_story", {
          p_project_id: projectId,
          p_target: "icebox",
          p_title: "demoted mid-save",
          p_description: "must not be silently dropped",
          p_story_type: "feature",
          p_points: 3,
        }),
      );

      await waitForRowWaiter(holder);
      // Demoted, not removed: a removed caller trips update_story's not-found
      // path instead, which is a different sub-case. A viewer keeps SELECT
      // visibility throughout, which is what makes the writes fail silently.
      const { error: demoteError } = await asService
        .from("project_members")
        .update({ role: "viewer" })
        .eq("project_id", projectId)
        .eq("user_id", ownerId);
      expect(demoteError).toBeNull();
      const { data: check } = await asService
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", ownerId)
        .single();
      expect(check!.role).toBe("viewer");

      await holder.query("commit");
      settled = await pending;
    } finally {
      await holder.end();
    }

    // Both read before asserting, so a failure reports the whole picture: the
    // pre-guard behaviour was "no error, and a title-only row left behind".
    const survivors = await asService
      .from("stories")
      .select("title, description, points")
      .eq("project_id", projectId);
    expect({ code: settled.error?.code, rows: survivors.data ?? [] }).toEqual({ code: "42501", rows: [] });
  }, TIMEOUT);

  // ── AC #2: the reposition's failure reaches the caller ────────────────────

  it("propagates a reposition failure and rolls the story back with it", async () => {
    // The splice is the last thing the RPC does, and the old action discarded
    // its error on purpose ("best-effort"). Forced here by blocking the position
    // shift on the anchor row and revoking the caller's membership while it
    // waits, which move_story_board's exit guard turns into a raise — the only
    // way to make the reposition specifically, and nothing before it, fail.
    const projectId = await createProject("TASK-212 reposition error");
    const { data: anchor, error: anchorError } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "anchor", story_type: "chore", created_by: ownerId, position: 5 })
      .select("id")
      .single();
    expect(anchorError).toBeNull();

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let settled: { error: { code?: string } | null };
    try {
      await holder.query("begin");
      // The Icebox splice shifts every row between the anchor and the new
      // story's sequence-issued slot, so this one is in its way.
      await holder.query("select id from public.stories where id = $1 for update", [anchor!.id]);

      const pending = Promise.resolve(
        asOwner.rpc("create_draft_story", {
          p_project_id: projectId,
          p_target: "icebox",
          p_title: "reposition victim",
          p_anchor: { before: { kind: "story", id: anchor!.id } },
        }),
      );

      await waitForRowWaiter(holder);
      const { error: revokeError } = await asService
        .from("project_members")
        .delete()
        .eq("project_id", projectId)
        .eq("user_id", ownerId);
      expect(revokeError).toBeNull();
      await holder.query("commit");
      settled = await pending;
    } finally {
      await holder.end();
    }

    expect(settled.error?.code).toBe("42501");

    // Both halves matter: the error surfaced (AC #2) AND the story it had
    // already inserted is gone (AC #1). The old path would have kept the row and
    // reported success.
    const { data: survivors } = await asService
      .from("stories")
      .select("id")
      .eq("project_id", projectId)
      .eq("title", "reposition victim");
    expect(survivors ?? []).toHaveLength(0);
    const { data: anchorAfter } = await asService.from("stories").select("position").eq("id", anchor!.id).single();
    expect(anchorAfter!.position).toBe(5); // the shift rolled back too
  }, TIMEOUT);

  // ── the iteration is resolved under iteration_finalize, not before it ─────

  it("puts an unstarted draft in the iteration current AFTER the wait, not before it", async () => {
    // The window the server action left open: it read the current iteration with
    // no lock at all, so a finalize completing between that read and the insert
    // put the story into an iteration that had just closed.
    //
    // The rollover is applied directly (state -> done plus a new started row)
    // rather than by calling finalize_iteration, which would block on the very
    // lock this test holds. It is the same two-row outcome.
    const projectId = await createProject("TASK-212 finalize race");
    const seeded = await asOwner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seeded.error).toBeNull();
    const { data: first } = await asService
      .from("iterations")
      .select("id, number, start_date, end_date")
      .eq("project_id", projectId)
      .order("number")
      .limit(1)
      .single();

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let settled: { data: string | null; error: { message?: string } | null };
    let secondId: string;
    try {
      await holder.query("select pg_advisory_lock(hashtext('iteration_finalize:' || $1))", [projectId]);

      const pending = Promise.resolve(
        asOwner.rpc("create_draft_story", {
          p_project_id: projectId,
          p_target: "unstarted",
          p_title: "lands in the new iteration",
        }),
      );

      await waitForLockWaiter(holder);

      const { error: closeError } = await asService
        .from("iterations")
        .update({ state: "done" })
        .eq("id", first!.id);
      expect(closeError).toBeNull();
      const { data: second, error: openError } = await asService
        .from("iterations")
        .insert({
          project_id: projectId,
          number: first!.number + 1,
          start_date: first!.end_date,
          end_date: first!.end_date,
          state: "active",
        })
        .select("id")
        .single();
      expect(openError).toBeNull();
      secondId = second!.id;

      await holder.query("select pg_advisory_unlock(hashtext('iteration_finalize:' || $1))", [projectId]);
      settled = await pending;
    } finally {
      await holder.end();
    }

    // Resolving before the lock would have picked the FIRST iteration, and the
    // insert would then have been rejected by reject_done_iteration_assignment —
    // a different, distinguishable outcome from landing in the second.
    expect(settled.error).toBeNull();
    const { data: story } = await asService.from("stories").select("iteration_id").eq("id", settled.data!).single();
    expect(story!.iteration_id).toBe(secondId);
  }, TIMEOUT);

  it("refuses an unstarted draft when the last iteration closed during the wait", async () => {
    // Same window, the other outcome: nothing reopened, so the post-lock read
    // finds no current iteration and the create is rejected instead of landing
    // in the closed one.
    const projectId = await createProject("TASK-212 finalize race, no successor");
    const seeded = await asOwner.rpc("finalize_iteration", { p_project_id: projectId, p_manual: false });
    expect(seeded.error).toBeNull();
    const { data: only } = await asService
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .order("number")
      .limit(1)
      .single();

    const holder = new PgClient({ connectionString: DB_URL() });
    await holder.connect();
    let settled: { error: { message?: string } | null };
    try {
      await holder.query("select pg_advisory_lock(hashtext('iteration_finalize:' || $1))", [projectId]);

      const pending = Promise.resolve(
        asOwner.rpc("create_draft_story", {
          p_project_id: projectId,
          p_target: "unstarted",
          p_title: "should not be created",
        }),
      );

      await waitForLockWaiter(holder);
      const { error: closeError } = await asService.from("iterations").update({ state: "done" }).eq("id", only!.id);
      expect(closeError).toBeNull();

      await holder.query("select pg_advisory_unlock(hashtext('iteration_finalize:' || $1))", [projectId]);
      settled = await pending;
    } finally {
      await holder.end();
    }

    expect(settled.error?.message).toMatch(/no active iteration/i);
    expect(await storyCount(projectId)).toBe(0);
  }, TIMEOUT);
});
