import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// A useSyncExternalStore subscribe that never fires — for reading a value
// that's only known client-side (localStorage, wall-clock date) without a
// setState-in-effect or an SSR hydration mismatch. The store's snapshot
// functions carry the actual behavior; this is just "don't resubscribe".
export const NOOP_SUBSCRIBE = () => () => {}
