import { scopedItems } from "./scoped-items";
import { loadInProject, withProject, withTwoProjects, ProjectTx, type Actor } from "../src/db/tx";
import type { Db } from "../src/db/client";
import { type BootstrapScope } from "../src/services/activity";

declare const db: Db;
declare const tx: ProjectTx;
declare const actor: Actor;

// OK: repository functions take a ProjectTx.
loadInProject(tx, scopedItems, "id");

// @ts-expect-error a raw Db is not a ProjectTx — services cannot bypass authorization.
loadInProject(db, scopedItems, "id");

// @ts-expect-error ProjectTx cannot be constructed outside tx.ts.
new ProjectTx();

// @ts-expect-error _create needs the module-private token, which nothing outside tx.ts can name.
ProjectTx._create(Symbol("x"), tx.tx, "p", "owner", actor);

// @ts-expect-error _invalidate needs the module-private token too, for the same reason.
tx._invalidate(Symbol("x"));

// OK: a synchronous callback.
withProject(db, actor, "p", "project:read", (t) => t.projectId);

// @ts-expect-error bun:sqlite transactions are synchronous; an async callback would commit early.
withProject(db, actor, "p", "story:write", async (t) => t.projectId);

// @ts-expect-error same for the two-project form.
withTwoProjects(db, actor, "a", "b", "story:move-cross-project", async (x, y) => [x.projectId, y.projectId]);

// @ts-expect-error BootstrapScope can only be constructed via bootstrapScope() — a literal with
// the same shape must not type-check, or a caller could forge one before the actor is a member.
({ tx: tx.tx, projectId: "p", actor }) satisfies BootstrapScope;
