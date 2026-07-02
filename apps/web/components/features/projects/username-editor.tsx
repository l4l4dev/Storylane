"use client";

import { useActionState } from "react";
import { updateUsername, type UpdateUsernameState } from "@/app/dashboard/actions";

export function UsernameEditor({ username }: { username: string }) {
  const [state, formAction, pending] = useActionState<UpdateUsernameState, FormData>(
    updateUsername,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-500">Username</span>
      <span className="text-gray-400">@</span>
      <input
        name="username"
        required
        minLength={3}
        maxLength={30}
        pattern="[a-z0-9_]{3,30}"
        defaultValue={username}
        className="w-40 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-zinc-800"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-gray-300 px-3 py-1 dark:border-gray-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error && <span className="text-red-500">{state.error}</span>}
      {state.success && <span className="text-green-600">{state.success}</span>}
    </form>
  );
}
