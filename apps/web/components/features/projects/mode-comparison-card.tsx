"use client";

import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// TASK-7 (spec/screens.md "Projects page"): mode is chosen via
// comparison cards, not radio buttons, so the Tracker/Free difference is
// visible at a glance.
export function ModeComparisonCard({
  mode,
  title,
  description,
  selected,
  onSelect,
}: {
  mode: "tracker" | "free";
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      data-mode={mode}
      className={cn(
        "cursor-pointer transition-colors hover:ring-ring/50",
        selected && "ring-2 ring-primary",
      )}
    >
      <CardContent>
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className="flex w-full flex-col items-start gap-1 text-left"
        >
          <CardTitle>{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{description}</p>
        </button>
      </CardContent>
    </Card>
  );
}
