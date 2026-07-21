"use client";

import { useSyncExternalStore } from "react";
import { Toast as ToastPrimitive } from "radix-ui";
import { dismissToast, getToasts, subscribeToasts } from "@/lib/utils/toast-store";

const EMPTY: never[] = [];

// Mounted once in the app shell (TASK-107, doc-11 D5). Renders whatever
// lib/utils/toast-store's `toast()` queues — any client component can call
// `toast("message")` directly (no per-form wiring, no provider needed at the
// call site) and it shows up here.
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, () => EMPTY);

  return (
    <ToastPrimitive.Provider duration={4000}>
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          data-slot="toast"
          onOpenChange={(open) => {
            if (!open) dismissToast(t.id);
          }}
          // Bracket syntax (matching Radix's real `data-state`/`data-swipe`
          // attributes) rather than this repo's dialog.tsx `data-open:`/
          // `data-closed:` shorthand — that shorthand (shadcn's
          // `@custom-variant data-open { &:where([data-open]...) }`) matches
          // a literal `data-open` attribute, which Radix never sets (it sets
          // `data-state="open"|"closed"`), so it never actually fires there.
          className="data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-full data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
        >
          <ToastPrimitive.Description data-slot="toast-description" className="flex-1">
            {t.message}
          </ToastPrimitive.Description>
          <ToastPrimitive.Close
            data-slot="toast-close"
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
          >
            ×
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 outline-none"
      />
    </ToastPrimitive.Provider>
  );
}
