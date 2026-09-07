import { eq } from "drizzle-orm";
import { projects } from "../db/schema";
import type { ProjectTx } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  archivedAt: number | null;
  role: MemberRole;
}

export function readProject(tx: ProjectTx): ProjectDetail {
  const row = tx.tx
    .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  // `description` arrives with migration 0003 (Task 2); until then it is always null.
  return { id: row.id, name: row.name, description: null, archivedAt: row.archivedAt, role: tx.role };
}
