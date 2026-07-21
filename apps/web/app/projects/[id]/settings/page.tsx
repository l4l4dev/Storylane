import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ITERATION_LENGTHS, POINT_SCALES, iterationLengthLabel } from "@/lib/types";
import { IntegrationSettings, type IntegrationRow } from "@/components/features/projects/integration-settings";
import { InviteMemberForm } from "@/components/features/projects/invite-member-form";
import { MemberList } from "@/components/features/projects/member-list";
import { LabelManager } from "@/components/features/projects/label-manager";
import { StateManager } from "@/components/features/projects/state-manager";
import {
  WorkingDaysSettings,
  type CalendarException,
} from "@/components/features/projects/working-days-settings";
import type { ProjectState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { updateProject } from "./actions";
import { SettingsSaveToast } from "@/components/features/projects/settings-save-toast";

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
    .select("user_id, role, profiles(display_name, avatar_url, is_agent)")
    .eq("project_id", id);

  const myRole = members?.find((m) => m.user_id === user?.id)?.role;
  const isOwner = myRole === "owner";
  const isMember = myRole === "owner" || myRole === "member";

  const { data: labels } = await supabase
    .from("labels")
    .select("id, name, color")
    .eq("project_id", id)
    .order("name");

  const { data: statesData } = await supabase
    .from("project_states")
    .select("id, project_id, name, action_label, category, position, created_at")
    .eq("project_id", id)
    .order("position");
  const states = (statesData ?? []) as ProjectState[];

  const { data: calendarExceptions } = await supabase
    .from("project_calendar_exceptions")
    .select("id, date, kind")
    .eq("project_id", id)
    .order("date");

  // RLS returns integrations only to owners — empty for everyone else.
  const { data: integrations } = isOwner
    ? await supabase.from("integrations").select("id, provider, config, is_active").eq("project_id", id)
    : { data: null };

  return (
    <main className="mx-auto max-w-2xl p-6">
      <SettingsSaveToast />
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
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="settings-iteration-term">What you call an iteration</Label>
              <Input
                id="settings-iteration-term"
                name="iteration_term"
                defaultValue={project.iteration_term}
                maxLength={30}
                placeholder="Iteration"
                disabled={!isOwner}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor="settings-iteration-length">Length</Label>
                <NativeSelect
                  id="settings-iteration-length"
                  name="iteration_length"
                  defaultValue={project.iteration_length}
                  disabled={!isOwner}
                >
                  {ITERATION_LENGTHS.map((d) => (
                    <option key={d} value={d}>
                      {iterationLengthLabel(d)}
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
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                name="apply_to_current"
                className="mt-0.5 size-4 shrink-0 rounded border-input"
              />
              {/* TASK-105 (doc-11 D3): default (unchecked) applies a length
                  change only to the next iteration (TASK-87). Checked also
                  reshapes the current one now — a no-op if it has no current
                  iteration or the new length would end in the past. */}
              <span>
                Apply a length change to the current iteration now
                <span className="block text-xs">
                  Off: the new length takes effect from the next iteration.
                </span>
              </span>
            </label>
          )}
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
              isAgent: profile?.is_agent ?? false,
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

      {/* Working-day calendar (doc-8 §6): affects planning capacity only —
          it never moves an iteration's start or end date. */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Calendar</h2>
        <WorkingDaysSettings
          projectId={project.id}
          workingWeekdays={project.working_weekdays}
          exceptions={(calendarExceptions ?? []) as CalendarException[]}
          canEditWeekdays={isOwner}
          canManageExceptions={isMember}
        />
      </section>

      {/* States (doc-8 §2): board columns are per-project and editable here.
          Every member can reorder/rename/edit the action label; only the
          owner can delete one (matches project_states RLS). */}
      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">States</h2>
        <StateManager projectId={project.id} states={states} canManage={isMember} canDelete={isOwner} />
      </section>

      {/* Integrations (owner-only: config holds secrets — see spec/integrations.md) */}
      {isOwner && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Integrations</h2>
          <IntegrationSettings
            projectId={project.id}
            integrations={(integrations ?? []) as IntegrationRow[]}
            states={states}
            functionsBaseUrl={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`}
          />
        </section>
      )}
    </main>
  );
}
