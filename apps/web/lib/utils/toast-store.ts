// Pure, framework-free store behind the shared toast (TASK-107, doc-11 D5).
// A module-level external store (not React state) so `toast()` can be called
// from anywhere — a server-action success handler, an event listener, a
// non-React module — without needing a hook or a provider in scope at the
// call site. <Toaster/> (toast.tsx) subscribes via useSyncExternalStore.

export type ToastItem = { id: number; message: string };

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Queues a toast for the mounted <Toaster/> to render. */
export function toast(message: string): void {
  toasts = [...toasts, { id: nextId++, message }];
  emit();
}

/** Removes one toast — called when its lifetime (Radix's duration/swipe) ends. */
export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): ToastItem[] {
  return toasts;
}
