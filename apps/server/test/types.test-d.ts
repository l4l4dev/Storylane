import { scopedItems } from "../src/db/schema";
import { loadInProject, ProjectTx } from "../src/db/tx";
import type { Db } from "../src/db/client";

declare const db: Db;
declare const tx: ProjectTx;

// OK: repository functions take a ProjectTx.
loadInProject(tx, scopedItems, "id");

// @ts-expect-error a raw Db is not a ProjectTx — services cannot bypass authorization.
loadInProject(db, scopedItems, "id");

// @ts-expect-error ProjectTx cannot be constructed outside tx.ts.
new ProjectTx();
