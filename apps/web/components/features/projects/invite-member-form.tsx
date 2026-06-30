"use client";

import { useActionState } from "react";
import { inviteMember, type InviteState } from "@/app/projects/[id]/settings/actions";

export function InviteMemberForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    inviteMember,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder="email@example.com"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-zinc-800"
        />
        <select
          name="role"
          defaultValue="member"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-zinc-800"
        >
          <option value="member">member</option>
          <option value="viewer">viewer</option>
          <option value="owner">owner</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Inviting…" : "Invite"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-500">{state.error}</p>}
      {state.success && <p className="text-sm text-green-600">{state.success}</p>}
    </form>
  );
}
