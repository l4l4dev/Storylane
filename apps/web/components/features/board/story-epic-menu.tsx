"use client";

import { useState, useTransition } from "react";
import { MoreVertical } from "lucide-react";
import { setStoryParent } from "@/app/projects/[id]/board/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * "Remove from epic" on a story row (doc-20 §5): detaching is a menu action,
 * never a drag, in v1. The Parent picker's "None" in the story detail is the
 * other path. Rendered only for a story that HAS an epic — a menu whose one
 * item never applies would be a control that explains nothing
 * (ux-principles principle 1).
 */
export function StoryEpicMenu({
  storyId,
  projectId,
  epicTitle,
  onError,
}: {
  storyId: string;
  projectId: string;
  epicTitle: string;
  onError?: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function detach() {
    startTransition(async () => {
      const result = await setStoryParent({ storyId, projectId, parentId: null });
      if (!result.ok) {
        onError?.(result.message);
      }
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Epic actions for this story (in ${epicTitle})`}
          disabled={pending}
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={detach}>Remove from epic</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
