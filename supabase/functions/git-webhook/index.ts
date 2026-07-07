// Task 12: GitHub / Forgejo webhook receiver (see spec/integrations.md).
// Marks stories as `finished` when a PR referencing them ([SL-123] in the
// title or storylane/123 in the branch name) is merged.
//
// Auth: no JWT (config.toml sets verify_jwt = false) — instead each request
// is HMAC-signed with the project's webhook_secret from integrations.config.
// The URL identifies the project: /functions/v1/git-webhook?project=<id>.
// Writes go through the service role client, scoped to that project.

import { createClient } from "npm:@supabase/supabase-js@2";

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

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
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

Deno.serve(async (req) => {
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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: integration } = await supabase
    .from("integrations")
    .select("config, is_active")
    .eq("project_id", projectId)
    .eq("provider", provider)
    .maybeSingle();

  if (!integration || !integration.is_active) {
    return json(404, { error: `No active ${provider} integration for this project` });
  }

  const secret = (integration.config as { webhook_secret?: string }).webhook_secret;
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

  // Force-finish (2026-07-07 decision, spec/integrations.md): stories not
  // yet finished jump to `finished` regardless of the usual one-step state
  // machine; anything at finished or beyond is left alone.
  const { data: updated, error } = await supabase
    .from("stories")
    .update({ state: "finished" })
    .eq("project_id", projectId)
    .in("number", numbers)
    .in("state", ["unscheduled", "unstarted", "started"])
    .select("id, number");

  if (error) {
    return json(500, { error: error.message });
  }

  // A story finished from the Backlog/Icebox would otherwise be stranded
  // there (only `unstarted` stories may cross zones on the board), so a
  // just-finished story with no iteration is pulled into the current one —
  // a merged PR means the work happened in this iteration.
  if (updated && updated.length > 0) {
    const { data: currentRows } = await supabase
      .from("iterations")
      .select("id")
      .eq("project_id", projectId)
      .neq("state", "done")
      .order("number", { ascending: false })
      .limit(1);

    const currentIterationId = currentRows?.[0]?.id;
    if (currentIterationId) {
      await supabase
        .from("stories")
        .update({ iteration_id: currentIterationId })
        .in(
          "id",
          updated.map((s) => s.id),
        )
        .is("iteration_id", null);
    }
  }

  return json(200, { matched: numbers, finished: (updated ?? []).map((s) => s.number) });
});
