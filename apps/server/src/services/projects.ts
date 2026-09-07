import { eq } from "drizzle-orm";
import type { ProjectTx } from "../db/tx";
import { projects } from "../db/schema";

export function readProject(tx: ProjectTx) {
  return tx.tx
    .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
}
