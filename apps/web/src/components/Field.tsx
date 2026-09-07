import type { ReactNode } from "react";

/**
 * One labelled control. The error slot always occupies its line so a message cannot shift the
 * layout under the pointer (spec/ux-principles.md principle 3).
 */
export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      <span className="min-h-4 text-xs" style={{ color: error ? "var(--danger)" : "var(--ink-muted)" }}>
        {error ?? hint ?? ""}
      </span>
    </label>
  );
}

export const inputClass =
  "rounded border px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

export const buttonClass =
  "rounded border px-3 py-1.5 text-sm font-medium hover:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";
