import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Db } from "./client";

/**
 * Consistent single-file copy; safe while the WAL is live (unlike cp).
 *
 * Writes to `<targetPath>.tmp` and renames on success, so an interrupted VACUUM
 * (disk full, kill) never leaves a partial file at `targetPath` that a later
 * boot would mistake for a complete backup.
 */
export function vacuumInto(db: Db, targetPath: string): void {
  if (existsSync(targetPath)) throw new Error(`backup target already exists: ${targetPath}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp`;
  rmSync(tmpPath, { force: true });
  try {
    db.$client.run("VACUUM INTO ?", [tmpPath]);
    renameSync(tmpPath, targetPath);
  } catch (e) {
    rmSync(tmpPath, { force: true });
    throw e;
  }
}
