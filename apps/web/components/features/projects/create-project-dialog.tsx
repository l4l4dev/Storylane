"use client";

import { useState } from "react";
import { createProject } from "@/app/dashboard/actions";
import { ITERATION_LENGTHS, POINT_SCALES } from "@/lib/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  // Radix Select is controlled, so mirror its value into a hidden input for
  // the server-action form to read from FormData.
  const [iterationLength, setIterationLength] = useState("14");
  const [pointScale, setPointScale] = useState("fibonacci");

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

          <div className="flex flex-col gap-1.5">
            <Label>Iteration length (days)</Label>
            <input type="hidden" name="iteration_length" value={iterationLength} />
            <Select value={iterationLength} onValueChange={setIterationLength}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITERATION_LENGTHS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Point scale</Label>
            <input type="hidden" name="point_scale" value={pointScale} />
            <Select value={pointScale} onValueChange={setPointScale}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POINT_SCALES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
