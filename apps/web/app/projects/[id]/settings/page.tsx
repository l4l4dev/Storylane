import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ITERATION_LENGTHS, POINT_SCALES } from "@/lib/types";
import { IntegrationSettings, type IntegrationRow } from "@/components/features/projects/integration-settings";
import { InviteMemberForm } from "@/components/features/projects/invite-member-form";
import { LabelManager } from "@/components/features/projects/label-manager";
import { LaneManager } from "@/components/features/projects/lane-manager";
import { StatusManager } from "@/components/features/projects/status-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { updateProject, updateMemberRole, removeMember } from "./actions";

const ROLES = ["owner", "member", "viewer"] as const;

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (!project) {
    notFound();
  }

  const { data: members } = await supabase
    .from("project_members")
    .select("user_id, role, profiles(display_name, avatar_url)")
    .eq("project_id", id);

  const myRole = members?.find((m) => m.user_id === user?.id)?.role;
  const isOwner = myRole === "owner";
  const isMember = myRole === "owner" || myRole === "member";

  const { data: labels } = await supabase
    .from("labels")
    .select("id, name, color")
    .eq("project_id", id)
    .order("name");

  // RLS returns integrations only to owners — empty for everyone else.
  const { data: integrations } = isOwner
    ? await supabase.from("integrations").select("id, provider, config, is_active").eq("project_id", id)
    : { data: null };

  // Task 14: free-mode projects manage their board columns here.
  const isFree = project.workflow_mode === "free";
  const { data: customStatuses } = isFree
    ? await supabase
        .from("custom_statuses")
        .select("id, name, color, position, is_done")
        .eq("project_id", id)
        .order("position", { ascending: true })
    : { data: null };

  // TASK-16.3: free-mode projects manage their swimlanes here too.
  const { data: swimlanes } = isFree
    ? await supabase.from("swimlanes").select("id, name, position").eq("project_id", id).order("position", { ascending: true })
    : { data: null };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Project details */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <form action={updateProject} className="flex flex-col gap-4">
          <input type="hidden" name="project_id" value={project.id} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-name">Name</Label>
            <Input id="settings-name" name="name" defaultValue={project.name} required disabled={!isOwner} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-description">Description</Label>
            <Textarea
              id="settings-description"
              name="description"
              defaultValue={project.description ?? ""}
              rows={2}
              disabled={!isOwner}
            />
          </div>
          <div className="flex gap-4">
            {/* Task 14: free-mode projects have no iterations/velocity. */}
            {!isFree && (
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="settings-iteration-length">Iteration length (days)</Label>
                <NativeSelect
                  id="settings-iteration-length"
                  name="iteration_length"
                  defaultValue={project.iteration_length}
                  disabled={!isOwner}
                >
                  {ITERATION_LENGTHS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="settings-point-scale">Point scale</Label>
              <NativeSelect
                id="settings-point-scale"
                name="point_scale"
                defaultValue={project.point_scale}
                disabled={!isOwner}
              >
                {POINT_SCALES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {!isFree && (
              <div className="flex w-32 flex-col gap-1.5">
                <Label htmlFor="settings-velocity-window">Velocity window</Label>
                <Input
                  id="settings-velocity-window"
                  name="velocity_window"
                  type="number"
                  min={1}
                  defaultValue={project.velocity_window}
                  disabled={!isOwner}
                />
              </div>
            )}
          </div>
          {isOwner && (
            <div>
              <Button type="submit">Save changes</Button>
            </div>
          )}
        </form>
      </section>

      {/* Members */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Members</h2>

        {isOwner && (
          <div className="mb-4">
            <InviteMemberForm projectId={project.id} />
          </div>
        )}

        <ul className="flex flex-col divide-y divide-border">
          {members?.map((member) => {
            const profile = Array.isArray(member.profiles)
              ? member.profiles[0]
              : member.profiles;
            const isSelf = member.user_id === user?.id;
            return (
              <li
                key={member.user_id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <span className="text-sm">
                  {profile?.display_name ?? member.user_id.slice(0, 8)}
                  {isSelf && <span className="ml-1 text-muted-foreground">(you)</span>}
                </span>

                {isOwner ? (
                  <div className="flex items-center gap-2">
                    <form action={updateMemberRole} className="flex items-center gap-2">
                      <input type="hidden" name="project_id" value={project.id} />
                      <input type="hidden" name="user_id" value={member.user_id} />
                      <NativeSelect
                        name="role"
                        defaultValue={member.role}
                        aria-label={`Role for ${profile?.display_name ?? "member"}`}
                        className="h-8 w-auto"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </NativeSelect>
                      <Button type="submit" variant="outline" size="sm">
                        Save
                      </Button>
                    </form>
                    {!isSelf && (
                      <form action={removeMember}>
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="user_id" value={member.user_id} />
                        <Button type="submit" variant="destructive" size="sm">
                          Remove
                        </Button>
                      </form>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{member.role}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Board statuses (Task 14 — free-mode projects only) */}
      {isFree && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Board statuses</h2>
          <StatusManager
            projectId={project.id}
            statuses={customStatuses ?? []}
            canEdit={isMember}
            canDelete={isOwner}
          />
        </section>
      )}

      {/* Swimlanes (TASK-16.3 — free-mode projects only) */}
      {isFree && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Swimlanes</h2>
          <LaneManager
            projectId={project.id}
            lanes={swimlanes ?? []}
            canEdit={isMember}
            canDelete={isOwner}
          />
        </section>
      )}

      {/* Labels */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Labels</h2>
        <LabelManager
          projectId={project.id}
          labels={labels ?? []}
          canCreate={isMember}
          canDelete={isOwner}
        />
      </section>

      {/* Integrations (owner-only: config holds secrets — see spec/integrations.md) */}
      {isOwner && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Integrations</h2>
          <IntegrationSettings
            projectId={project.id}
            integrations={(integrations ?? []) as IntegrationRow[]}
            functionsBaseUrl={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`}
          />
        </section>
      )}
    </main>
  );
}
