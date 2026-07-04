"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, LogOut } from "lucide-react";
import { signOut } from "@/app/dashboard/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "./mode-toggle";

export type ProjectRef = { id: string; name: string };

// Persistent app shell header (spec/screens.md "Navigation"): brand,
// project switcher, section tabs, theme toggle, and account menu. Rendered
// once by the project layout so every project page shares one navigation
// surface instead of re-declaring link rows per page.
export function AppHeader({
  project,
  projects,
  username,
}: {
  project: ProjectRef;
  projects: ProjectRef[];
  username: string | null;
}) {
  const pathname = usePathname();
  const base = `/projects/${project.id}`;

  const tabs = [
    // The board is the project's home view — pathname === base covers the
    // instant before the /board redirect resolves, so the tab doesn't flash
    // inactive.
    { label: "Board", href: `${base}/board`, active: pathname === base || pathname.startsWith(`${base}/board`) },
    { label: "Epics", href: `${base}/epics`, active: pathname.startsWith(`${base}/epics`) },
    { label: "Activity", href: `${base}/activity`, active: pathname.startsWith(`${base}/activity`) },
    { label: "Settings", href: `${base}/settings`, active: pathname.startsWith(`${base}/settings`) },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-[100rem] items-center gap-2 px-6">
        <Link href="/dashboard" className="mr-1 font-semibold tracking-tight">
          Storylane
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <span className="max-w-40 truncate">{project.name}</span>
              <ChevronsUpDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} asChild>
                <Link href={`/projects/${p.id}`}>
                  <Check
                    className={cn("mr-1", p.id === project.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{p.name}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard">All projects</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <nav className="ml-2 flex items-center gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab.active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ModeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                @{username ?? "account"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
