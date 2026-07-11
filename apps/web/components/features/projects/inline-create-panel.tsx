"use client";

import { useState } from "react";
import { createProject, type NewProjectInviteResult } from "@/app/dashboard/actions";
import { ITERATION_LENGTHS, POINT_SCALES, type FreeTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ModeComparisonCard } from "./mode-comparison-card";
import { NewProjectInvitePicker } from "./new-project-invite-picker";

// Inline panel (spec/screens.md "Projects page") that expands in place
// above the card grid — no route change, no dialog role.
export function InlineCreatePanel() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"tracker" | "free">("tracker");
  const [freeTemplate, setFreeTemplate] = useState<FreeTemplate>("kanbanflow");
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

        <input type="hidden" name="workflow_mode" value={mode} />
        <div className="grid grid-cols-2 gap-3">
          <ModeComparisonCard
            mode="tracker"
            title="Tracker"
            description="Fixed story states, iterations, and velocity"
            selected={mode === "tracker"}
            onSelect={() => setMode("tracker")}
          />
          <ModeComparisonCard
            mode="free"
            title="Free"
            description="Trello-style board with your own columns — no iterations"
            selected={mode === "free"}
            onSelect={() => setMode("free")}
          />
        </div>

        {mode === "tracker" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-iteration-length">Iteration length (days)</Label>
              <NativeSelect id="project-iteration-length" name="iteration_length" defaultValue={14}>
                {ITERATION_LENGTHS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project-velocity-window">Velocity window</Label>
              <Input
                id="project-velocity-window"
                name="velocity_window"
                type="number"
                min={1}
                defaultValue={3}
              />
            </div>
          </>
        )}

        {mode === "free" && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Column template</legend>
            <input type="hidden" name="free_template" value={freeTemplate} />
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  checked={freeTemplate === "kanbanflow"}
                  onChange={() => setFreeTemplate("kanbanflow")}
                  className="mt-1"
                />
                <span>
                  KanbanFlow
                  <span className="block text-xs text-muted-foreground">
                    Todo · This week · Today · In progress · Done
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  checked={freeTemplate === "basic"}
                  onChange={() => setFreeTemplate("basic")}
                  className="mt-1"
                />
                <span>
                  Basic
                  <span className="block text-xs text-muted-foreground">To do · Doing · Done</span>
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Columns can be edited afterwards in Settings.</p>
          </fieldset>
        )}

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
