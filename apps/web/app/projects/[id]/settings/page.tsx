import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ITERATION_LENGTHS, POINT_SCALES } from "@/lib/types";
import { InviteMemberForm } from "@/components/features/projects/invite-member-form";
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

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/dashboard" className="text-indigo-600 hover:underline">
            ← Projects
          </Link>
          <Link href={`/projects/${project.id}`} className="text-indigo-600 hover:underline">
            Home
          </Link>
          <Link
            href={`/projects/${project.id}/board`}
            className="text-indigo-600 hover:underline"
          >
            Board
          </Link>
        </div>
        <h1 className="mt-2 text-2xl font-bold">{project.name} · Settings</h1>
      </div>

      {/* Project details */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Details</h2>
        <form action={updateProject} className="flex flex-col gap-4">
          <input type="hidden" name="project_id" value={project.id} />
          <label className="flex flex-col gap-1 text-sm">
            <span>Name</span>
            <input
              name="name"
              defaultValue={project.name}
              required
              disabled={!isOwner}
              className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-60 dark:border-gray-700 dark:bg-zinc-800"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Description</span>
            <textarea
              name="description"
              defaultValue={project.description ?? ""}
              rows={2}
              disabled={!isOwner}
              className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-60 dark:border-gray-700 dark:bg-zinc-800"
            />
          </label>
          <div className="flex gap-4">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span>Iteration length (days)</span>
              <select
                name="iteration_length"
                defaultValue={project.iteration_length}
                disabled={!isOwner}
                className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-60 dark:border-gray-700 dark:bg-zinc-800"
              >
                {ITERATION_LENGTHS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span>Point scale</span>
              <select
                name="point_scale"
                defaultValue={project.point_scale}
                disabled={!isOwner}
                className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-60 dark:border-gray-700 dark:bg-zinc-800"
              >
                {POINT_SCALES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-32 flex-col gap-1 text-sm">
              <span>Velocity window</span>
              <input
                name="velocity_window"
                type="number"
                min={1}
                defaultValue={project.velocity_window}
                disabled={!isOwner}
                className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-60 dark:border-gray-700 dark:bg-zinc-800"
              />
            </label>
          </div>
          {isOwner && (
            <div>
              <button
                type="submit"
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Save changes
              </button>
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

        <ul className="flex flex-col divide-y divide-gray-200 dark:divide-gray-800">
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
                  {isSelf && <span className="ml-1 text-gray-400">(you)</span>}
                </span>

                {isOwner ? (
                  <div className="flex items-center gap-2">
                    <form action={updateMemberRole} className="flex items-center gap-2">
                      <input type="hidden" name="project_id" value={project.id} />
                      <input type="hidden" name="user_id" value={member.user_id} />
                      <select
                        name="role"
                        defaultValue={member.role}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-zinc-800"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-700"
                      >
                        Save
                      </button>
                    </form>
                    {!isSelf && (
                      <form action={removeMember}>
                        <input type="hidden" name="project_id" value={project.id} />
                        <input type="hidden" name="user_id" value={member.user_id} />
                        <button
                          type="submit"
                          className="rounded-md border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-gray-500">{member.role}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
