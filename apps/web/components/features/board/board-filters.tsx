"use client";

import { Filter } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STORY_TYPES } from "@/lib/utils/stories";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Option = { id: string; name: string };

// Filters live in a popover because eight always-visible controls compete in one row.
//
// Popover, not DropdownMenu (fable-advisor review): Radix's DropdownMenu
// Content has role="menu" and its own keydown handler unconditionally
// preventDefaults Tab (@radix-ui/react-menu dist/index.mjs — menus are
// built for menuitem children navigated by arrow keys, not a Tab sequence
// through arbitrary form controls), so a keyboard user could open the menu
// but never Tab from the Type select to Assignee/Label/Epic. Popover has no
// such interception and is non-modal by default (unlike DropdownMenu's
// modal=true), so it doesn't scroll-lock/aria-hide the board behind it
// while a member is filtering what they can see.
export function BoardFilters({
  assignees,
  labels,
  epics,
}: {
  assignees: Option[];
  labels: Option[];
  epics: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  const type = searchParams.get("type") ?? "";
  const assignee = searchParams.get("assignee") ?? "";
  const label = searchParams.get("label") ?? "";
  const epic = searchParams.get("epic") ?? "";
  const activeCount = [type, assignee, label, epic].filter(Boolean).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Filter />
          Filters
          {activeCount > 0 && <span className="text-xs text-muted-foreground">· {activeCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="board-filter-type" className="text-xs text-muted-foreground">
            Type
          </Label>
          <NativeSelect
            id="board-filter-type"
            aria-label="Filter by type"
            value={type}
            onChange={(e) => setParam("type", e.target.value)}
            className="h-8 w-full"
          >
            <option value="">All types</option>
            {STORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="board-filter-assignee" className="text-xs text-muted-foreground">
            Assignee
          </Label>
          <NativeSelect
            id="board-filter-assignee"
            aria-label="Filter by assignee"
            value={assignee}
            onChange={(e) => setParam("assignee", e.target.value)}
            className="h-8 w-full"
          >
            <option value="">All assignees</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="board-filter-label" className="text-xs text-muted-foreground">
            Label
          </Label>
          <NativeSelect
            id="board-filter-label"
            aria-label="Filter by label"
            value={label}
            onChange={(e) => setParam("label", e.target.value)}
            className="h-8 w-full"
          >
            <option value="">All labels</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="board-filter-epic" className="text-xs text-muted-foreground">
            Epic
          </Label>
          <NativeSelect
            id="board-filter-epic"
            aria-label="Filter by epic"
            value={epic}
            onChange={(e) => setParam("epic", e.target.value)}
            className="h-8 w-full"
          >
            <option value="">All epics</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </PopoverContent>
    </Popover>
  );
}
