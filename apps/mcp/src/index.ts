#!/usr/bin/env -S npx tsx
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createAgentClient } from "./client.js";
import * as tools from "./handlers.js";

// Load apps/mcp/.env.local (Node 22+). Never committed — holds the bot's
// Supabase credentials (spec/mcp.md "Auth decision").
const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const STORY_TYPE = z.enum(["feature", "bug", "chore", "release"]);

async function main() {
  const supabase = await createAgentClient();
  const server = new McpServer({ name: "storylane", version: "0.0.0" });

  // Each tool returns a plain object; wrap() serialises it and turns thrown
  // errors into an isError result the calling agent can read (spec/mcp.md:
  // "Tool errors must be self-explanatory").
  const wrap =
    <A>(handler: (a: A) => Promise<unknown>) =>
    async (args: A) => {
      try {
        const result = await handler(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    };

  server.registerTool(
    "board_summary",
    {
      title: "Board summary",
      description: "Current iteration (dates, goal, state), points/counts by lifecycle state, velocity, and backlog/icebox counts.",
      inputSchema: { project_id: z.string().uuid() },
    },
    wrap((a: { project_id: string }) => tools.boardSummary(supabase, a)),
  );

  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      description: "Compact story rows (id, number, title, type, state, category, points, epic, labels), optionally filtered by state_id (null for the Icebox), iteration, epic, label, text, or zone (backlog/icebox/current). Read valid state_id values from board_summary.",
      inputSchema: {
        project_id: z.string().uuid(),
        filter: z
          .object({
            state_id: z.string().uuid().nullable().optional(),
            iteration_id: z.string().uuid().optional(),
            epic_id: z.string().uuid().optional(),
            label: z.string().optional(),
            text: z.string().optional(),
            zone: z.enum(["backlog", "icebox", "current"]).optional(),
          })
          .optional(),
      },
    },
    wrap((a: { project_id: string; filter?: tools.StoryFilter }) => tools.listStories(supabase, a)),
  );

  server.registerTool(
    "get_story",
    {
      title: "Get story",
      description: "Full story: description, tasks, comments, labels, and recent activity.",
      inputSchema: { story_id: z.string().uuid() },
    },
    wrap((a: { story_id: string }) => tools.getStory(supabase, a)),
  );

  server.registerTool(
    "create_story",
    {
      title: "Create story",
      description: "Create a story. Lands at the bottom of its destination zone (backlog_bottom | icebox | current_iteration; default backlog_bottom).",
      inputSchema: {
        project_id: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        story_type: STORY_TYPE.optional(),
        points: z.number().int().min(0).optional(),
        epic_id: z.string().uuid().optional(),
        labels: z.array(z.string()).optional(),
        destination: z.enum(["backlog_bottom", "icebox", "current_iteration"]).optional(),
      },
    },
    wrap((a: tools.CreateStoryArgs) => tools.createStory(supabase, a)),
  );

  server.registerTool(
    "update_story",
    {
      title: "Update story",
      description: "Partial update of the passed fields only (title, description, points, epic_id, assignee_id, labels).",
      inputSchema: {
        story_id: z.string().uuid(),
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        points: z.number().int().min(0).nullable().optional(),
        epic_id: z.string().uuid().nullable().optional(),
        assignee_id: z.string().uuid().nullable().optional(),
        labels: z.array(z.string()).optional(),
      },
    },
    wrap((a: tools.UpdateStoryArgs) => tools.updateStory(supabase, a)),
  );

  server.registerTool(
    "set_story_state",
    {
      title: "Set story state",
      description: "Move a story to one of the project's states, addressed by state_id (or null for the Icebox). The DB allows any state to any state within the project — read valid state_id values (and their category/action_label) from board_summary.",
      inputSchema: {
        story_id: z.string().uuid(),
        state_id: z.string().uuid().nullable(),
      },
    },
    wrap((a: { story_id: string; state_id: string | null }) => tools.setStoryState(supabase, a)),
  );

  server.registerTool(
    "move_story",
    {
      title: "Move story",
      description: "Move an unstarted/icebox story to the bottom of the current iteration, backlog, or icebox.",
      inputSchema: {
        story_id: z.string().uuid(),
        destination: z.enum(["current_iteration", "backlog", "icebox"]),
      },
    },
    wrap((a: { story_id: string; destination: "current_iteration" | "backlog" | "icebox" }) =>
      tools.moveStory(supabase, a),
    ),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add comment",
      description: "Add a comment to a story.",
      inputSchema: { story_id: z.string().uuid(), body: z.string().min(1) },
    },
    wrap((a: { story_id: string; body: string }) => tools.addComment(supabase, a)),
  );

  server.registerTool(
    "set_story_tasks",
    {
      title: "Set story tasks",
      description: "Replace a story's checklist with the given tasks (each {title, done?}).",
      inputSchema: {
        story_id: z.string().uuid(),
        tasks: z.array(z.object({ title: z.string().min(1), done: z.boolean().optional() })),
      },
    },
    wrap((a: { story_id: string; tasks: { title: string; done?: boolean }[] }) =>
      tools.setStoryTasks(supabase, a),
    ),
  );

  server.registerTool(
    "toggle_story_task",
    {
      title: "Toggle story task",
      description: "Mark a single checklist task done or not-done.",
      inputSchema: { task_id: z.string().uuid(), done: z.boolean() },
    },
    wrap((a: { task_id: string; done: boolean }) => tools.toggleStoryTask(supabase, a)),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio transport keeps the process alive; log to stderr so stdout stays a
  // clean JSON-RPC channel.
  console.error("Storylane MCP server ready (stdio).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
