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
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return { id: row.id, name: row.name, description: row.description, archivedAt: row.archivedAt, role: tx.role };
}
