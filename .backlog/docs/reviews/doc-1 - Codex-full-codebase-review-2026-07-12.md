---
id: doc-1
title: Codex full-codebase review 2026-07-12
type: other
created_date: '2026-07-11 16:53'
updated_date: '2026-07-11 16:53'
tags:
  - codex
  - review
  - security
---
> Source: Codex (GPT-5.4) full-codebase review, run 2026-07-12 from Claude Code.
> Triage: findings tracked as TASK-53..58 (plus overlap notes on TASK-51/56). Read-only scan of apps/web + supabase/.

# Storylane Full-Codebase Review

## Correctness Bugs

### High — Webhook reports success when iteration assignment fails

**Paths:** `supabase/functions/git-webhook/index.ts:163-169, 179-203` — `handleGitWebhookRequest`

The handler checks the error from the state update, but ignores both the read error for the current iteration and the error from the subsequent `iteration_id` update. It can therefore return `200` with a story listed as finished even though the story remains stranded outside an iteration.

**Impact:** A transient database failure or constraint violation leaves the board inconsistent while the Git provider sees successful delivery and will not retry.  
**Fix direction:** Move “finish and assign iteration” into one transactional RPC and return failure unless the complete operation succeeds.

### Medium — Free-project creation can leave a partially initialized project

**Paths:** `apps/web/app/dashboard/actions.ts:111-145` — project creation flow

The project row is committed before the default `custom_statuses` and invitations are created. If status creation fails, the action throws but leaves a free-mode project with no workflow columns; invitation failures similarly produce only a partially completed setup.

**Impact:** Users can end up with an unusable or unexpectedly configured project after an apparently failed submission.  
**Fix direction:** Introduce a database RPC that creates the project, default statuses, membership, and requested invitations in one transaction, with an explicit policy for invalid invitees.

### Medium — Update actions silently succeed when their target no longer exists

**Paths:** `apps/web/app/stories/[id]/actions.ts:348-355, 362-369, 376-384` — task toggle/delete and story delete; `apps/web/app/projects/[id]/epics/actions.ts:45-59, 63-75` — epic update/delete

These mutations check only the Supabase error. PostgreSQL updates and deletes that affect zero rows are successful, so stale IDs, already-deleted objects, and RLS-filtered targets can be reported as successful.

**Impact:** The UI revalidates or redirects as if the mutation happened, masking stale-client conflicts and authorization failures.  
**Fix direction:** Add `.select("id")` and assert exactly one affected row, as newer dashboard actions already do.

### Low — Invalid lane-move directions are coerced to “down”

**Path:** `apps/web/app/projects/[id]/settings/actions.ts:368-385` — `moveLane`

Every `direction` value other than the exact string `"up"` becomes `"down"`. A malformed or tampered request can therefore mutate ordering instead of being rejected.

**Impact:** Bad client state or crafted form submissions can unexpectedly reorder lanes.  
**Fix direction:** Validate against an explicit `"up" | "down"` union and reject all other values.

## Security/RLS Gaps

### High — Owners can remove or demote the final owner

**Paths:** `supabase/migrations/20260627000002_projects.sql:109-116` — project-member update/delete policies; `supabase/migrations/20260709000003_fix_invite_member_null_role_bypass.sql:48-50` — membership upsert

The RLS policies allow any current owner to update or delete any membership row, including their own and the only owner’s row. `invite_member` can also overwrite an existing owner’s role without enforcing that at least one owner remains.

**Impact:** A project can become ownerless, permanently preventing normal settings changes, archival, deletion, and member administration. A co-owner can also lock another owner out.  
**Fix direction:** Centralize membership mutations in transactional RPCs that lock the project’s membership rows and reject removal/demotion of the final owner; revoke direct update/delete privileges for membership administration.

### Medium — Activity records can reference a story from a different project

**Path:** `supabase/migrations/20260627000006_comments_activity.sql:15-22, 68-77`

`activity_logs.project_id` and `story_id` are independent foreign keys, and the insert policy validates membership only against `project_id`. An authenticated member with access to activity insertion can create a log in one project that references a story belonging to another project.

