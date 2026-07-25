"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Opens the side peek for a story by pushing `?story=<id>` onto the current
// URL — shared by every List-view row that can open one (StoryListRow, the
// Epics band's epic/child rows) so a future change to the peek's URL
// contract only has one call site to update.
export function useOpenPeek() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return function openPeek(id: string) {
    const params = new URLSearchParams(searchParams);
    params.set("story", id);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };
}
