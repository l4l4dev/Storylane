import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// TASK-206: reference only — never blocks the transition it sits next to.
// Shared by TransitionButtons (button-click path) and KanbanColumn's header
// (drag path, which has no button to attach to) — the two done-category
// entry points named in spec/features.md "Transitions".
export function DefinitionOfDonePopover({ text }: { text: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Definition of Done"
          title="Definition of Done"
        >
          <Info className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 whitespace-pre-wrap text-sm">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">Definition of Done</p>
        {text}
      </PopoverContent>
    </Popover>
  );
}
