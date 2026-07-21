"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "@/lib/utils/toast-store";

const RESHAPE_NOTE_MESSAGE: Record<string, string> = {
  already_finished: "Project updated — the current iteration had already finished, so its length wasn't changed.",
  would_end_in_past: "Project updated — the current iteration wasn't reshaped (it would have ended in the past).",
  too_long: "Project updated — the current iteration wasn't reshaped (the new length would run longer than 90 days).",
};

// Fires the save-confirmation toast after updateProject's redirect (TASK-107,
// doc-11 D5) — the invite_failed pattern (board/page.tsx: redirect with a
// query param, read it server-side) adapted for a toast: a toast is
// inherently client-only and ephemeral, so nothing can render it straight
// from searchParams the way InviteFailedBanner does. Renders nothing itself.
export function SettingsSaveToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const updated = searchParams.get("updated");
  const reshapeNote = searchParams.get("reshape_note");

  useEffect(() => {
    if (updated !== "1") {
      return;
    }
    toast(RESHAPE_NOTE_MESSAGE[reshapeNote ?? ""] ?? "Project updated");
    // Strips the params so a manual refresh doesn't re-fire the toast.
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updated, reshapeNote]);

  return null;
}
