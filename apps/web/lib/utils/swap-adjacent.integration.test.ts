import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// TASK-57: swap_adjacent (20260716000002) — the transactional adjacent-swap RPC
// backing moveCustomStatus / moveLane. Proves atomicity + the dense-rewrite that
// the old parallel-UPDATE pair could not: a normal one-step swap (both tables),
// edge no-op, input validation, the role gate, the cross-tenant guard, and that
// a pre-existing duplicate-position state is normalised rather than preserved.
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/swap-adjacent.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("swap_adjacent RPC (integration)", () => {
  let asOwner: SupabaseClient; // dev user, project owner
  let asService: SupabaseClient; // service role: fixtures + reads
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
    asService = createClient(url, serviceKey, { auth: { persistSession: false } });
    asOwner = createClient(url, anonKey);
    const ownerAuth = await asOwner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerAuth.error || !ownerAuth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${ownerAuth.error?.message}`);
    }

    const { data: project, error: projectError } = await asOwner
      .from("projects")
      .insert({ name: "swap_adjacent integration test", workflow_mode: "free" })
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
    await asService.from("custom_statuses").delete().eq("project_id", projectId);
    await asService.from("swimlanes").delete().eq("project_id", projectId);
  });

  // Seeds three custom statuses at the given positions and returns their ids in
  // seed order (a, b, c).
  async function seedStatuses(positions: [number, number, number]): Promise<[string, string, string]> {
    const ids: string[] = [];
    for (const [i, pos] of positions.entries()) {
      const { data, error } = await asService
        .from("custom_statuses")
        .insert({ project_id: projectId, name: `s${i}`, color: "#888888", position: pos })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed status: ${error?.message}`);
      }
      ids.push(data.id);
    }
    return ids as [string, string, string];
  }

  async function statusPositions(ids: string[]): Promise<number[]> {
    const { data } = await asService.from("custom_statuses").select("id, position").in("id", ids);
    const byId = new Map((data as { id: string; position: number }[]).map((r) => [r.id, r.position]));
    return ids.map((id) => byId.get(id)!);
  }

  it("moves a status down one step and rewrites dense positions (AC #1)", async () => {
    const [a, b, c] = await seedStatuses([0, 1, 2]);
    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "custom_statuses",
      p_id: a,
      p_direction: "down",
    });
    expect(error).toBeNull();
    // Order becomes b, a, c.
    expect(await statusPositions([b, a, c])).toEqual([0, 1, 2]);
  });

  it("moves a status up one step", async () => {
    const [a, b, c] = await seedStatuses([0, 1, 2]);
    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "custom_statuses",
      p_id: c,
      p_direction: "up",
    });
    expect(error).toBeNull();
    // Order becomes a, c, b.
    expect(await statusPositions([a, c, b])).toEqual([0, 1, 2]);
  });

  it("is a no-op at the top edge", async () => {
    const [a, b, c] = await seedStatuses([0, 1, 2]);
    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "custom_statuses",
      p_id: a,
      p_direction: "up",
    });
    expect(error).toBeNull();
    expect(await statusPositions([a, b, c])).toEqual([0, 1, 2]);
  });

  it("swaps swimlanes too (same RPC, other table)", async () => {
    const { data: la } = await asService.from("swimlanes").insert({ project_id: projectId, name: "la", position: 0 }).select("id").single();
    const { data: lb } = await asService.from("swimlanes").insert({ project_id: projectId, name: "lb", position: 1 }).select("id").single();
    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "swimlanes",
      p_id: la!.id,
      p_direction: "down",
    });
    expect(error).toBeNull();
    const { data } = await asService.from("swimlanes").select("id, position").in("id", [la!.id, lb!.id]);
    const byId = new Map((data as { id: string; position: number }[]).map((r) => [r.id, r.position]));
    expect(byId.get(lb!.id)).toBe(0);
    expect(byId.get(la!.id)).toBe(1);
  });

  it("normalises a pre-existing duplicate-position state (dense-rewrite, AC #1)", async () => {
    // The old non-atomic path could leave two rows sharing a position; a bare
    // value-swap would preserve it. Seed a, b both at 0 and c at 1.
    const [, , c] = await seedStatuses([0, 0, 1]);

    // The RPC tie-breaks the duplicate 0s by id (order by position, id), which
    // is a random UUID — so read the canonical pre-swap order the RPC will see
    // rather than assuming seed order, then apply the one-step move in JS.
    const { data: pre } = await asService
      .from("custom_statuses")
      .select("id")
      .eq("project_id", projectId)
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    const preIds = (pre as { id: string }[]).map((r) => r.id);
    const ci = preIds.indexOf(c);
    const expected = [...preIds];
    [expected[ci - 1], expected[ci]] = [expected[ci], expected[ci - 1]]; // move c up one

    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "custom_statuses",
      p_id: c,
      p_direction: "up",
    });
    expect(error).toBeNull();

    // Positions are rewritten dense + unique (the normalisation), in the moved order.
    const { data: post } = await asService
      .from("custom_statuses")
      .select("id, position")
      .eq("project_id", projectId)
      .order("position", { ascending: true });
    const postRows = post as { id: string; position: number }[];
    expect(postRows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(postRows.map((r) => r.id)).toEqual(expected);
  });

  it("rejects an invalid direction", async () => {
    const [a] = await seedStatuses([0, 1, 2]);
    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "custom_statuses",
      p_id: a,
      p_direction: "sideways",
    });
    expect(error?.message).toMatch(/invalid direction/i);
  });

  it("rejects an invalid table", async () => {
    const [a] = await seedStatuses([0, 1, 2]);
    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "stories",
      p_id: a,
      p_direction: "down",
    });
    expect(error?.message).toMatch(/invalid table/i);
  });

  it("rejects an id from another project without touching it (cross-tenant guard)", async () => {
    await seedStatuses([0, 1, 2]);
    const { data: other } = await asOwner
      .from("projects")
      .insert({ name: "other project", workflow_mode: "free" })
      .select("id")
      .single();
    const { data: foreign } = await asService
      .from("custom_statuses")
      .insert({ project_id: other!.id, name: "foreign", color: "#888888", position: 7 })
      .select("id")
      .single();

    const { error } = await asOwner.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "custom_statuses",
      p_id: foreign!.id,
      p_direction: "up",
    });
    expect(error?.message).toMatch(/row not found/i);
    // The foreign row's position is untouched.
    const { data: after } = await asService.from("custom_statuses").select("position").eq("id", foreign!.id).single();
    expect((after as { position: number }).position).toBe(7);

    await asService.from("projects").delete().eq("id", other!.id);
  });

  it("rejects a viewer (project_role gate)", async () => {
    const [a] = await seedStatuses([0, 1, 2]);
    const email = `swap-adjacent-viewer-${Date.now()}@storylane.local`;
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

    const { error } = await asViewer.rpc("swap_adjacent", {
      p_project_id: projectId,
      p_table: "custom_statuses",
      p_id: a,
      p_direction: "down",
    });
    expect(error?.message).toMatch(/not authorized/i);

    await asService.auth.admin.deleteUser(created.user.id);
  });

  it("serialises competing swaps without duplicating positions (AC #3)", async () => {
    const [a, b, c] = await seedStatuses([0, 1, 2]);
    // Two swaps fired together; the advisory lock serialises them. Whatever the
    // interleaving, positions must stay a dense 0,1,2 permutation.
    const [r1, r2] = await Promise.all([
      asOwner.rpc("swap_adjacent", { p_project_id: projectId, p_table: "custom_statuses", p_id: a, p_direction: "down" }),
      asOwner.rpc("swap_adjacent", { p_project_id: projectId, p_table: "custom_statuses", p_id: c, p_direction: "up" }),
    ]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    const positions = await statusPositions([a, b, c]);
    expect([...positions].sort()).toEqual([0, 1, 2]);
  });
});
