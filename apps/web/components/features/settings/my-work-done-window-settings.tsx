"use client";

import { useActionState } from "react";
import { updateMyWorkDoneWindow, type MyWorkDoneWindowState } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MyWorkDoneWindowSettings({ days }: { days: number }) {
  const [state, formAction, pending] = useActionState<MyWorkDoneWindowState, FormData>(updateMyWorkDoneWindow, {});

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        How many days My Work&apos;s Done column reaches back. Older completions move to the archive.
      </p>

      <form action={formAction} className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="done-window-days">Days</Label>
          <Input id="done-window-days" name="done_window_days" type="number" min={1} max={90} defaultValue={days} required />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Save
        </Button>
      </form>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && <p className="text-sm text-muted-foreground">{state.success}</p>}
    </div>
  );
}
