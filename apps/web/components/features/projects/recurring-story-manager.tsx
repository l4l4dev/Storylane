"use client";

import { useState } from "react";
import { createRecurringStory, deleteRecurringStory, updateRecurringStory } from "@/app/projects/[id]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export type RecurringStoryRow = {
  id: string;
  title: string;
  description: string | null;
  custom_status_id: string | null;
  swimlane_id: string | null;
  cadence: "daily" | "weekly" | "monthly";
  weekday: number | null;
  day_of_month: number | null;
  is_active: boolean;
};

type TargetOption = { id: string; name: string };

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

// Title/description/target column/target lane/cadence, matching
// spec/screens.md "Recurring stories" — target column excludes is_done
// columns (spec/data-model.md "a card must not be born completed"), and the
// weekday/day-of-month input swaps in only for the cadence that needs it.
function RuleForm({
  projectId,
  statuses,
  lanes,
  rule,
  action,
  submitLabel,
}: {
  projectId: string;
  statuses: TargetOption[];
  lanes: TargetOption[];
  rule?: RecurringStoryRow;
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
}) {
  const [cadence, setCadence] = useState<RecurringStoryRow["cadence"]>(rule?.cadence ?? "daily");

  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <input type="hidden" name="project_id" value={projectId} />
      {rule && <input type="hidden" name="rule_id" value={rule.id} />}
      <Input name="title" placeholder="Story title" defaultValue={rule?.title} required className="h-8" />
      <Textarea
        name="description"
        placeholder="Description (optional)"
        defaultValue={rule?.description ?? ""}
        rows={2}
      />
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          name="custom_status_id"
          defaultValue={rule?.custom_status_id ?? ""}
          className="h-8 w-40"
          aria-label="Target column"
        >
          <option value="">Leftmost column</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="swimlane_id"
          defaultValue={rule?.swimlane_id ?? ""}
          className="h-8 w-32"
          aria-label="Target lane"
        >
          <option value="">No lane</option>
          {lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          name="cadence"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as RecurringStoryRow["cadence"])}
          className="h-8 w-28"
          aria-label="Cadence"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </NativeSelect>
        {cadence === "weekly" && (
          <NativeSelect name="weekday" defaultValue={rule?.weekday ?? 1} className="h-8 w-32" aria-label="Weekday">
            {WEEKDAYS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </NativeSelect>
        )}
        {cadence === "monthly" && (
          <Input
            type="number"
            name="day_of_month"
            min={1}
            max={31}
            defaultValue={rule?.day_of_month ?? 1}
            className="h-8 w-20"
            aria-label="Day of month"
          />
        )}
        {rule && (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={rule.is_active} />
            Active
          </label>
        )}
        <Button type="submit" variant="outline" size="sm">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function RecurringStoryManager({
  projectId,
  rules,
  statuses,
  lanes,
  canEdit,
  canDelete,
}: {
  projectId: string;
  rules: RecurringStoryRow[];
  statuses: TargetOption[];
  lanes: TargetOption[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-start gap-2">
          <div className="flex-1">
            {canEdit ? (
              <RuleForm
                projectId={projectId}
                statuses={statuses}
                lanes={lanes}
                rule={rule}
                action={updateRecurringStory}
                submitLabel="Save"
              />
            ) : (
              <p className="text-sm">{rule.title}</p>
            )}
          </div>
          {canDelete && (
            <form action={deleteRecurringStory}>
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="rule_id" value={rule.id} />
              <Button type="submit" variant="destructive" size="sm">
                Delete
              </Button>
            </form>
          )}
        </div>
      ))}

      {canEdit && (
        <RuleForm projectId={projectId} statuses={statuses} lanes={lanes} action={createRecurringStory} submitLabel="Add" />
      )}
    </div>
  );
}
