"use client";

import { useState } from "react";
import { createProject, type NewProjectInviteResult } from "@/app/dashboard/actions";
import { ITERATION_LENGTHS, POINT_SCALES, STATE_TEMPLATES, iterationLengthLabel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { NewProjectInvitePicker } from "./new-project-invite-picker";

// classic = the Pivotal-parity anchor (6 states matching the pre-redesign
// fixed Kanban exactly); minimal = a 3-state Todo/Doing/Done board
// (spec/data-model.md "Default templates").
const TEMPLATE_LABELS: Record<(typeof STATE_TEMPLATES)[number], string> = {
  classic: "Classic (Unstarted → Started → Finished → Delivered → Accepted / Rejected)",
  minimal: "Minimal (Todo → Doing → Done)",
};

// Inline panel (spec/screens.md "Projects page") that expands in place
// above the card grid — no route change, no dialog role.
export function InlineCreatePanel() {
  const [open, setOpen] = useState(false);
  const [invitees, setInvitees] = useState<NewProjectInviteResult[]>([]);

  async function handleCreate(formData: FormData) {
    await createProject(formData);
    setOpen(false);
    setInvitees([]);
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        New project
      </Button>
    );
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <form action={handleCreate} className="flex flex-col gap-4">
        {invitees.map((user) => (
          <input key={user.id} type="hidden" name="invited_user_ids" value={user.id} />
        ))}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-name">Name</Label>
          <Input id="project-name" name="name" required autoFocus />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-description">Description</Label>
          <Textarea id="project-description" name="description" rows={2} />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="project-iteration-term">What you call an iteration</Label>
            <Input id="project-iteration-term" name="iteration_term" maxLength={30} placeholder="Iteration" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="project-iteration-length">Length</Label>
            <NativeSelect id="project-iteration-length" name="iteration_length" defaultValue={14}>
              {ITERATION_LENGTHS.map((d) => (
                <option key={d} value={d}>
                  {iterationLengthLabel(d)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-velocity-window">Velocity window</Label>
          <Input id="project-velocity-window" name="velocity_window" type="number" min={1} defaultValue={3} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-point-scale">Point scale</Label>
          <NativeSelect id="project-point-scale" name="point_scale" defaultValue="fibonacci">
            {POINT_SCALES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="project-state-template">Board template</Label>
          <NativeSelect id="project-state-template" name="state_template" defaultValue="classic">
            {STATE_TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {TEMPLATE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            Customizable later in Settings → States.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Invite members (optional)</Label>
          <NewProjectInvitePicker selected={invitees} onChange={setInvitees} />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit">Create</Button>
        </div>
      </form>
    </div>
  );
}
