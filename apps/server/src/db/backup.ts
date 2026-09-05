import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Db } from "./client";

/** Consistent single-file copy; safe while the WAL is live (unlike cp). */
export function vacuumInto(db: Db, targetPath: string): void {
  if (existsSync(targetPath)) throw new Error(`backup target already exists: ${targetPath}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  db.$client.run("VACUUM INTO ?", [targetPath]);
}
