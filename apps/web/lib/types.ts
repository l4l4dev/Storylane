import type { Database } from "@/lib/database.types";
import type { StateCategory } from "@storylane/core";

type Tables = Database["public"]["Tables"];

export type Project = Tables["projects"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type Story = Tables["stories"]["Row"];
export type Epic = Tables["epics"]["Row"];
export type Label = Tables["labels"]["Row"];
export type Iteration = Tables["iterations"]["Row"];
// `category` is a generic `string` in the generated Row type (the DB CHECK
// constraint isn't reflected in codegen) — narrowed to the real union here,
// the single place every consumer imports this table's shape from.
export type ProjectState = Omit<Tables["project_states"]["Row"], "category"> & { category: StateCategory };

export type InviteSearchResult = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string };

export type PointScale = "fibonacci" | "linear" | "custom";

// 1 is a real cadence (doc-8 §3): a one-day iteration lands on a working day
// and covers the non-working days after it, so nothing falls between sprints.
export const ITERATION_LENGTHS = [1, 7, 14, 21, 28] as const;

/** Cadence option label (spec/screens.md "1 day / 1w / 2w / 3w / 4w"). */
export function iterationLengthLabel(days: number): string {
  if (days === 1) {
    return "1 day";
  }
  const weeks = days / 7;
  return Number.isInteger(weeks) ? `${weeks} week${weeks === 1 ? "" : "s"}` : `${days} days`;
}

export const POINT_SCALES: PointScale[] = ["fibonacci", "linear", "custom"];
export const STATE_TEMPLATES = ["classic", "minimal"] as const;
export type StateTemplate = (typeof STATE_TEMPLATES)[number];
