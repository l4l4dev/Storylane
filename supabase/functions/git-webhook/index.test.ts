// Deno test — run with: deno test --allow-env supabase/functions/git-webhook/index.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { handleGitWebhookRequest, hmacSha256Hex } from "./index.ts";

type FakeResult = { data: unknown; error: { message: string } | null };

// Minimal chainable stand-in for the Supabase query builder — every method
// used by index.ts (select/eq/neq/in/is/order/limit/update) just returns
// itself, and the chain resolves via maybeSingle() or by being awaited
// directly (the same `select("id, number")`-terminated shape stories writes
// use). Table access outside `tables` throws, so a test asserting "writes
// nothing" fails loudly instead of silently no-opping.
function fakeSupabase(tables: Record<string, FakeResult>) {
  const accessedTables: string[] = [];

  function chain(result: FakeResult) {
    const node = {
      select: () => node,
      eq: () => node,
      neq: () => node,
      in: () => node,
      is: () => node,
      order: () => node,
      limit: () => node,
      update: () => node,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (v: FakeResult) => void) => resolve(result),
    };
    return node;
  }

  return {
    client: {
      from(table: string) {
        accessedTables.push(table);
        const result = tables[table];
        if (!result) {
          throw new Error(`Unexpected table access: ${table}`);
        }
        return chain(result);
      },
      // deno-lint-ignore no-explicit-any
    } as any,
    accessedTables,
  };
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

Deno.test("free-mode project: returns ignored: free mode and writes nothing", async () => {
  const payload = JSON.stringify({
    action: "closed",
    pull_request: { merged: true, title: "[SL-42] Fix bug", head: { ref: "storylane/42" } },
  });
  const { client, accessedTables } = fakeSupabase({
    integrations: { data: { config: { webhook_secret: SECRET }, is_active: true }, error: null },
    projects: { data: { workflow_mode: "free" }, error: null },
  });

  const res = await handleGitWebhookRequest(await signedRequest(payload), client);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ignored: "free mode" });
  assertEquals(accessedTables.includes("stories"), false);
  assertEquals(accessedTables.includes("iterations"), false);
});

Deno.test("tracker-mode project: still processes a merged PR", async () => {
  const payload = JSON.stringify({
    action: "closed",
    pull_request: { merged: true, title: "[SL-42] Fix bug", head: { ref: "storylane/42" } },
  });
  const { client, accessedTables } = fakeSupabase({
    integrations: { data: { config: { webhook_secret: SECRET }, is_active: true }, error: null },
    projects: { data: { workflow_mode: "tracker" }, error: null },
    stories: { data: [{ id: "story-1", number: 42 }], error: null },
    iterations: { data: [], error: null },
  });

  const res = await handleGitWebhookRequest(await signedRequest(payload), client);
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { matched: [42], finished: [42] });
  assertEquals(accessedTables.includes("stories"), true);
});
