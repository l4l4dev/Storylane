// Deno test — run with:
//   deno test --allow-env supabase/functions/slack-notify/index.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  handleSlackNotifyRequest,
  iterationDoneMessage,
  iterationLabel,
  iterationSkippedMessage,
  iterationStartedMessage,
  storyStateChangeMessage,
  type NotifyClient,
} from "./index.ts";

const SECRET = "test-notify-secret";
Deno.env.set("SLACK_NOTIFY_SECRET", SECRET);

// ── Message formatting: the same input/output pairs apps/web's
// slack.test.ts / iterations.test.ts assert, so the duplicated copies in
// index.ts can't drift from the web ones unnoticed. ──────────────────────
Deno.test("storyStateChangeMessage matches the web copy (incl. escaping)", () => {
  assertEquals(storyStateChangeMessage({ number: 12, title: "Add login" }, "started"), '#12 "Add login" is now *started*');
  assertEquals(
    storyStateChangeMessage({ number: 5, title: "Render <UserList> & fix" }, "started"),
    '#5 "Render &lt;UserList&gt; &amp; fix" is now *started*',
  );
});

Deno.test("iteration messages match the web copy", () => {
  assertEquals(iterationDoneMessage("Iteration #3", 8, 10), "Iteration #3 is done — 8 pts over 10 person-days (0.8 pts/person-day)");
  assertEquals(iterationDoneMessage("Iteration #4", 0, 0), "Iteration #4 is done — 0 pts");
  assertEquals(iterationDoneMessage("Iteration #5", 13, undefined), "Iteration #5 is done — 13 pts");
  assertEquals(iterationSkippedMessage("Iteration #4"), "Iteration #4 skipped");
  assertEquals(iterationStartedMessage("Iteration #4", "2026-07-07", "2026-07-20"), "Iteration #4 started (2026-07-07 – 2026-07-20)");
});

Deno.test("iterationLabel titles a 1-day cadence by date, otherwise by number", () => {
  assertEquals(iterationLabel("Sprint", 7, 1, "2026-07-24"), "2026/7/24");
  assertEquals(iterationLabel("Sprint", 7, 14, "2026-07-24"), "Sprint #7");
});

// ── Handler ───────────────────────────────────────────────────────────────
type FakeResult = { data: Record<string, unknown> | null; error: { message: string } | null };

function fakeSupabase(tables: Record<string, FakeResult>) {
  function chain(result: FakeResult) {
    const node = {
      select: () => node,
      eq: () => node,
      maybeSingle: () => Promise.resolve(result),
    };
    return node;
  }
  return {
    from(table: string) {
      const result = tables[table];
      if (!result) {
        throw new Error(`Unexpected table access: ${table}`);
      }
      return chain(result);
    },
  } as unknown as NotifyClient;
}

// Captures the Slack POST (the only global fetch the handler makes — the
// Supabase client is injected). A wrapper object rather than a bare `let` so
// TS doesn't narrow the capture to `null` across the awaited handler call
// (it can't see the fetch closure assign it).
const posted: { last: { url: string; text: string } | null } = { last: null };
globalThis.fetch = (url: string | URL | Request, init?: RequestInit) => {
  posted.last = { url: String(url), text: JSON.parse(String(init?.body)).text };
  return Promise.resolve(new Response("ok", { status: 200 }));
};
// Read through a function so TS returns the declared union rather than
// narrowing `posted.last` to the `null` it was reset to (it can't see the
// fetch closure reassign it across the awaited handler call).
function lastText(): string | null {
  return posted.last ? posted.last.text : null;
}

function req(body: unknown, secret: string = SECRET): Request {
  return new Request("https://example.com/functions/v1/slack-notify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-slack-notify-secret": secret },
    body: JSON.stringify(body),
  });
}

const ACTIVE_SLACK: FakeResult = {
  data: { config: { webhook_url: "https://hooks.slack.test/xxx" }, is_active: true },
  error: null,
};

Deno.test("rejects a non-POST", async () => {
  const res = await handleSlackNotifyRequest(
    new Request("https://example.com", { method: "GET" }),
    fakeSupabase({}),
  );
  assertEquals(res.status, 405);
});

