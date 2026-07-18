import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ITERATION_LENGTHS, POINT_SCALES } from "@/lib/types";
import { IntegrationSettings, type IntegrationRow } from "@/components/features/projects/integration-settings";
import { InviteMemberForm } from "@/components/features/projects/invite-member-form";
import { MemberList } from "@/components/features/projects/member-list";
import { LabelManager } from "@/components/features/projects/label-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { updateProject } from "./actions";

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

        <MemberList
          projectId={project.id}
          currentUserId={user?.id}
          canManage={isOwner}
          members={(members ?? []).map((member) => {
            const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
            return {
              userId: member.user_id,
              role: member.role,
              displayName: profile?.display_name ?? member.user_id.slice(0, 8),
            };
          })}
        />
      </section>

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
