"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Check,
  ChevronsUpDown,
  History,
  Layers,
  LogOut,
  Settings,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
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

type NavItem = { label: string; segment: string; icon: LucideIcon };

// Section nav, top to bottom (spec/screens.md "Navigation"). The board is
// the project's home view, so its item also matches the bare project path.
const NAV_ITEMS: NavItem[] = [
  { label: "Board", segment: "board", icon: SquareKanban },
  { label: "Epics", segment: "epics", icon: Layers },
  { label: "Iterations", segment: "iterations", icon: History },
  { label: "Activity", segment: "activity", icon: Activity },
  { label: "Settings", segment: "settings", icon: Settings },
];

// Persistent app shell sidebar (spec/screens.md "Navigation"): brand,
// project switcher, section nav, and at the bottom the theme toggle and
// account menu. Rendered once by the project layout so every project page
// shares one navigation surface.
export function AppSidebar({
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

  return (
    <aside className="sticky top-0 flex h-dvh w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex flex-col gap-2 p-3">
        <Link href="/dashboard" className="px-2 py-1 font-semibold tracking-tight">
          Storylane
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="w-full justify-between gap-1.5">
              <span className="truncate">{project.name}</span>
              <ChevronsUpDown className="shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} asChild>
                <Link href={`/projects/${p.id}`}>
                  <Check className={cn("mr-1", p.id === project.id ? "opacity-100" : "opacity-0")} />
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
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV_ITEMS.map((item) => {
          const href = `${base}/${item.segment}`;
          // pathname === base covers the instant before the /board redirect
          // resolves, so the Board item doesn't flash inactive.
          const active =
            pathname.startsWith(href) || (item.segment === "board" && pathname === base);
          const Icon = item.icon;
          return (
            <Link
              key={item.segment}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between gap-1 border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start text-muted-foreground">
              <span className="truncate">@{username ?? "account"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ModeToggle />
      </div>
    </aside>
  );
}
