import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";
import { ProjectCardMenu } from "./project-card-menu";

export type ProjectCardMember = { userId: string; displayName: string; avatarUrl: string | null };

export type ProjectCardData = {
  id: string;
  name: string;
  description: string | null;
  workflowMode: "tracker" | "free";
  createdAt: string;
  updatedAt: string;
  members: ProjectCardMember[];
  isFavorite: boolean;
  isOwner: boolean;
  archivedAt: string | null;
  currentIterationNumber?: number | null;
  velocity?: number | null;
  columnCount?: number;
  openCardCount?: number;
};

const MAX_VISIBLE_AVATARS = 4;

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function summaryLine(project: ProjectCardData): string | null {
  if (project.workflowMode === "tracker") {
    if (project.currentIterationNumber == null) {
      return null;
    }
    return `Iteration #${project.currentIterationNumber} · velocity ${project.velocity ?? 0} pts`;
  }
  return `${project.columnCount ?? 0} columns · ${project.openCardCount ?? 0} open cards`;
}

// spec/screens.md "Projects page". Archive/favorite/search/sort controls
// live in ProjectGrid, not added here.
export function ProjectCard({ project }: { project: ProjectCardData }) {
  const visibleMembers = project.members.slice(0, MAX_VISIBLE_AVATARS);
  const overflowCount = project.members.length - visibleMembers.length;
  const summary = summaryLine(project);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-2">
          <CardTitle className="min-w-0 flex-1 break-words">
            <Link href={`/projects/${project.id}`} className="hover:underline">
              {project.name}
            </Link>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            {project.archivedAt && <Badge variant="outline">Archived</Badge>}
            <Badge variant={project.workflowMode === "tracker" ? "default" : "secondary"}>
              {project.workflowMode === "tracker" ? "Tracker" : "Free"}
            </Badge>
            <ProjectCardMenu
              projectId={project.id}
              projectName={project.name}
              isOwner={project.isOwner}
              isFavorite={project.isFavorite}
              isArchived={project.archivedAt !== null}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {project.description && <p className="text-sm text-muted-foreground">{project.description}</p>}
        {summary && <p className="text-sm">{summary}</p>}
        <div className="flex items-center justify-between">
          <div className="flex -space-x-2">
            {visibleMembers.map((member) =>
              member.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar URLs are arbitrary OAuth hosts, not project assets
                <img
                  key={member.userId}
                  src={member.avatarUrl}
                  alt={member.displayName}
                  className="size-6 rounded-full ring-2 ring-card"
                />
              ) : (
                <span
                  key={member.userId}
                  title={member.displayName}
                  className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card"
                >
                  {initials(member.displayName)}
                </span>
              ),
            )}
            {overflowCount > 0 && (
              <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-card">
                +{overflowCount}
              </span>
            )}
          </div>
          <time dateTime={project.updatedAt} className="text-xs text-muted-foreground">
            {formatDate(project.updatedAt)}
          </time>
        </div>
      </CardContent>
    </Card>
  );
}
