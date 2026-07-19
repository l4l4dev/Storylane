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

export const ITERATION_LENGTHS = [7, 14, 21, 28] as const;
export const POINT_SCALES: PointScale[] = ["fibonacci", "linear", "custom"];
export const STATE_TEMPLATES = ["classic", "minimal"] as const;
export type StateTemplate = (typeof STATE_TEMPLATES)[number];
