"use client";

import { useActionState } from "react";
import { updateProfile, type UpdateProfileState } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProfileSettingsForm({
  username,
  displayName,
}: {
  username: string;
  displayName: string;
}) {
  const [state, formAction, pending] = useActionState<UpdateProfileState, FormData>(
    updateProfile,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-display-name">Display name</Label>
        <Input id="settings-display-name" name="display_name" required defaultValue={displayName} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="settings-username">Username</Label>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">@</span>
          <Input
            id="settings-username"
            name="username"
            required
            minLength={3}
            maxLength={30}
            pattern="[a-z0-9_]{3,30}"
            defaultValue={username}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
        {state.success && <span className="text-sm text-primary">{state.success}</span>}
      </div>
    </form>
  );
}
