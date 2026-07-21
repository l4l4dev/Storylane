// TASK-24: client-agnostic Slack notifications. A trigger (story state
// changes via activity_logs, iteration finalize/start via the iterations
// table) enqueues a pg_net POST here; this function reads the referenced row
// with the service role, builds the message, and posts to the project's
// Slack Incoming Webhook. Moving delivery off the Web server action (the
// pre-doc-8 path) is what makes an iOS write — which never runs that action
// — still notify (decision-1 §3, spec/integrations.md "Slack Notifications").
//
// Auth: no JWT (config.toml verify_jwt = false). The only caller is the DB
// trigger, which signs each request with a shared secret pulled from Vault
// and sent as x-slack-notify-secret; this function compares it (timing-safe)
// against SLACK_NOTIFY_SECRET. The webhook URL identifies nothing — the body
// carries a row id, and the row's project scopes the read.

import { createClient } from "npm:@supabase/supabase-js@2";

// ── Message formatting (duplicated from apps/web/lib/utils/slack.ts,
// iterations.ts, and format.ts) ──────────────────────────────────────────
// A Deno edge function cannot import the web workspace packages (no import
// map / deno.json exists in this repo — git-webhook is likewise
// self-contained), so these pure functions are copied. index.test.ts asserts
// the same input/output pairs the vitest suites do, so the two copies can't
// drift silently.

export function escapeSlackText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function storyStateChangeMessage(story: { number: number; title: string }, newState: string): string {
  return `#${story.number} "${escapeSlackText(story.title)}" is now *${escapeSlackText(newState)}*`;
}

export function iterationDoneMessage(label: string, velocity: number, capacity?: number): string {
  const summary =
    capacity !== undefined && capacity > 0
      ? `${velocity} pts over ${capacity} person-days (${Number((velocity / capacity).toFixed(2))} pts/person-day)`
      : `${velocity} pts`;
  return `${escapeSlackText(label)} is done — ${summary}`;
}

export function iterationSkippedMessage(label: string): string {
  return `${escapeSlackText(label)} skipped`;
}

export function iterationStartedMessage(label: string, startDate: string, endDate: string): string {
  return `${escapeSlackText(label)} started (${startDate} – ${endDate})`;
}

// format.ts's date-only branch: a wall date formatted from its digits, never
// via `new Date` (which would read it as UTC midnight and drift a day west of
// UTC).
export function formatDateOnly(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return m ? `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}` : dateStr;
}

// iterations.ts iterationLabel: a 1-day cadence titles by date, not "#N"
// (doc-8 §5).
export function iterationLabel(term: string, num: number, iterationLengthDays: number, startDate?: string): string {
  if (iterationLengthDays === 1 && startDate) {
    return formatDateOnly(startDate);
  }
  return `${term} #${num}`;
}

// ── Supabase client interface (narrow, so tests inject a fake — same
// pattern as git-webhook) ────────────────────────────────────────────────
type QueryResult = { data: Record<string, unknown> | null; error: { message: string } | null };
interface NotifyQuery {
  select(columns: string): NotifyQuery;
  eq(column: string, value: unknown): NotifyQuery;
  maybeSingle(): Promise<QueryResult>;
}
export interface NotifyClient {
  from(table: string): NotifyQuery;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Constant-time compare so the secret check doesn't leak prefix matches
// (same as git-webhook).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

type NotifyBody = { type?: string; ref_id?: string };

// Builds the Slack text for one event, or null when the referenced row is
// gone (a delete racing the async delivery) — a missing row is a no-op, not
// an error, so a stale queue entry never wedges the worker with a retry loop.
async function buildMessage(supabase: NotifyClient, type: string, refId: string): Promise<
  { projectId: string; text: string } | null
> {
  if (type === "story_state_changed") {
    const { data: log } = await supabase
      .from("activity_logs")
      .select("project_id, story_id, payload")
      .eq("id", refId)
      .maybeSingle();
    if (!log?.story_id) {
      return null;
    }
    const { data: story } = await supabase
      .from("stories")
      .select("number, title")
      .eq("id", log.story_id)
      .maybeSingle();
    if (!story) {
      return null;
    }
    // payload.to is the new state NAME (log_story_activity resolves it), or
    // null for the Icebox — the same null->"Icebox" the web action applied.
    const to = (log.payload as { to?: string | null } | null)?.to ?? null;
    return {
      projectId: String(log.project_id),
      text: storyStateChangeMessage(
        { number: Number(story.number), title: String(story.title) },
        to ?? "Icebox",
      ),
    };
  }

  if (type === "iteration_finalized" || type === "iteration_started") {
    const { data: iteration } = await supabase
      .from("iterations")
      .select("project_id, number, velocity, capacity, skipped, start_date, end_date")
      .eq("id", refId)
      .maybeSingle();
    if (!iteration) {
      return null;
    }
    const { data: project } = await supabase
      .from("projects")
      .select("iteration_term, iteration_length")
      .eq("id", iteration.project_id)
      .maybeSingle();
    if (!project) {
      return null;
    }
    const label = iterationLabel(
      String(project.iteration_term),
      Number(iteration.number),
      Number(project.iteration_length),
      String(iteration.start_date),
    );
    const projectId = String(iteration.project_id);
    if (type === "iteration_started") {
      return {
        projectId,
        text: iterationStartedMessage(label, String(iteration.start_date), String(iteration.end_date)),
      };
    }
    if (iteration.skipped) {
      return { projectId, text: iterationSkippedMessage(label) };
    }
    const capacity = iteration.capacity == null ? undefined : Number(iteration.capacity);
    return { projectId, text: iterationDoneMessage(label, Number(iteration.velocity ?? 0), capacity) };
  }

  return null;
}

export async function handleSlackNotifyRequest(req: Request, client?: NotifyClient): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // The trigger is the only caller; a missing SLACK_NOTIFY_SECRET is a
  // misconfiguration, so reject rather than run unauthenticated.
  const expected = Deno.env.get("SLACK_NOTIFY_SECRET");
  const received = req.headers.get("x-slack-notify-secret") ?? "";
  if (!expected || !timingSafeEqual(expected, received)) {
    return json(401, { error: "Invalid secret" });
  }

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return json(400, { error: "Invalid JSON payload" });
  }
  if (!body.type || !body.ref_id) {
    return json(400, { error: "Missing type or ref_id" });
  }

  const supabase: NotifyClient =
    client ??
    (createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    ) as unknown as NotifyClient);

  const built = await buildMessage(supabase, body.type, body.ref_id);
  if (!built) {
    // Unknown type or a row deleted before delivery — nothing to send, and
    // not an error worth a retry.
    return json(200, { skipped: "no message" });
  }

  const { data: integration } = await supabase
    .from("integrations")
    .select("config, is_active")
    .eq("project_id", built.projectId)
    .eq("provider", "slack")
    .maybeSingle();

  const webhookUrl = (integration?.config as { webhook_url?: string } | null)?.webhook_url;
  if (!integration?.is_active || !webhookUrl) {
    return json(200, { skipped: "no active slack integration" });
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: built.text }),
  });
  if (!response.ok) {
    // Log and 200 anyway: the originating DB write is already committed, and
    // a 5xx would make pg_net retry a Slack outage indefinitely.
    console.error(`Slack notification failed: ${response.status}`);
  }
  return json(200, { sent: true });
}

if (import.meta.main) {
  Deno.serve((req) => handleSlackNotifyRequest(req));
}
