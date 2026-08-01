import { formatDate } from "@/lib/utils/format";
import type { BurndownPoint } from "@/lib/utils/burndown";

const WIDTH = 600;
const HEIGHT = 160;
const PAD = 20;

export function BurndownChart({
  coverage,
  points,
}: {
  coverage: "full" | "partial" | "none";
  points: ReadonlyArray<BurndownPoint>;
}) {
  if (points.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        This burndown cannot be reconstructed because no state-change history is available.
      </p>
    );
  }

  const max = Math.max(1, ...points.flatMap((point) => [point.remaining, point.ideal]));
  const x = (index: number) => PAD + (index * (WIDTH - PAD * 2)) / Math.max(1, points.length - 1);
  const y = (value: number) => HEIGHT - PAD - (value / max) * (HEIGHT - PAD * 2);
  const line = (value: "remaining" | "ideal") =>
    points.map((point, index) => `${x(index)},${y(point[value])}`).join(" ");
  const latest = points.at(-1)!;

  return (
    <figure className="mb-3 rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <figcaption className="font-medium">Burndown</figcaption>
        <div className="flex items-center gap-3 text-muted-foreground">
          <span><span className="mr-1 inline-block h-0.5 w-3 bg-primary align-middle" />Remaining</span>
          <span><span className="mr-1 inline-block w-3 border-t border-dashed border-muted-foreground align-middle" />Ideal pace</span>
        </div>
      </div>
      <svg
        className="h-auto w-full text-muted-foreground"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Burndown through ${formatDate(latest.date)}: remaining ${latest.remaining} points; ideal pace ${Number(latest.ideal.toFixed(1))} points.`}
      >
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} stroke="currentColor" opacity="0.25" />
        <polyline points={line("ideal")} fill="none" stroke="currentColor" strokeDasharray="6 5" />
        <polyline points={line("remaining")} fill="none" className="stroke-primary" strokeWidth="2.5" />
        {/* A single-point series (day one of a current iteration, or any
            supported one-day iteration) has nothing for polyline to connect
            — it paints no visible pixel. Circle markers cover that case, but
            day one is exactly where ideal and remaining often coincide (both
            equal the full target) — an unfilled ring plus a smaller filled
            dot stay distinguishable even stacked at the same point, unlike
            two solid circles where the larger one fully hides the other. */}
        {points.length === 1 && (
          <>
            <circle cx={x(0)} cy={y(points[0].ideal)} r="5" fill="none" stroke="currentColor" strokeDasharray="3 2" />
            <circle cx={x(0)} cy={y(points[0].remaining)} r="3" className="fill-primary" />
          </>
        )}
        <text x={PAD} y={HEIGHT - 3} fill="currentColor" fontSize="10">{formatDate(points[0].date)}</text>
        {points.length > 1 && (
          <text x={WIDTH - PAD} y={HEIGHT - 3} fill="currentColor" fontSize="10" textAnchor="end">{formatDate(latest.date)}</text>
        )}
        <text x={PAD} y={12} fill="currentColor" fontSize="10">{max} pts</text>
      </svg>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Daily values</summary>
        <table className="mt-2 w-full text-right">
          <thead><tr><th className="text-left font-medium">Date</th><th className="font-medium">Remaining</th><th className="font-medium">Ideal</th></tr></thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date}>
                <td className="text-left">{formatDate(point.date)}</td>
                <td>{point.remaining}</td>
                <td>{Number(point.ideal.toFixed(1))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {coverage === "partial" && (
        <p className="mt-1 text-xs text-muted-foreground">
          Partial history — some changes in this range could not be reconstructed.
        </p>
      )}
    </figure>
  );
}