Deno.test("rejects a wrong or missing secret", async () => {
  assertEquals((await handleSlackNotifyRequest(req({ type: "x", ref_id: "1" }, "wrong"), fakeSupabase({}))).status, 401);
  const noSecret = new Request("https://example.com", { method: "POST", body: "{}" });
  assertEquals((await handleSlackNotifyRequest(noSecret, fakeSupabase({}))).status, 401);
});

Deno.test("story_state_changed posts the transition message", async () => {
  posted.last = null;
  const client = fakeSupabase({
    activity_logs: { data: { project_id: "p1", story_id: "s1", payload: { to: "Started" } }, error: null },
    stories: { data: { number: 12, title: "Add login" }, error: null },
    integrations: ACTIVE_SLACK,
  });
  const res = await handleSlackNotifyRequest(req({ type: "story_state_changed", ref_id: "log1" }), client);
  assertEquals(res.status, 200);
  assertEquals(lastText(), '#12 "Add login" is now *Started*');
});

Deno.test("story_state_changed to the Icebox (payload.to null) says Icebox", async () => {
  posted.last = null;
  const client = fakeSupabase({
    activity_logs: { data: { project_id: "p1", story_id: "s1", payload: { to: null } }, error: null },
    stories: { data: { number: 7, title: "Parked" }, error: null },
    integrations: ACTIVE_SLACK,
  });
  await handleSlackNotifyRequest(req({ type: "story_state_changed", ref_id: "log1" }), client);
  assertEquals(lastText(), '#7 "Parked" is now *Icebox*');
});

Deno.test("iteration_finalized posts the done message with the rate", async () => {
  posted.last = null;
  const client = fakeSupabase({
    iterations: {
      data: { project_id: "p1", number: 3, velocity: 8, capacity: 10, skipped: false, start_date: "2026-07-01", end_date: "2026-07-14" },
      error: null,
    },
    projects: { data: { iteration_term: "Sprint", iteration_length: 14 }, error: null },
    integrations: ACTIVE_SLACK,
  });
  await handleSlackNotifyRequest(req({ type: "iteration_finalized", ref_id: "i1" }), client);
  assertEquals(lastText(), "Sprint #3 is done — 8 pts over 10 person-days (0.8 pts/person-day)");
});

Deno.test("iteration_finalized with skipped=true posts the skipped message", async () => {
  posted.last = null;
  const client = fakeSupabase({
    iterations: {
      data: { project_id: "p1", number: 4, velocity: 0, capacity: 0, skipped: true, start_date: "2026-07-15", end_date: "2026-07-15" },
      error: null,
    },
    projects: { data: { iteration_term: "Sprint", iteration_length: 14 }, error: null },
    integrations: ACTIVE_SLACK,
  });
  await handleSlackNotifyRequest(req({ type: "iteration_finalized", ref_id: "i1" }), client);
  assertEquals(lastText(), "Sprint #4 skipped");
});

Deno.test("iteration_started on a 1-day cadence titles by date", async () => {
  posted.last = null;
  const client = fakeSupabase({
    iterations: {
      data: { project_id: "p1", number: 40, velocity: null, capacity: null, skipped: false, start_date: "2026-07-24", end_date: "2026-07-26" },
      error: null,
    },
    projects: { data: { iteration_term: "Iteration", iteration_length: 1 }, error: null },
    integrations: ACTIVE_SLACK,
  });
  await handleSlackNotifyRequest(req({ type: "iteration_started", ref_id: "i1" }), client);
  assertEquals(lastText(), "2026/7/24 started (2026-07-24 – 2026-07-26)");
});

Deno.test("skips (no POST) when the project has no active slack integration", async () => {
  posted.last = null;
  const client = fakeSupabase({
    activity_logs: { data: { project_id: "p1", story_id: "s1", payload: { to: "Started" } }, error: null },
    stories: { data: { number: 12, title: "Add login" }, error: null },
    integrations: { data: { config: {}, is_active: false }, error: null },
  });
  const res = await handleSlackNotifyRequest(req({ type: "story_state_changed", ref_id: "log1" }), client);
  assertEquals(res.status, 200);
  assertEquals(posted.last, null);
});

Deno.test("a deleted row (no message) is a 200 no-op, never a retryable error", async () => {
  posted.last = null;
  const client = fakeSupabase({ iterations: { data: null, error: null } });
  const res = await handleSlackNotifyRequest(req({ type: "iteration_finalized", ref_id: "gone" }), client);
  assertEquals(res.status, 200);
  assertEquals(posted.last, null);
});
