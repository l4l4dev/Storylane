"use client";

import { useActionState } from "react";
import { inviteMember, type InviteState } from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export function InviteMemberForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(
    inviteMember,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="email"
          name="email"
          required
          placeholder="email@example.com"
          className="flex-1"
        />
        <NativeSelect name="role" defaultValue="member" className="w-auto">
          <option value="member">member</option>
          <option value="viewer">viewer</option>
          <option value="owner">owner</option>
        </NativeSelect>
        <Button type="submit" disabled={pending}>
          {pending ? "Inviting…" : "Invite"}
        </Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p className="text-sm text-primary">{state.success}</p>}
    </form>
  );
}