**Impact:** This breaks tenant integrity and can expose foreign story identifiers to members of the wrong project through activity feeds or future joins.  
**Fix direction:** Add a composite foreign key `(story_id, project_id) -> stories(id, project_id)` and preferably restrict direct activity insertion to trusted trigger/RPC paths.

### Medium — Broad default function grants expose every future RPC automatically

**Path:** `supabase/migrations/20260630000002_grants.sql:14-23`

All existing and future functions in `public` receive `EXECUTE` for `authenticated`. This includes `SECURITY DEFINER` functions unless every migration remembers to add its own internal authorization checks and explicit revokes.

**Impact:** A future maintenance or trigger helper can accidentally become a remotely callable privilege-escalation surface immediately upon creation. The previously exploitable `invite_member` NULL-role bug demonstrates the consequence of relying entirely on per-function checks.  
**Fix direction:** Revoke the blanket/default function grant and grant execution explicitly only to intended RPC entry points; revoke public/authenticated execution from trigger and internal helper functions.

### Low — Integration secrets are returned to browser-facing owner queries

**Paths:** `supabase/migrations/20260627000007_integrations.sql:5-33`; `apps/web/app/projects/[id]/settings/page.tsx` — integration settings query/render flow

The integration table stores `webhook_secret` inside `config`, and its owner SELECT policy grants the full row rather than a redacted projection. The settings page reads integration configuration through the ordinary user client.

**Impact:** Any owner session or client-side data exposure can retrieve reusable webhook signing secrets; ownership is sufficient under current policy, but secret material has a larger exposure surface than necessary.  
**Fix direction:** Store secrets separately in a service-only table or expose a redacted view/RPC that never returns the secret after creation.

## Concurrency Issues

### High — Drag-and-drop state changes and reorder writes are non-atomic

**Paths:** `apps/web/app/projects/[id]/board/actions.ts:220-277` — `dropStoryFree`; `299-363` — `dropStory`; `383-429` — `setStoryFocus`; `465-524, 541-564` — list drop and `persistBacklogOrder`

Each action first changes the dragged story and then issues many independent position updates through `Promise.all`. Failure halfway through preserves the state/column change and any successful position updates while the rest fail.

**Impact:** Network/database failures can leave duplicate, gapped, or contradictory ordering. Concurrent drags use stale client-supplied sequences, so the last group of individual updates can overwrite portions of another user’s reorder.  
**Fix direction:** Replace these flows with transactional RPCs that lock the affected project/column rows, validate the submitted membership set/version, and update state plus ordering atomically.

### High — Status and lane swaps are two independent writes

**Paths:** `apps/web/app/projects/[id]/settings/actions.ts:276-306` — custom-status move; `369-404` — `moveLane`

Neighbor swaps are executed as two parallel updates without a transaction or lock. One update may succeed while the other fails, and concurrent moves can operate from the same stale ordering snapshot.

**Impact:** Columns or lanes can acquire duplicate positions or appear in nondeterministic order, affecting every user of the board.  
**Fix direction:** Implement a transactional swap RPC using row locks or an advisory project lock; consider a uniqueness constraint compatible with deferred swaps.

### Medium — “max position + 1” creation races

**Paths:** `apps/web/app/stories/[id]/actions.ts:333-336` — `addTask`; `apps/web/app/projects/[id]/epics/actions.ts:19-29` — epic creation; `apps/web/app/projects/[id]/settings/actions.ts:320-324` — lane creation; `supabase/migrations/20260709000008_recurring_stories.sql:166-171` — recurring-story position assignment

These flows derive the next position by reading the current maximum and then inserting. Concurrent creators can calculate the same position; the recurring generator’s per-rule claim prevents duplicate occurrences but does not serialize position assignment across different rules or ordinary story creation.

**Impact:** Equal positions produce unstable ordering and make later reorder operations fragile.  
**Fix direction:** Allocate positions inside a locked transactional RPC, use a per-project sequence/counter, or make ordering identifiers collision-tolerant.

### Medium — Webhook state transition and iteration assignment are separate transactions

