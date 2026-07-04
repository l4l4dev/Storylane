import type { EpicProgress } from "@/lib/utils/epics";

export function EpicProgressBar({ progress, color }: { progress: EpicProgress; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${progress.percent}%`, backgroundColor: color }}
        />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {progress.accepted} / {progress.total} accepted
      </span>
    </div>
  );
}
