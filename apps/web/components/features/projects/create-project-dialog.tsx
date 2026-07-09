"use client";

import { useState } from "react";
import { createProject } from "@/app/dashboard/actions";
import { ITERATION_LENGTHS, POINT_SCALES, type FreeTemplate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  // Task 14: chosen at creation and fixed afterwards — tracker keeps the
  // iteration/velocity workflow, free is a plain Trello-style board.
  const [mode, setMode] = useState<"tracker" | "free">("tracker");
  // TASK-16.1: which custom_statuses set a free-mode project is seeded
  // with — only asked when Free is selected, has no effect on tracker mode.
  const [freeTemplate, setFreeTemplate] = useState<FreeTemplate>("kanbanflow");

  async function handleCreate(formData: FormData) {
    await createProject(formData);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>

        <form action={handleCreate} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" name="name" required autoFocus />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Textarea id="project-description" name="description" rows={2} />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Workflow</legend>
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="workflow_mode"
                  value="tracker"
                  checked={mode === "tracker"}
                  onChange={() => setMode("tracker")}
                  className="mt-1"
                />
                <span>
                  Tracker
                  <span className="block text-xs text-muted-foreground">
                    Fixed story states, iterations, and velocity
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="workflow_mode"
                  value="free"
                  checked={mode === "free"}
                  onChange={() => setMode("free")}
                  className="mt-1"
                />
                <span>
                  Free
                  <span className="block text-xs text-muted-foreground">
                    Trello-style board with your own columns — no iterations
                  </span>
                </span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">The workflow can&apos;t be changed after creation.</p>
          </fieldset>

          {mode === "tracker" && (
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
