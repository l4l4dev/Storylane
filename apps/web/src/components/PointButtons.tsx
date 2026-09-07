import { buttonClass } from "./Field";

/**
 * A row of buttons for the project's point scale — never a free numeric input, so a story can
 * only ever carry a value the project's scale actually offers (spec/features.md "Story
 * Management"). Shared by the card's estimate control and quick-add.
 */
export function PointButtons({
  scaleValues,
  value,
  onSelect,
}: {
  scaleValues: number[];
  value: number | null;
  onSelect: (points: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Points">
      {scaleValues.map((points) => (
        <button
          key={points}
          type="button"
          aria-pressed={value === points}
          className={buttonClass}
          style={{
            borderColor: "var(--line)",
            background: value === points ? "var(--surface-2)" : undefined,
          }}
          onClick={() => onSelect(points)}
        >
          {points}
        </button>
      ))}
    </div>
  );
}
