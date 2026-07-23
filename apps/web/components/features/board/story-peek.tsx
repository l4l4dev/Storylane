"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Maximize2, X } from "lucide-react";
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
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

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
      // in-progress conversion. A title/description field's own
      // Escape handler additionally calls stopPropagation to revert just
      // the field without reaching this listener at all.
      if (event.key === "Escape" && !event.isComposing) {
        close();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  useEffect(() => {
    const activeElement = document.activeElement;
    const panel = panelRef.current;
    returnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    panel?.focus({ preventScroll: true });

    return () => {
      const activeElementAtClose = document.activeElement;
      if (
        returnFocusRef.current?.isConnected &&
        (panel?.contains(activeElementAtClose) || activeElementAtClose === document.body)
      ) {
        returnFocusRef.current?.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [detail.id]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id={titleId} className="truncate text-sm font-semibold">
          <span className="mr-1.5 font-normal text-muted-foreground">#{detail.number}</span>
          {detail.title}
        </h2>
        <div className="flex items-center gap-1">
          {/* JIRA-style peek -> full page escalation (TASK-172): a plain
              navigation, not a peek-state change, so it lands on the same
              /stories/[id] a direct link would. */}
          <Button variant="ghost" size="icon-sm" asChild aria-label="Expand to full view">
            <Link href={`/stories/${detail.id}`}>
              <Maximize2 />
            </Link>
          </Button>
          <StoryPeekMenu key={detail.id} detail={detail} />
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
