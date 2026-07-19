// Task 12: GitHub / Forgejo webhook receiver (see spec/integrations.md).
// Marks stories as `finished` when a PR referencing them ([SL-123] in the
// title or storylane/123 in the branch name) is merged.
//
// Auth: no JWT (config.toml sets verify_jwt = false) — instead each request
// is HMAC-signed with the project's integrations.webhook_secret (a dedicated
// column authenticated cannot SELECT — TASK-63; service_role reads it here).
// The URL identifies the project: /functions/v1/git-webhook?project=<id>.
// Writes go through the service role client, scoped to that project.

import { createClient } from "npm:@supabase/supabase-js@2";

// Narrow structural interface for exactly what this handler calls on the
// Supabase client (Codex: the injected client was a bare `any`, so column
// names and the RPC contract had no compile-time checking). The real
// service-role client and the test fake both satisfy this.
type QueryResult = { data: Record<string, unknown> | null; error: { message: string } | null };
interface WebhookQuery {
  select(columns: string): WebhookQuery;
  eq(column: string, value: unknown): WebhookQuery;
  maybeSingle(): Promise<QueryResult>;
}
export interface WebhookClient {
  from(table: string): WebhookQuery;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

// Story references: `[SL-123]` (PR title convention) and `storylane/123`
// (branch name convention) — see spec/integrations.md.
export function extractStoryNumbers(title: string, branch: string): number[] {
  const numbers = new Set<number>();
  for (const match of title.matchAll(/\[SL-(\d+)\]/gi)) {
    numbers.add(Number(match[1]));
  }
  const branchMatch = branch.match(/(?:^|\/)storylane\/(\d+)/i);
  if (branchMatch) {
    numbers.add(Number(branchMatch[1]));
  }
  return [...numbers];
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time comparison so signature checks don't leak prefix matches.
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

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Exported (rather than only reachable via Deno.serve) so tests can drive
// the full request flow with an injected fake Supabase client instead of a
// live one — see index.test.ts. `client` defaults to the real service-role
// client; only tests pass an override.
export async function handleGitWebhookRequest(
  req: Request,
  // Narrow-typed (see WebhookClient) — tests inject a minimal fake with only
  // the methods this handler actually calls (from().select().eq().maybeSingle()
  // and rpc()).
  client?: WebhookClient,
): Promise<Response> {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const projectId = new URL(req.url).searchParams.get("project");
  if (!projectId) {
    return json(400, { error: "Missing ?project=<id>" });
  }

  // Forgejo sends X-Gitea-Event (Gitea-compatible headers); GitHub sends
  // X-GitHub-Event. The payload body is GitHub-compatible for both.
  const giteaEvent = req.headers.get("x-gitea-event");
  const githubEvent = req.headers.get("x-github-event");
  const provider = giteaEvent ? "forgejo" : githubEvent ? "github" : null;
  if (!provider) {
    return json(400, { error: "Missing X-GitHub-Event / X-Gitea-Event header" });
  }
  const event = giteaEvent ?? githubEvent;

  const body = await req.text();

  const supabase: WebhookClient =
    client ??
    (createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    ) as unknown as WebhookClient);

  const { data: integration } = await supabase
    .from("integrations")
    .select("webhook_secret, is_active")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .maybeSingle();

  if (!integration || !integration.is_active) {
    return json(404, { error: `No active ${provider} integration for this project` });
  }

  const secret = (integration as { webhook_secret?: string }).webhook_secret;
  if (!secret) {
    return json(422, { error: "Integration has no webhook_secret configured" });
  }

  // GitHub: X-Hub-Signature-256 = "sha256=<hex>"; Forgejo: X-Gitea-Signature
  // = "<hex>" with no prefix (see spec/integrations.md).
  const received =
    provider === "github"
      ? (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "")
      : (req.headers.get("x-gitea-signature") ?? "");
  const expected = await hmacSha256Hex(secret, body);
  if (!received || !timingSafeEqual(expected, received.toLowerCase())) {
    return json(401, { error: "Invalid signature" });
  }
  if (event !== "pull_request") {
    return json(200, { ignored: `event ${event}` });
  }

  let payload: {
    action?: string;
    pull_request?: { merged?: boolean; title?: string; head?: { ref?: string } };
  };
  try {
    payload = JSON.parse(body);
  } catch {
    return json(400, { error: "Invalid JSON payload" });
  }

  if (payload.action !== "closed" || payload.pull_request?.merged !== true) {
    return json(200, { ignored: "not a merged PR" });
  }

  const numbers = extractStoryNumbers(
    payload.pull_request.title ?? "",
    payload.pull_request.head?.ref ?? "",
  );
  if (numbers.length === 0) {
    return json(200, { matched: 0 });
  }

  // Force-finish + current-iteration assignment happen together in the
  // transactional finish_story_from_git RPC (one advisory-locked transaction
  // per story, so a rollover can't interleave and a failed assignment can't
  // leave a finished story stranded — Codex, doc-1). One call per matched
  // number; any RPC failure returns a retryable 5xx so the git provider
  // resends the whole delivery (the RPC is idempotent — an already-finished
  // story comes back 'not_transitionable').
  const events: unknown[] = [];
  for (const number of numbers) {
    const { data, error } = await supabase.rpc("finish_story_from_git", {
      p_project_id: projectId,
      p_story_number: number,
      p_provider: provider,
    });
    if (error) {
      return json(500, { error: error.message, matched: numbers });
    }
    if (Array.isArray(data)) {
      events.push(...data);
    }
  }

  return json(200, { matched: numbers, events });
}

// `import.meta.main` is false when this module is imported (e.g. from
// index.test.ts), so tests never start a live listener — only running this
// file directly (as Supabase does when deploying/serving the function)
// starts the server.
if (import.meta.main) {
  // Wrapped so the client parameter stays defaulted (undefined → real
  // service-role client); passing the handler directly would bind Deno.serve's
  // ServeHandlerInfo to the typed `client` param.
  Deno.serve((req) => handleGitWebhookRequest(req));
}