**Path:** `supabase/functions/git-webhook/index.ts:163-198`

The story is first moved to `finished`, then the active iteration is queried and assigned in a later request. Iteration finalization can occur between these operations, or another actor can modify the story after the first update.

**Impact:** A story may be attached to a just-finalized iteration, remain unassigned, or overwrite a concurrent placement decision.  
**Fix direction:** Combine conditional state transition, active-iteration locking, and assignment in one database transaction.

### Low — Story transition validation is vulnerable to stale reads

**Path:** `apps/web/app/projects/[id]/board/actions.ts:299-345` — `dropStory`

The action reads the story, validates its transition, and later updates by ID/project only. It does not require the stored state or iteration to still match the values used during validation.

**Impact:** Two concurrent transitions can both validate against the same old state, with the later update overwriting the first and bypassing the intended one-step workflow semantics.  
**Fix direction:** Use an RPC with `SELECT … FOR UPDATE`, or include the expected old state and iteration in the update predicate and reject zero affected rows.

## Maintainability Risks

### High — Critical board mutation logic is duplicated across multiple action paths

**Paths:** `apps/web/app/projects/[id]/board/actions.ts:209-282, 291-367, 375-433, 451-565`

Free-board drop, tracker-board drop, focus drop, and list drop each independently implement fetch/validate/update/reorder/revalidate behavior. Several already share the same non-atomic position-update pattern, but fixes must currently be repeated in every path.

**Impact:** Security, concurrency, and validation behavior can drift between board views; a fix applied to one drag path may leave the others vulnerable.  
**Fix direction:** Consolidate mutations behind a small set of database RPCs and shared typed action helpers.

### Medium — Position semantics lack database-enforced invariants

**Paths:** `supabase/migrations/20260627000003_epics_labels.sql:5-28`; `20260627000005_stories_tasks.sql:6-46`; `20260707000001_backlog_dividers.sql:18-25`; `20260707000007_workflow_modes.sql:20-38`; `20260709000007_free_mode_swimlanes.sql:13-27`

The schema stores integer positions across many tables but generally has no uniqueness, non-negative, or scope-specific ordering constraint. Application code assumes dense, stable order and sometimes interleaves positions across separate tables.

**Impact:** Partial writes and concurrent operations can persist states the UI algorithms were not designed to interpret, with no database rejection or repair signal.  
**Fix direction:** Document the ordering invariant, enforce feasible constraints, and expose transactional reorder operations rather than raw per-row updates.

### Medium — RLS regression coverage is uneven around direct membership mutations

**Paths:** `supabase/migrations/20260627000002_projects.sql:101-116`; `apps/web/lib/utils/invite-search.integration.test.ts` — invitation integration coverage

Integration tests exercise invitation RPC authorization, but the direct `project_members` update/delete policies—including self-demotion, last-owner deletion, and owner-to-owner changes—lack corresponding critical-path coverage.

**Impact:** Membership-policy regressions can reintroduce takeover or project-lockout behavior without failing the current suite.  
**Fix direction:** Add database integration tests for outsider access, viewer restrictions, self-removal, co-owner mutations, and final-owner invariants.

### Medium — Webhook tests do not protect the ignored second-write failure

**Paths:** `supabase/functions/git-webhook/index.ts:179-203`; `supabase/functions/git-webhook/index.test.ts`

The production handler intentionally injects a fake client for tests, but the unchecked iteration query/update branch remains possible because the handler does not inspect those errors.

**Impact:** Tests can remain green while the webhook acknowledges an incomplete mutation.  
**Fix direction:** Add explicit failure-path tests for iteration lookup and assignment, then require the handler or transactional RPC to return a retryable failure.

### Low — Edge Function database access is untyped

**Path:** `supabase/functions/git-webhook/index.ts:61-67`

The handler accepts `any`, and the real Supabase client is created without the generated database type. Column names, result shapes, and RPC contracts therefore receive no compile-time checking.

**Impact:** Schema changes can silently break the webhook and only surface at runtime after deployment.  
**Fix direction:** Share or generate Edge-compatible database types and type the injected client with a narrow interface instead of `any`.
