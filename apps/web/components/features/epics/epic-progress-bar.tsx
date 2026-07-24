import type { ContainerRollup } from "@storylane/core";

// Fixed per-category colors (doc-18 §5 "multicolor category breakdown") —
// distinct from a container's own `epic_color` (which is decorative/user-
// picked, shown elsewhere as the epic's identity, not its progress).
const CATEGORY_COLOR: Record<keyof ContainerRollup["breakdown"], string> = {
  done: "#22c55e",
  in_progress: "#3b82f6",
  rejected: "#ef4444",
  unstarted: "#a1a1aa",
  icebox: "#d4d4d8",
};

/**
 * A container's roll-up progress (doc-18 §5): a multicolor stacked bar of its
 * children's category breakdown, the done/total count, and the point total.
 * Rejected children show in their own color but never count toward "done" or
 * roll the headline to rejected (that's `rollup.headline`'s job, not this bar).
 */
export function EpicProgressBar({ rollup, color }: { rollup: ContainerRollup; color: string }) {
  const { breakdown } = rollup;
  const total =
    breakdown.done + breakdown.in_progress + breakdown.unstarted + breakdown.rejected + breakdown.icebox;
  const percent = total === 0 ? 0 : Math.round((breakdown.done / total) * 100);

  const segments = (Object.keys(breakdown) as Array<keyof ContainerRollup["breakdown"]>)
    .filter((category) => breakdown[category] > 0)
    .map((category) => ({ category, count: breakdown[category] }));

  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <div
        className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {segments.map(({ category, count }) => (
          <div
            key={category}
            className="h-full transition-[width]"
            style={{ width: `${(count / total) * 100}%`, backgroundColor: CATEGORY_COLOR[category] }}
          />
        ))}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {breakdown.done} / {total} done
      </span>
      {breakdown.rejected > 0 && (
        <span className="shrink-0 text-xs" style={{ color: CATEGORY_COLOR.rejected }}>
          {breakdown.rejected} rejected
        </span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">{rollup.points} pts</span>
    </div>
  );
}
