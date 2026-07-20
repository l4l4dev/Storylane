"use client";

import { useActionState } from "react";
import { X } from "lucide-react";
import {
  createCalendarException,
  deleteCalendarException,
  updateWorkingWeekdays,
  type CalendarExceptionState,
  type WorkingWeekdaysState,
} from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/utils/format";

// ISO weekday numbers (1=Mon .. 7=Sun), matching projects.working_weekdays.
const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

const KIND_LABELS = {
  holiday: "Holiday",
  extra_workday: "Extra workday",
} as const;

export type CalendarException = {
  id: string;
  date: string;
  kind: "holiday" | "extra_workday";
};

/**
 * Two permission surfaces, not one: the weekday default lives on `projects`
 * (owner-only UPDATE RLS, like every other field in the Details form), while
 * date exceptions are their own table with owner+member write (spec/rls.md).
 */
export function WorkingDaysSettings({
  projectId,
  workingWeekdays,
  exceptions,
  canEditWeekdays,
  canManageExceptions,
}: {
  projectId: string;
  workingWeekdays: number[];
  exceptions: CalendarException[];
  canEditWeekdays: boolean;
  canManageExceptions: boolean;
}) {
  const [state, addException, pending] = useActionState<CalendarExceptionState, FormData>(
    createCalendarException,
    {},
  );
  const [weekdayState, saveWeekdays, savingWeekdays] = useActionState<
    WorkingWeekdaysState,
    FormData
  >(updateWorkingWeekdays, {});

  const selectedWeekdays = WEEKDAYS.filter((day) => workingWeekdays.includes(day.value));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Used for planning capacity only. Iteration start and end dates are not affected.
      </p>

      {canEditWeekdays ? (
        <form action={saveWeekdays} className="flex flex-col gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <Label>Working days</Label>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((day) => (
              <label
                key={day.value}
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <input
                  type="checkbox"
                  name="weekday"
                  value={day.value}
                  defaultChecked={workingWeekdays.includes(day.value)}
                  className="size-4 accent-primary"
                />
                {day.label}
              </label>
            ))}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <Button type="submit" variant="outline" size="sm" disabled={savingWeekdays}>
              {savingWeekdays ? "Saving…" : "Save working days"}
            </Button>
            {weekdayState.error && (
              <span className="text-sm text-destructive">{weekdayState.error}</span>
            )}
            {weekdayState.success && (
              <span className="text-sm text-primary">{weekdayState.success}</span>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>Working days</Label>
          <p className="text-sm text-muted-foreground">
            {selectedWeekdays.length > 0
              ? selectedWeekdays.map((day) => day.label).join(", ")
              : "None set."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Label>Date exceptions</Label>
        <ul className="flex flex-col gap-1">
          {exceptions.map((exception) => (
            <li key={exception.id} className="flex items-center gap-2 text-sm">
              <span className="tabular-nums">{formatDate(exception.date)}</span>
              <span className="text-muted-foreground">{KIND_LABELS[exception.kind]}</span>
              {canManageExceptions && (
                <form action={deleteCalendarException} className="flex">
                  <input type="hidden" name="exception_id" value={exception.id} />
                  <input type="hidden" name="project_id" value={projectId} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${formatDate(exception.date)} exception`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X />
                  </Button>
                </form>
              )}
            </li>
          ))}
          {exceptions.length === 0 && (
            <li className="text-sm text-muted-foreground">No exceptions.</li>
          )}
        </ul>

        {canManageExceptions && (
          <form action={addException} className="flex items-end gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-exception-date">Date</Label>
              <Input id="new-exception-date" name="date" type="date" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-exception-kind">Kind</Label>
              <NativeSelect id="new-exception-kind" name="kind" defaultValue="holiday">
                <option value="holiday">Holiday</option>
                <option value="extra_workday">Extra workday</option>
              </NativeSelect>
            </div>
            <Button type="submit" variant="outline" disabled={pending}>
              Add
            </Button>
          </form>
        )}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      </div>
    </div>
  );
}
