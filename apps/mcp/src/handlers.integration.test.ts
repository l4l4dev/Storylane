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
  let ownerStoryId: string; // authored by owner, bot is neither author nor assignee
  let botStoryId: string;

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
      .insert({ name: "mcp integration project", workflow_mode: "tracker" })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Project create failed: ${projErr?.message}`);
    projectId = proj.id;

    const { error: inviteErr } = await owner.rpc("invite_member", {
      p_project_id: projectId,
      p_user_id: botUserId,
      p_role: "member",
    });
    if (inviteErr) throw new Error(`invite_member failed: ${inviteErr.message}`);

    const { data: outside, error: outErr } = await owner
      .from("projects")
      .insert({ name: "mcp outside project", workflow_mode: "tracker" })
      .select("id")
      .single();
    if (outErr || !outside) throw new Error(`Outside project create failed: ${outErr?.message}`);
    outsideProjectId = outside.id;

    // A story authored by the owner, estimated so a transition attempt reaches
    // the RLS row-count check (not the unestimated-feature guard).
    const { data: ownerStory, error: osErr } = await owner
      .from("stories")
      .insert({ project_id: projectId, title: "owner's story", story_type: "feature", points: 2, state: "unstarted" })
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

  it("board_summary bootstraps and reads the current iteration", async () => {
    const summary = (await tools.boardSummary(bot, { project_id: projectId })) as {
      current_iteration: { number: number } | null;
      velocity: number;
      backlog_count: number;
    };
    expect(summary.current_iteration?.number).toBe(1);
    expect(summary.velocity).toBe(0);
  });

  it("create_story lands a story in the backlog", async () => {
    const story = (await tools.createStory(bot, {
      project_id: projectId,
      title: "bot backlog story",
      story_type: "feature",
    })) as { id: string; number: number; state: string; iteration_id: string | null };
    expect(story.state).toBe("unstarted");
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

  it("transition_story advances the lifecycle and schedules a backlog story", async () => {
    const started = (await tools.transitionStory(bot, { story_id: botStoryId, action: "start" })) as {
      state: string;
    };
    expect(started.state).toBe("started");
    const story = (await tools.getStory(bot, { story_id: botStoryId })) as { iteration_id: string | null };
    expect(story.iteration_id).not.toBeNull();

    await tools.transitionStory(bot, { story_id: botStoryId, action: "finish" });
    await tools.transitionStory(bot, { story_id: botStoryId, action: "deliver" });
    const accepted = (await tools.transitionStory(bot, { story_id: botStoryId, action: "accept" })) as {
      state: string;
    };
    expect(accepted.state).toBe("accepted");
  });

  it("transition_story serializes concurrent accept/reject (no lost update)", async () => {
    // A bug needs no estimate, so it can walk straight to 'delivered'.
    const story = (await tools.createStory(bot, {
      project_id: projectId,
      title: "contended story",
      story_type: "bug",
    })) as { id: string };
    await tools.transitionStory(bot, { story_id: story.id, action: "start" });
    await tools.transitionStory(bot, { story_id: story.id, action: "finish" });
    await tools.transitionStory(bot, { story_id: story.id, action: "deliver" });

    // Fire accept and reject at the same time. Both read 'delivered', both are
    // individually valid — without FOR UPDATE both UPDATEs commit and the last
    // writer silently wins. FOR UPDATE forces one to block, re-read the now-
    // committed state, and fail the state-machine check.
    const results = await Promise.allSettled([
      tools.transitionStory(bot, { story_id: story.id, action: "accept" }),
      tools.transitionStory(bot, { story_id: story.id, action: "reject" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringMatching(/cannot "(accept|reject)"/i),
    });

    // The persisted state is exactly the winner's target — not a mix.
    const final = (await tools.getStory(bot, { story_id: story.id })) as { state: string };
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ state: string }>).value;
    expect(final.state).toBe(winner.state);
    expect(["accepted", "rejected"]).toContain(final.state);
  });

  it("move_story reschedules an unstarted story to a zone bottom", async () => {
    const story = (await tools.createStory(bot, { project_id: projectId, title: "movable story" })) as {
      id: string;
    };
    await tools.moveStory(bot, { story_id: story.id, destination: "current_iteration" });
    await tools.moveStory(bot, { story_id: story.id, destination: "icebox" });
    const moved = (await tools.getStory(bot, { story_id: story.id })) as { state: string; iteration_id: string | null };
    expect(moved.state).toBe("unscheduled");
    expect(moved.iteration_id).toBeNull();
  });

  // ── Permission-denied paths ────────────────────────────────────────────

  it("update_story on a story the bot neither authored nor is assigned to is denied", async () => {
    await expect(tools.updateStory(bot, { story_id: ownerStoryId, title: "hijacked" })).rejects.toThrow(
      /not the author or assignee/i,
    );
  });

  it("transition_story on someone else's story is denied", async () => {
    await expect(tools.transitionStory(bot, { story_id: ownerStoryId, action: "start" })).rejects.toThrow(
      /not allowed to transition/i,
    );
  });

  it("writing to a project the bot is not a member of is denied", async () => {
    await expect(tools.boardSummary(bot, { project_id: outsideProjectId })).rejects.toThrow(/not a member/i);
    await expect(
      tools.createStory(bot, { project_id: outsideProjectId, title: "sneaky" }),
    ).rejects.toThrow(/not a member/i);
  });

  it("write tools reject a free-mode project", async () => {
    const { data: free } = await owner
      .from("projects")
      .insert({ name: "mcp free project", workflow_mode: "free" })
      .select("id")
      .single();
    await owner.rpc("invite_member", { p_project_id: free!.id, p_user_id: botUserId, p_role: "member" });
    await expect(tools.createStory(bot, { project_id: free!.id, title: "nope" })).rejects.toThrow(/tracker-mode/i);
    await admin.from("projects").delete().eq("id", free!.id);
  });
});
