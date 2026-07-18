// Deno test — run with: deno test --allow-env supabase/functions/git-webhook/index.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { handleGitWebhookRequest, hmacSha256Hex, type WebhookClient } from "./index.ts";

type FakeResult = { data: unknown; error: { message: string } | null };
type RpcResult = { data: unknown; error: { message: string } | null };
type RpcCall = { fn: string; args: Record<string, unknown> };

// Minimal stand-in for the Supabase client. The handler now does its writes
// through the finish_story_from_git RPC, so `from()` is only used for the
// integrations lookup (select/eq/maybeSingle); `rpc()` is where finish+assign
// happens. `rpc` is a handler keyed on the story number so a multi-story PR
// can return a different result per call; every call is recorded for
// assertions. Table access outside `tables` throws so an unexpected read
// fails loudly.
function fakeSupabase(config: {
  tables: Record<string, FakeResult>;
  rpc?: (fn: string, args: Record<string, unknown>) => RpcResult;
}) {
  const accessedTables: string[] = [];
  const rpcCalls: RpcCall[] = [];

  function chain(result: FakeResult) {
    const node = {
      select: () => node,
      eq: () => node,
      maybeSingle: () => Promise.resolve(result),
    };
    return node;
  }

  const client = {
    from(table: string) {
      accessedTables.push(table);
      const result = config.tables[table];
      if (!result) {
        throw new Error(`Unexpected table access: ${table}`);
      }
      return chain(result);
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      const result = config.rpc?.(fn, args) ?? { data: [], error: null };
      return Promise.resolve(result);
    },
  } as unknown as WebhookClient;

  return { client, accessedTables, rpcCalls };
}

const SECRET = "test-secret";

async function signedRequest(body: string): Promise<Request> {
  const signature = await hmacSha256Hex(SECRET, body);
  return new Request("https://example.com/functions/v1/git-webhook?project=proj-1", {
    method: "POST",
    headers: {
      "x-github-event": "pull_request",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

const MERGED_PR = JSON.stringify({
  action: "closed",
  pull_request: { merged: true, title: "[SL-42] Fix bug", head: { ref: "storylane/42" } },
});

const ACTIVE_INTEGRATION: FakeResult = {
  data: { webhook_secret: SECRET, is_active: true },
  error: null,
};

Deno.test("tracker-mode merged PR: finishes the story via the RPC", async () => {
  const { client, rpcCalls } = fakeSupabase({
    tables: { integrations: ACTIVE_INTEGRATION },
    rpc: (_fn, args) => ({
      data: [{ kind: "finished", number: args.p_story_number, iteration_number: 1 }],
      error: null,
    }),
  });

  const res = await handleGitWebhookRequest(await signedRequest(MERGED_PR), client);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { matched: [42], events: [{ kind: "finished", number: 42, iteration_number: 1 }] });
  assertEquals(rpcCalls, [{ fn: "finish_story_from_git", args: { p_project_id: "proj-1", p_story_number: 42 } }]);
});


Deno.test("a not-transitionable story returns 200 with the RPC's event, not a silent success", async () => {
  const { client } = fakeSupabase({
    tables: { integrations: ACTIVE_INTEGRATION },
    rpc: (_fn, args) => ({ data: [{ kind: "not_transitionable", number: args.p_story_number }], error: null }),
  });

  const res = await handleGitWebhookRequest(await signedRequest(MERGED_PR), client);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { matched: [42], events: [{ kind: "not_transitionable", number: 42 }] });
});

Deno.test("an RPC error returns a retryable 5xx (never 200), so the git provider resends", async () => {
  const { client } = fakeSupabase({
    tables: { integrations: ACTIVE_INTEGRATION },
    rpc: () => ({ data: null, error: { message: "iteration assignment failed" } }),
  });

  const res = await handleGitWebhookRequest(await signedRequest(MERGED_PR), client);
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, { error: "iteration assignment failed", matched: [42] });
});

Deno.test("a multi-story PR calls the RPC once per number and stops at the first RPC error", async () => {
  const payload = JSON.stringify({
    action: "closed",
    pull_request: { merged: true, title: "[SL-42][SL-99] Two fixes", head: { ref: "main" } },
  });
  const { client, rpcCalls } = fakeSupabase({
    tables: { integrations: ACTIVE_INTEGRATION },
    // #42 succeeds, #99 fails — the whole delivery must 5xx so a retry
    // re-runs both (the RPC is idempotent for the already-finished #42).
    rpc: (_fn, args) =>
      args.p_story_number === 99
        ? { data: null, error: { message: "boom" } }
        : { data: [{ kind: "finished", number: args.p_story_number }], error: null },
  });

  const res = await handleGitWebhookRequest(await signedRequest(payload), client);
  const body = await res.json();

  assertEquals(res.status, 500);
  assertEquals(body, { error: "boom", matched: [42, 99] });
  assertEquals(rpcCalls, [
    { fn: "finish_story_from_git", args: { p_project_id: "proj-1", p_story_number: 42 } },
    { fn: "finish_story_from_git", args: { p_project_id: "proj-1", p_story_number: 99 } },
  ]);
});

Deno.test("no matched story numbers: returns matched 0 without calling the RPC", async () => {
  const payload = JSON.stringify({
    action: "closed",
    pull_request: { merged: true, title: "No reference here", head: { ref: "main" } },
  });
  const { client, rpcCalls } = fakeSupabase({ tables: { integrations: ACTIVE_INTEGRATION } });

  const res = await handleGitWebhookRequest(await signedRequest(payload), client);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { matched: 0 });
  assertEquals(rpcCalls.length, 0);
});
