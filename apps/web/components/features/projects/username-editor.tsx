"use client";

import { useActionState } from "react";
import { updateUsername, type UpdateUsernameState } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UsernameEditor({ username }: { username: string }) {
  const [state, formAction, pending] = useActionState<UpdateUsernameState, FormData>(
    updateUsername,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Username</span>
      <span className="text-muted-foreground">@</span>
      <Input
        name="username"
        required
        minLength={3}
        maxLength={30}
        pattern="[a-z0-9_]{3,30}"
        defaultValue={username}
        className="w-40"
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {state.error && <span className="text-destructive">{state.error}</span>}
      {state.success && <span className="text-primary">{state.success}</span>}
    </form>
  );
}
