import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// TASK-24 (decision-1 §3): Slack notifications are dispatched by a DB trigger,
// not the Web server action, so ANY client's write notifies. This asserts the
// client-agnostic half (AC#1): a DIRECT table write — no web action involved —
// records a public.slack_notifications outbox row. The pg_net -> Edge Function
// delivery on top is exercised by supabase/functions/slack-notify/index.test.ts
// and a one-off manual local check, not here (pg_net is async and the `net`
// schema isn't reachable over PostgREST — see the migration's header).
//
//   SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/slack-notifications-outbox.integration.test.ts
const RUN = process.env.SUPABASE_INTEGRATION === "1";

type StateName = "Unstarted" | "Started" | "Accepted";

describe.skipIf(!RUN)("slack notifications outbox (integration)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let ownerId: string;
  let slackProjectId: string; // has an active slack integration
  let plainProjectId: string; // no integration — the gate must skip it
  let states: Record<StateName, string>;

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
    const auth = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (auth.error || !auth.data.user) {
      throw new Error(`Dev-user sign-in failed (is 'supabase start' running?): ${auth.error?.message}`);
    }
    ownerId = auth.data.user.id;

    const { data: slackProject } = await owner
      .from("projects")
      .insert({ name: "slack outbox — with integration" })
      .select("id")
      .single();
    slackProjectId = slackProject!.id;
    // An active Slack integration is the gate: only projects that have one
    // grow outbox rows.
    const { error: intError } = await owner.from("integrations").insert({
      project_id: slackProjectId,
      provider: "slack",
      config: { webhook_url: "https://hooks.slack.test/xxx" },
      is_active: true,
    });
    expect(intError).toBeNull();

    const { data: plainProject } = await owner
      .from("projects")
      .insert({ name: "slack outbox — no integration" })
      .select("id")
      .single();
    plainProjectId = plainProject!.id;

    const { data: stateRows } = await admin.from("project_states").select("id, name").eq("project_id", slackProjectId);
    states = Object.fromEntries((stateRows ?? []).map((s) => [s.name, s.id])) as Record<StateName, string>;
  });

  afterAll(async () => {
    if (slackProjectId) await admin.from("projects").delete().eq("id", slackProjectId);
    if (plainProjectId) await admin.from("projects").delete().eq("id", plainProjectId);
  });

  async function outboxRows(projectId: string, eventType?: string) {
    let query = admin.from("slack_notifications").select("event_type, ref_id").eq("project_id", projectId);
    if (eventType) query = query.eq("event_type", eventType);
    const { data } = await query;
    return data ?? [];
  }

  it("records a story_state_changed row from a DIRECT state_id write (no web action)", async () => {
    const { data: story } = await admin
      .from("stories")
      .insert({ project_id: slackProjectId, title: "notify me", story_type: "feature", state_id: states.Unstarted, created_by: ownerId })
      .select("id")
      .single();

    // Direct table UPDATE — the path an iOS/MCP/other client takes, never the
    // Web server action. log_story_activity fires -> activity_logs row ->
    // the slack-notify trigger.
    const { error } = await admin.from("stories").update({ state_id: states.Started }).eq("id", story!.id);
    expect(error).toBeNull();

    const { data: log } = await admin
      .from("activity_logs")
      .select("id")
      .eq("story_id", story!.id)
      .eq("action", "story.state_changed")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const rows = await outboxRows(slackProjectId, "story_state_changed");
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // ref_id points at the activity_logs row the Edge Function reads.
    expect(rows.some((r) => r.ref_id === log!.id)).toBe(true);
  });

  it("records iteration_started and iteration_finalized rows from finalize_iteration", async () => {
    // Seed iteration #1 (an INSERT -> iteration_started).
    const seed = await owner.rpc("finalize_iteration", { p_project_id: slackProjectId, p_manual: false });
    expect(seed.error).toBeNull();
    expect((await outboxRows(slackProjectId, "iteration_started")).length).toBeGreaterThanOrEqual(1);

    const { data: iter1 } = await owner
      .from("iterations")
      .select("id")
      .eq("project_id", slackProjectId)
      .eq("number", 1)
      .single();
    // Manual finish -> state='done' (an UPDATE -> iteration_finalized).
    const finish = await owner.rpc("finalize_iteration", {
      p_project_id: slackProjectId,
      p_manual: true,
      p_iteration_id: iter1!.id,
    });
    expect(finish.error).toBeNull();

    const finalized = await outboxRows(slackProjectId, "iteration_finalized");
    expect(finalized.length).toBeGreaterThanOrEqual(1);
    expect(finalized.some((r) => r.ref_id === iter1!.id)).toBe(true);
  });

  it("records NOTHING for a project without an active slack integration (the gate)", async () => {
    const { data: plainStates } = await admin.from("project_states").select("id, name").eq("project_id", plainProjectId);
    const unstarted = plainStates!.find((s) => s.name === "Unstarted")!.id;
    const started = plainStates!.find((s) => s.name === "Started")!.id;

    const { data: story } = await admin
      .from("stories")
      .insert({ project_id: plainProjectId, title: "no notify", story_type: "feature", state_id: unstarted, created_by: ownerId })
      .select("id")
      .single();
    await admin.from("stories").update({ state_id: started }).eq("id", story!.id);
    await owner.rpc("finalize_iteration", { p_project_id: plainProjectId, p_manual: false });

    expect(await outboxRows(plainProjectId)).toHaveLength(0);
  });

  it("stops recording once the integration is deactivated", async () => {
    await owner.from("integrations").update({ is_active: false }).eq("project_id", slackProjectId).eq("provider", "slack");

    const { data: story } = await admin
      .from("stories")
      .insert({ project_id: slackProjectId, title: "after deactivation", story_type: "feature", state_id: states.Unstarted, created_by: ownerId })
      .select("id")
      .single();
    const before = (await outboxRows(slackProjectId, "story_state_changed")).length;
    await admin.from("stories").update({ state_id: states.Accepted }).eq("id", story!.id);
    expect((await outboxRows(slackProjectId, "story_state_changed")).length).toBe(before);
  });
});
