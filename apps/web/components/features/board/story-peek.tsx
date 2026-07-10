"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import type { StoryDetail } from "@/app/stories/[id]/actions";
import { StoryDetailPanel } from "@/components/features/story/story-detail-panel";
import { StoryPeekMenu } from "@/components/features/story/story-peek-menu";
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
      // isComposing guards IME candidate-window cancellation (e.g. Japanese
      // input) — that Escape must never close the peek out from under an
      // in-progress conversion (Task 12). A title/description field's own
      // Escape handler additionally calls stopPropagation to revert just
      // the field without reaching this listener at all.
      if (event.key === "Escape" && !event.isComposing) {
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
        <div className="flex items-center gap-1">
          <StoryPeekMenu detail={detail} />
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close story detail">
            <X />
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <StoryDetailPanel detail={detail} />
      </div>
    </aside>
  );
}
