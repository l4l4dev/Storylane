import type { KeyboardEvent } from "react";

// IME composition (e.g. converting Japanese input) also fires Escape (to
// cancel the candidate window) and Enter (to commit it) — an inline
// editor's own Escape-cancel / Enter-submit handling must ignore those,
// or accepting a conversion closes the editor and destroys the typed text
// (spec/ux-principles.md principle 2). Established by
// story-detail-panel.tsx, extracted here so every inline editor shares it.
export function isImeComposing(event: KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing;
}
