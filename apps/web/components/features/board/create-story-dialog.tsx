"use client";

import { useState } from "react";
import { createStory } from "@/app/projects/[id]/board/actions";
import { STORY_TYPES, storyTypeUsesPoints } from "@/lib/utils/stories";
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

type Option = { id: string; name: string };

export function CreateStoryDialog({
  projectId,
  pointScale,
  epics,
  labels,
  members,
}: {
  projectId: string;
  pointScale: number[];
  epics: Option[];
  labels: Option[];
  members: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [storyType, setStoryType] = useState<string>("feature");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full">
          New story
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New story</DialogTitle>
        </DialogHeader>

        <form
          action={createStory}
          onSubmit={() => setOpen(false)}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="project_id" value={projectId} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="story-title">Title</Label>
            <Input id="story-title" name="title" required autoFocus />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="story-description">Description</Label>
            <Textarea id="story-description" name="description" rows={2} />
          </div>

          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="story-type">Type</Label>
              <NativeSelect
                id="story-type"
                name="story_type"
                value={storyType}
                onChange={(e) => setStoryType(e.target.value)}
              >
                {STORY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex w-32 flex-col gap-1.5">
              <Label htmlFor="story-points">Points</Label>
              {/* Points come from the project's point scale — no free
                  numeric input (see spec/features.md). */}
              <NativeSelect
                id="story-points"
                name="points"
                disabled={!storyTypeUsesPoints(storyType)}
              >
                <option value="">{storyTypeUsesPoints(storyType) ? "Unestimated" : "—"}</option>
                {pointScale.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="story-epic">Epic</Label>
              <NativeSelect id="story-epic" name="epic_id">
                <option value="">None</option>
                {epics.map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="story-assignee">Assignee</Label>
              <NativeSelect id="story-assignee" name="assignee_id">
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {labels.length > 0 && (
            <fieldset className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Labels</span>
              <div className="flex flex-wrap gap-2">
                {labels.map((label) => (
                  <label key={label.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="label_ids" value={label.id} className="accent-primary" />
                    {label.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

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
