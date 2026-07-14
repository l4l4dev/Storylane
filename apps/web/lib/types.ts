import type { Database } from "@/lib/database.types";

type Tables = Database["public"]["Tables"];

export type Project = Tables["projects"]["Row"];
export type ProjectMember = Tables["project_members"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type Story = Tables["stories"]["Row"];
export type Epic = Tables["epics"]["Row"];
export type Label = Tables["labels"]["Row"];
export type Iteration = Tables["iterations"]["Row"];

export type ProjectRole = "owner" | "member" | "viewer";
export type PointScale = "fibonacci" | "linear" | "custom";

export const ITERATION_LENGTHS = [7, 14, 21, 28] as const;
export const POINT_SCALES: PointScale[] = ["fibonacci", "linear", "custom"];

// Free-mode column templates offered at project creation.
export const FREE_TEMPLATES = ["daily", "basic"] as const;
export type FreeTemplate = (typeof FREE_TEMPLATES)[number];
