---
id: decision-1
title: >-
  iOS port: server-side finalization, DB-enforced invariants, per-client pure
  logic with golden fixtures
date: '2026-07-08 07:43'
status: accepted
---
## Context

The iOS phase starts after the Web tasks complete. Web and iOS never call
each other — the only shared surface is Supabase (ARCHITECTURE.md). The
critical asymmetry: Web routes every mutation through Next.js **server
actions**, but iOS Repositories will talk to Supabase **directly**. So
anything enforced only inside a server action (validity checks, side
effects like Slack) silently does not apply to iOS writes. Four classes of
logic are affected:

1. State-mutating maintenance triggered by reads: iteration
   rollover/finalization (today a TS implementation in `board/actions.ts`
   `ensureCurrentIteration`), and soon recurring-story generation
   (TASK-16.4).
2. Data invariants: transition rules, project scoping, number pinning.
3. Side effects: Slack notifications fired from server actions via
   `after()`.
4. Pure display/planning computations: state machine, point scales,
   virtual-iteration walk, velocity math, drop evaluation.

## Decision

**1. Rollover/finalization moves into a single Postgres RPC — not an Edge
Function, and never a second client implementation.** TASK-10's spec
already mandates the RPC (SECURITY DEFINER, per-project advisory lock,
idempotent — spec/velocity.md "Finalization concurrency"); implementing
TASK-10 replaces the TS `ensureCurrentIteration` internals with that RPC,
and iOS later calls the identical `rpc(...)` on board load. RPC over Edge
Function because it is transactional, advisory locks are native, there is
no cold start, and supabase-js / supabase-swift share the same call
surface with the caller's JWT. A future cron (scheduled Edge Function) can
call the same RPC without changing clients. The same rule applies to
recurring-story generation (TASK-16.4) and story Move/Copy (TASK-14) —
already specced as RPCs.

**2. Invariants live in the database, not in per-client code.** RLS,
triggers (story-number pinning, the done-iteration assignment guard from
TASK-10), and composite FKs (TASK-18) are the enforcement layer, because
the Web server-action layer does not cover iOS. Exception, accepted for
Phase 1: the story state machine is *not* DB-enforced — a tampered client
can only corrupt its own project's flow, so clients validate transitions
with their local pure implementation and the DB stays permissive.

**3. Slack notifications must leave the server-action layer before iOS
write paths ship.** Today `after(() => notifySlack(...))` runs only on Web
mutations; an iOS state change would silently skip Slack. Target shape: a
Database Webhook (or trigger + pg_net) on the relevant writes invoking an
Edge Function — client-agnostic, same principle as the activity_logs
triggers. Until that lands, Slack-on-state-change is a documented Web-only
behavior; relocating it is a prerequisite task for the iOS phase, not a
Phase-1 Web task.

**4. Pure logic is duplicated per client, kept in sync by golden
fixtures.** No shared runtime exists between TypeScript and Swift, so the
state machine, point-scale parsing, `buildBacklogRows`/virtual-group walk,
velocity math, and drop evaluation get a Swift twin. The parity contract
is shared JSON test vectors under `spec/fixtures/` consumed by both Vitest
and Swift Testing — a behavior change edits the fixture first, and both
suites must pass. iOS Repositories mirror the Web data-access modules and
call RPCs by the same names (StoryRepository, ProjectRepository,
IterationRepository, ...).

## Consequences

- iOS never reimplements rollover, recurring generation, or move/copy;
  board load = one `ensure` RPC call + queries, identical to Web after
  TASK-10 lands. TASK-10/14/16.4 implementations must treat the RPC as the
  deliverable, not a Web-internal helper.
- A "move Slack notifications to DB webhook → Edge Function" task must be
  completed before the first iOS write path ships.
- `spec/fixtures/` and a Swift Testing harness are new costs, paid once —
  the cheap defense against silent Web/iOS drift.
- ARCHITECTURE.md's cross-layer table gets a row per item as each piece
  lands (finalization RPC, Slack webhook path, fixtures).
