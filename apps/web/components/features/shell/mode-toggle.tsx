"use client";

import { useSyncExternalStore } from "react";
import { Check, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { cn, NOOP_SUBSCRIBE } from "@/lib/utils";
import { PALETTES } from "@/lib/theme-config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// System isn't in PALETTES (app/layout.tsx passes that list to next-themes'
// `themes` prop as-is; next-themes appends "system" itself via enableSystem),
// but it is a menu item here.
const THEMES = [...PALETTES, { value: "system", label: "System" }] as const;

// Theme picker for the app shell (TASK-235, doc-27): light, three dark
// palettes, and System (OS auto-follow — fable-advisor 2026-08-13: dropping
// it would remove OS-auto-follow with no replacement). Checked against
// `theme` (the literal selection, including the string "system"), not
// `resolvedTheme` (System's resolved light/dark) — otherwise System could
// never show its own checkmark. Only known after mount (next-themes reads
// localStorage client-side), so the checkmark waits for `mounted` rather than
// risking a hydration mismatch; the static trigger icon has no such state to
// guard.
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(NOOP_SUBSCRIBE, () => true, () => false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* size-11 below md: this sits in the sidebar's bottom row, which is
            touch-sized there, and size="icon" alone would leave a 32px target
            beside 44px ones (ux-principles §7). */}
        <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label="Change theme">
          <Palette />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEMES.map(({ value, label }) => {
          const checked = mounted && theme === value;
          return (
            <DropdownMenuItem
              key={value}
              onClick={() => setTheme(value)}
              role="menuitemradio"
              aria-checked={checked}
            >
              <Check className={cn("mr-1", checked ? "opacity-100" : "opacity-0")} />
              {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
