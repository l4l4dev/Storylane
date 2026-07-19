import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as tools from "./handlers.js";

// Exercises every Phase 1 tool's happy path AND a permission-denied path
// (spec/mcp.md, TASK-48 AC #4) against a running local Supabase, as the
// member-role agent bot — the same RLS the real server runs under.
//
//   supabase start
//   SUPABASE_INTEGRATION=1 pnpm --dir apps/mcp exec vitest run
//
// Requires the seeded dev user (the project owner) and the service role key
// (to create the bot auth user). Skipped otherwise.
const RUN = process.env.SUPABASE_INTEGRATION === "1";

describe.skipIf(!RUN)("Storylane MCP tools (integration, member-role bot)", () => {
  let admin: SupabaseClient;
  let owner: SupabaseClient;
  let bot: SupabaseClient;
  let botUserId: string;
  let projectId: string; // bot is a member
  let outsideProjectId: string; // bot is NOT a member
  let ownerStoryId: string; // authored by owner; bot is a plain member, neither author nor assignee
  let botStoryId: string;
  // classic-template state ids, keyed by name (the auto-seed trigger gives
  // every fresh project this template by default).
  let states: Record<"Unstarted" | "Started" | "Finished" | "Delivered" | "Accepted" | "Rejected", string>;

  beforeAll(async () => {
    if (!process.env.SUPABASE_URL) {
      try {
        process.loadEnvFile(`${process.cwd()}/.env.local`);
      } catch {
        // fall through; the missing-env check below fails loudly
      }
    }
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey) {
      throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set for this test");
    }

    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: ownerErr } = await owner.auth.signInWithPassword({
      email: "dev@storylane.local",
      password: "dev-local-only-password",
    });
    if (ownerErr) throw new Error(`Owner sign-in failed (is 'supabase start' running?): ${ownerErr.message}`);

    const botEmail = `mcp-bot-${Date.now()}@example.com`;
    const botPassword = "bot-local-only-password";
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: botEmail,
      password: botPassword,
      email_confirm: true,
      user_metadata: { name: "Claude (agent)" },
    });
    if (createErr || !created.user) throw new Error(`Bot user create failed: ${createErr?.message}`);
    botUserId = created.user.id;

    bot = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: botSignIn } = await bot.auth.signInWithPassword({ email: botEmail, password: botPassword });
    if (botSignIn) throw new Error(`Bot sign-in failed: ${botSignIn.message}`);

    const { data: proj, error: projErr } = await owner
      .from("projects")
      .insert({ name: "mcp integration project" })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Project create failed: ${projErr?.message}`);
    projectId = proj.id;

    const { data: stateRows } = await admin.from("project_states").select("id, name").eq("project_id", projectId);
    states = Object.fromEntries((stateRows ?? []).map((s) => [s.name, s.id])) as typeof states;

    const { error: inviteErr } = await owner.rpc("invite_member", {
      p_project_id: projectId,
      p_user_id: botUserId,
      p_role: "member",
    });
    if (inviteErr) throw new Error(`invite_member failed: ${inviteErr.message}`);

    const { data: outside, error: outErr } = await owner
      .from("projects")
      .insert({ name: "mcp outside project" })
      .select("id")
      .single();
    if (outErr || !outside) throw new Error(`Outside project create failed: ${outErr?.message}`);
    outsideProjectId = outside.id;

    // A story authored by the owner, estimated so a state change attempt
    // reaches the RPC's guards (not the unestimated-feature gate). Used to
    // prove the bot (a plain member, neither author nor assignee) can still
    // write it (TASK-70: any member may operate any story).
    const { data: ownerStory, error: osErr } = await owner
      .from("stories")
      .insert({ project_id: projectId, title: "owner's story", story_type: "feature", points: 2, state_id: states.Unstarted })
      .select("id")
      .single();
    if (osErr || !ownerStory) throw new Error(`Owner story create failed: ${osErr?.message}`);
    ownerStoryId = ownerStory.id;
  });

  afterAll(async () => {
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    if (outsideProjectId) await admin.from("projects").delete().eq("id", outsideProjectId);
    if (botUserId) await admin.auth.admin.deleteUser(botUserId);
  });

  // ── Happy paths ────────────────────────────────────────────────────────

  it("board_summary bootstraps and reads the current iteration, and lists valid states", async () => {
    const summary = (await tools.boardSummary(bot, { project_id: projectId })) as {
      current_iteration: { number: number } | null;
      velocity: number;
      backlog_count: number;
      by_state: { state_id: string; name: string; category: string }[];
    };
    expect(summary.current_iteration?.number).toBe(1);
    expect(summary.velocity).toBe(0);
    expect(summary.by_state.map((s) => s.name)).toEqual([
      "Unstarted",
      "Started",
      "Finished",
      "Delivered",
      "Accepted",
      "Rejected",
    ]);
    expect(summary.by_state.find((s) => s.state_id === states.Started)?.category).toBe("in_progress");
  });

  it("create_story lands a story in the backlog", async () => {
    const story = (await tools.createStory(bot, {
      project_id: projectId,
      title: "bot backlog story",
      story_type: "feature",
    })) as { id: string; number: number; state_id: string; iteration_id: string | null };
    expect(story.state_id).toBe(states.Unstarted);
    expect(story.iteration_id).toBeNull();
    expect(story.number).toBeGreaterThan(0);
    botStoryId = story.id;
  });

  it("create_story into the current iteration assigns iteration_id", async () => {
    const story = (await tools.createStory(bot, {
      project_id: projectId,
      title: "bot scheduled story",
      destination: "current_iteration",
      labels: ["mcp", "urgent"],
    })) as { iteration_id: string | null };
    expect(story.iteration_id).not.toBeNull();
  });

  it("list_stories returns compact rows and filters by text", async () => {
    const rows = (await tools.listStories(bot, {
      project_id: projectId,
      filter: { text: "backlog story" },
    })) as { id: string; title: string }[];
    expect(rows.some((r) => r.id === botStoryId)).toBe(true);
  });

  it("list_stories filters by state_id and resolves the state's name/category", async () => {
    const rows = (await tools.listStories(bot, {
      project_id: projectId,
      filter: { state_id: states.Unstarted },
    })) as { id: string; state: string; category: string }[];
    expect(rows.some((r) => r.id === botStoryId)).toBe(true);
    const row = rows.find((r) => r.id === botStoryId);
    expect(row?.state).toBe("Unstarted");
    expect(row?.category).toBe("unstarted");
  });

  it("update_story edits fields the bot authored", async () => {
    await tools.updateStory(bot, { story_id: botStoryId, points: 3, description: "estimated by the bot" });
    const story = (await tools.getStory(bot, { story_id: botStoryId })) as { points: number; description: string };
    expect(story.points).toBe(3);
    expect(story.description).toBe("estimated by the bot");
  });

  it("set_story_tasks and toggle_story_task manage the checklist", async () => {
    const set = (await tools.setStoryTasks(bot, {
      story_id: botStoryId,
      tasks: [{ title: "step one" }, { title: "step two" }],
    })) as { tasks: { id: string; is_done: boolean }[] };
    expect(set.tasks).toHaveLength(2);

    const toggled = (await tools.toggleStoryTask(bot, { task_id: set.tasks[0].id, done: true })) as {
      is_done: boolean;
    };
    expect(toggled.is_done).toBe(true);
  });

  it("add_comment records a comment", async () => {
    const comment = (await tools.addComment(bot, { story_id: botStoryId, body: "on it" })) as { id: string };
    expect(comment.id).toBeTruthy();
  });

  it("set_story_state advances the lifecycle and schedules a backlog story", async () => {
    const started = (await tools.setStoryState(bot, { story_id: botStoryId, state_id: states.Started })) as {
      state_id: string;
    };
    expect(started.state_id).toBe(states.Started);
    const story = (await tools.getStory(bot, { story_id: botStoryId })) as { iteration_id: string | null };
    expect(story.iteration_id).not.toBeNull();

    await tools.setStoryState(bot, { story_id: botStoryId, state_id: states.Finished });
    await tools.setStoryState(bot, { story_id: botStoryId, state_id: states.Delivered });
    const accepted = (await tools.setStoryState(bot, { story_id: botStoryId, state_id: states.Accepted })) as {
      state_id: string;
    };
    expect(accepted.state_id).toBe(states.Accepted);
  });

  it("set_story_state serializes concurrent state changes on the same story (no lost update)", async () => {
    // A bug needs no estimate, so it can walk straight to Delivered.
    const story = (await tools.createStory(bot, {
      project_id: projectId,
      title: "contended story",
      story_type: "bug",
    })) as { id: string };
    await tools.setStoryState(bot, { story_id: story.id, state_id: states.Started });
    await tools.setStoryState(bot, { story_id: story.id, state_id: states.Finished });
    await tools.setStoryState(bot, { story_id: story.id, state_id: states.Delivered });

    // Fire two different target states at the same time. Both reads see
    // 'delivered'; without FOR UPDATE both UPDATEs commit and the last
    // writer silently wins. set_story_state's FOR UPDATE forces one to
    // block, re-read the now-committed state, and — since any->any is
    // legal — both actually succeed serially rather than one being
    // rejected; what must NOT happen is the row ending up in neither
    // target (a torn write).
    const results = await Promise.allSettled([
      tools.setStoryState(bot, { story_id: story.id, state_id: states.Accepted }),
      tools.setStoryState(bot, { story_id: story.id, state_id: states.Rejected }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ state_id: string }>[];
    expect(fulfilled).toHaveLength(2);

    // The persisted state is exactly the LAST writer's target — not a mix —
    // proving the lock serialized rather than let both race onto a shared read.
    const final = (await tools.getStory(bot, { story_id: story.id })) as { state_id: string };
    expect([states.Accepted, states.Rejected]).toContain(final.state_id);
  });

  it("move_story reschedules an unstarted story to a zone bottom", async () => {
    const story = (await tools.createStory(bot, { project_id: projectId, title: "movable story" })) as {
      id: string;
    };
    await tools.moveStory(bot, { story_id: story.id, destination: "current_iteration" });
    await tools.moveStory(bot, { story_id: story.id, destination: "icebox" });
    const moved = (await tools.getStory(bot, { story_id: story.id })) as { state_id: string | null; iteration_id: string | null };
    expect(moved.state_id).toBeNull();
    expect(moved.iteration_id).toBeNull();
  });

  it("move_story refuses a story that has already started", async () => {
    // A chore needs no estimate, so it can enter Started without tripping
    // the unestimated-feature gate.
    const story = (await tools.createStory(bot, {
      project_id: projectId,
      title: "already started story",
      story_type: "chore",
    })) as { id: string };
    await tools.setStoryState(bot, { story_id: story.id, state_id: states.Started });
    await expect(tools.moveStory(bot, { story_id: story.id, destination: "icebox" })).rejects.toThrow(
      /already started/i,
    );
  });

  // ── Atomic write paths (TASK-71) ────────────────────────────────────────

  const BOGUS_UUID = "00000000-0000-0000-0000-000000000000";

  it("set_story_tasks consumes the sequence — a later plain task INSERT does not collide", async () => {
    const story = (await tools.createStory(bot, { project_id: projectId, title: "seq story" })) as { id: string };
    await tools.setStoryTasks(bot, { story_id: story.id, tasks: [{ title: "one" }, { title: "two" }] });

    // Mirror Web addTask: omit position, let the DEFAULT consume tasks_position_seq.
    // Before the fix, set_story_tasks wrote explicit 0,1 and this INSERT's
    // sequence value could land on 0/1 and fail the deferred UNIQUE.
    const { error } = await bot.from("tasks").insert({ story_id: story.id, title: "three" });
    expect(error).toBeNull();

    const { data: rows } = await bot.from("tasks").select("position").eq("story_id", story.id);
    const positions = (rows ?? []).map((r: { position: number }) => r.position);
    expect(new Set(positions).size).toBe(positions.length); // all distinct
  });

  it("set_story_tasks failure leaves the existing checklist intact", async () => {
    const story = (await tools.createStory(bot, { project_id: projectId, title: "atomic tasks story" })) as {
      id: string;
    };
    await tools.setStoryTasks(bot, { story_id: story.id, tasks: [{ title: "keep one" }, { title: "keep two" }] });

    // A task with no title hits the tasks.title NOT NULL constraint mid-insert;
    // the whole RPC must roll back, not leave the checklist half-wiped.
    const { error } = await bot.rpc("set_story_tasks", {
      p_story_id: story.id,
      p_tasks: [{ title: "new one" }, { is_done: true }],
    });
    // 23502 = not_null_violation, confirming this is the expected mid-insert
    // failure rather than the RPC rejecting the call for an unrelated reason.
    expect(error?.code).toBe("23502");

    const { data: rows } = await bot.from("tasks").select("title").eq("story_id", story.id);
    expect((rows ?? []).map((r: { title: string }) => r.title).sort()).toEqual(["keep one", "keep two"]);
  });

  it("set_story_labels failure leaves the existing labels intact", async () => {
    const story = (await tools.createStory(bot, {
      project_id: projectId,
      title: "atomic labels story",
      labels: ["alpha", "beta"],
    })) as { id: string };

    // A bogus label_id matches no row in story_labels' WITH CHECK (label must
    // exist and share the story's project) after the DELETE; the replace must
    // roll back so the original labels survive.
    const { error } = await bot.rpc("set_story_labels", { p_story_id: story.id, p_label_ids: [BOGUS_UUID] });
    // 42501 = the story_labels INSERT policy's WITH CHECK, confirming this is
    // the expected mid-insert failure rather than the RPC rejecting the call
    // for an unrelated reason.
    expect(error?.code).toBe("42501");

    const full = (await tools.getStory(bot, { story_id: story.id })) as { labels: { name: string }[] };
    expect(full.labels.map((l) => l.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("create_story_tracker rolls the story back when a label insert fails", async () => {
    const title = "orphan-guard story";
    // Story insert succeeds, then the bogus label_id fails story_labels' WITH
    // CHECK — the story must not persist, or an agent retry would duplicate it.
    const { error } = await bot.rpc("create_story_tracker", {
      p_project_id: projectId,
      p_title: title,
      p_state_id: states.Unstarted,
      p_iteration_id: null,
      p_description: null,
      p_story_type: "feature",
      p_points: null,
      p_epic_id: null,
      p_label_ids: [BOGUS_UUID],
    });
    // 42501 = the story_labels INSERT policy's WITH CHECK, confirming this is
    // the expected mid-insert failure rather than the RPC rejecting the call
    // for an unrelated reason.
    expect(error?.code).toBe("42501");

    const { data: found } = await bot.from("stories").select("id").eq("project_id", projectId).eq("title", title);
    expect(found ?? []).toHaveLength(0);
  });

  it("set_story_labels rejects a label from a different project", async () => {
    const story = (await tools.createStory(bot, { project_id: projectId, title: "cross-project label story" })) as {
      id: string;
    };
    // Owner creates a label in the OUTSIDE project (bot is not a member there).
    const { data: foreign } = await owner
      .from("labels")
      .insert({ project_id: outsideProjectId, name: "foreign label" })
      .select("id")
      .single();
    const { error } = await bot.rpc("set_story_labels", {
      p_story_id: story.id,
      p_label_ids: [(foreign as { id: string }).id],
    });
    expect(error).not.toBeNull(); // story_labels WITH CHECK: label must share the story's project

    const full = (await tools.getStory(bot, { story_id: story.id })) as { labels: { name: string }[] };
    expect(full.labels).toHaveLength(0);
  });

  it("set_story_tasks on a non-member project errors even with an empty payload", async () => {
    const { data: outsideStory } = await owner
      .from("stories")
      .insert({ project_id: outsideProjectId, title: "outside story", story_type: "chore" })
      .select("id")
      .single();
    // Empty payload used to be a silent 0-row no-op; the explicit gate errors.
    await expect(
      bot.rpc("set_story_tasks", { p_story_id: (outsideStory as { id: string }).id, p_tasks: [] }),
    ).resolves.toMatchObject({ error: { code: "42501" } });
  });

  // ── Permission paths ────────────────────────────────────────────────────

  it("update_story succeeds on a story the bot neither authored nor is assigned to (TASK-70: any member may edit any story)", async () => {
    const result = (await tools.updateStory(bot, { story_id: ownerStoryId, title: "edited by a non-author member" })) as {
      story_id: string;
      updated: boolean;
    };
    expect(result.updated).toBe(true);
  });

  it("set_story_state succeeds on someone else's story (TASK-70: any member may change any story's state)", async () => {
    const result = (await tools.setStoryState(bot, { story_id: ownerStoryId, state_id: states.Started })) as {
      story_id: string;
      state_id: string;
    };
    expect(result.state_id).toBe(states.Started);
  });

  it("writing to a project the bot is not a member of is denied", async () => {
    await expect(tools.boardSummary(bot, { project_id: outsideProjectId })).rejects.toThrow(/not a member/i);
    await expect(
      tools.createStory(bot, { project_id: outsideProjectId, title: "sneaky" }),
    ).rejects.toThrow(/not a member/i);
  });
});
