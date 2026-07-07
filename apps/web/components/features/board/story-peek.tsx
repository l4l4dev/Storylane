"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryDetailPanel } from "@/components/features/story/story-detail-panel";
import { Button } from "@/components/ui/button";

// Side peek (spec/screens.md "Board layout"): the story detail slides in
// over the board's right edge, driven by `?story=<id>` on the board URL so
// it's shareable. The board stays visible and interactive — closing just
// strips the query param (other params like filters are preserved).
export function StoryPeek({ detail }: { detail: StoryDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("story");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <aside
      aria-label="Story detail"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="truncate text-sm font-semibold">
          <span className="mr-1.5 font-normal text-muted-foreground">#{detail.number}</span>
          {detail.title}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close story detail">
          <X />
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <StoryDetailPanel detail={detail} />
      </div>
    </aside>
  );
}
