"use client";

import { useActionState } from "react";
import { X } from "lucide-react";
import { addTimeOff, removeTimeOff, type TimeOffState } from "@/app/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils/format";

export function TimeOffSettings({ dates }: { dates: string[] }) {
  const [state, formAction, pending] = useActionState<TimeOffState, FormData>(addTimeOff, {});

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Applies to every project you work on. Members of your projects can see these dates so
        planning capacity stays accurate.
      </p>

      <ul className="flex flex-col gap-1">
        {dates.map((date) => (
          <li key={date} className="flex items-center gap-2 text-sm">
            <span className="tabular-nums">{formatDate(date)}</span>
            <form action={removeTimeOff} className="flex">
              <input type="hidden" name="date" value={date} />
              <Button
                type="submit"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove time off on ${formatDate(date)}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X />
              </Button>
            </form>
          </li>
        ))}
        {dates.length === 0 && <li className="text-sm text-muted-foreground">No time off booked.</li>}
      </ul>

      <form action={formAction} className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-time-off-date">Date</Label>
          <Input id="new-time-off-date" name="date" type="date" required />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Add
        </Button>
      </form>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
