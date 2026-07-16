import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// TASK-51: insert_board_item (20260716000001) — creates a backlog story or
// divider and positions it in one transaction, replacing quickCreateStory's and
// createBacklogDivider's non-atomic insert-then-resequence. Exercises the splice
// (anchor present / absent / not-in-zone), the story+divider interleave, the
// role gate, and the AC#2 guarantee that a rejected insert leaves no orphan row.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/insert-board-item.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type BacklogRow = { kind: "story" | "divider"; id: string; position: number };

describe.skipIf(!RUN)("insert_board_item RPC (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asService: SupabaseClient; // service role: fixtures + reads
  let projectId: string;
  let ownerId: string;

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
    ownerId = ownerAuth.data.user.id;

    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name: "insert_board_item integration test", workflow_mode: "tracker" })
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

  beforeEach(async () => {
    await asService.from("stories").delete().eq("project_id", projectId);
    await asService.from("backlog_dividers").delete().eq("project_id", projectId);
  });

  // Seeds a backlog of story s0(pos0), divider d(pos1), story s1(pos2).
  async function seedBacklog(): Promise<{ s0: string; d: string; s1: string }> {
    const { data: s0 } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "s0", state: "unstarted", iteration_id: null, position: 0, created_by: ownerId })
      .select("id")
      .single();
    const { data: d } = await asService
      .from("backlog_dividers")
      .insert({ project_id: projectId, label: "note", kind: "note", position: 1 })
      .select("id")
      .single();
    const { data: s1 } = await asService
      .from("stories")
      .insert({ project_id: projectId, title: "s1", state: "unstarted", iteration_id: null, position: 2, created_by: ownerId })
      .select("id")
      .single();
    return { s0: s0!.id, d: d!.id, s1: s1!.id };
  }

  // The whole backlog (stories with no iteration + all dividers) by position.
  async function backlogOrder(): Promise<BacklogRow[]> {
    const [{ data: stories }, { data: dividers }] = await Promise.all([
      asService.from("stories").select("id, position").eq("project_id", projectId).is("iteration_id", null).neq("state", "unscheduled"),
      asService.from("backlog_dividers").select("id, position").eq("project_id", projectId),
    ]);
    return [
      ...(stories ?? []).map((s) => ({ kind: "story" as const, id: s.id as string, position: s.position as number })),
      ...(dividers ?? []).map((d) => ({ kind: "divider" as const, id: d.id as string, position: d.position as number })),
    ].sort((a, b) => a.position - b.position);
  }

  it("inserts a story before the anchor and densely resequences (AC #1)", async () => {
    const { s0, d, s1 } = await seedBacklog();
    const { data: newId, error } = await asOwner.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "story",
      p_payload: { title: "spliced" },
      p_anchor: { before: { kind: "divider", id: d } },
    });
    expect(error).toBeNull();
    // Order becomes s0, new, d, s1.
    expect((await backlogOrder()).map((r) => `${r.kind}:${r.id}`)).toEqual([
      `story:${s0}`,
      `story:${newId}`,
      `divider:${d}`,
      `story:${s1}`,
    ]);
    expect((await backlogOrder()).map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it("inserts a divider before the anchor", async () => {
    const { s0, d, s1 } = await seedBacklog();
    const { data: newId, error } = await asOwner.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "divider",
      p_payload: { label: "break", kind: "iteration_break" },
      p_anchor: { before: { kind: "story", id: s1 } },
    });
    expect(error).toBeNull();
    // Order becomes s0, d, new, s1.
    expect((await backlogOrder()).map((r) => `${r.kind}:${r.id}`)).toEqual([
      `story:${s0}`,
      `divider:${d}`,
      `divider:${newId}`,
      `story:${s1}`,
    ]);
  });

  it("appends to the end when no anchor is given", async () => {
    const { s0, d, s1 } = await seedBacklog();
    const { data: newId, error } = await asOwner.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "story",
      p_payload: { title: "tail" },
      p_anchor: {},
    });
    expect(error).toBeNull();
    expect((await backlogOrder()).map((r) => `${r.kind}:${r.id}`)).toEqual([
      `story:${s0}`,
      `divider:${d}`,
      `story:${s1}`,
      `story:${newId}`,
    ]);
  });

  it("appends when the anchor is not in this backlog (cross-tenant / missing anchor)", async () => {
    const { s0, d, s1 } = await seedBacklog();
    const { data: other } = await asOwner
      .from("projects")
      .insert({ name: "other project", workflow_mode: "tracker" })
      .select("id")
      .single();
    const { data: foreign } = await asOwner
      .from("stories")
      .insert({ project_id: other!.id, title: "foreign", state: "unstarted", iteration_id: null, position: 0 })
      .select("id")
      .single();

    const { data: newId, error } = await asOwner.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "story",
      p_payload: { title: "anchor-miss" },
      p_anchor: { before: { kind: "story", id: foreign!.id } },
    });
    expect(error).toBeNull();
    // The foreign anchor never matches the project-scoped merge → append.
    expect((await backlogOrder()).map((r) => `${r.kind}:${r.id}`)).toEqual([
      `story:${s0}`,
      `divider:${d}`,
      `story:${s1}`,
      `story:${newId}`,
    ]);
    await asService.from("projects").delete().eq("id", other!.id);
  });

  it("leaves no orphan row when the payload is rejected (AC #2)", async () => {
    await seedBacklog();
    const { error: titleError } = await asOwner.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "story",
      p_payload: { title: "   " },
      p_anchor: {},
    });
    expect(titleError?.message).toMatch(/title required/i);

    const { error: kindError } = await asOwner.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "divider",
      p_payload: { label: "", kind: "note" },
      p_anchor: {},
    });
    expect(kindError?.message).toMatch(/label required/i);

    // Exactly the two seeded stories + one divider remain — no partial insert.
    const { count: storyCount } = await asService
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    const { count: dividerCount } = await asService
      .from("backlog_dividers")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    expect(storyCount).toBe(2);
    expect(dividerCount).toBe(1);
  });

  it("rejects a viewer (project_role gate)", async () => {
    const email = `insert-item-viewer-${Date.now()}@storylane.local`;
    const password = "integration-test-only-password";
    const { data: created, error: createError } = await asService.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      throw new Error(`Failed to create viewer user: ${createError?.message}`);
    }
    await asService.from("project_members").insert({ project_id: projectId, user_id: created.user.id, role: "viewer" });

    const asViewer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await asViewer.auth.signInWithPassword({ email, password });

    const { error } = await asViewer.rpc("insert_board_item", {
      p_project_id: projectId,
      p_kind: "story",
      p_payload: { title: "viewer attempt" },
      p_anchor: {},
    });
    expect(error?.message).toMatch(/not authorized/i);

    await asService.auth.admin.deleteUser(created.user.id);
  });
});
