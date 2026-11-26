import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

/** No DB access, no ProjectTx: pure filesystem. */
export interface AttachmentStore {
  /** Returns the path to record in file_attachments.storage_path, relative to the data dir. */
  put(projectId: string, attachmentId: string, bytes: ArrayBuffer): string;
  read(storagePath: string): Uint8Array<ArrayBuffer>;
  remove(storagePath: string): void;
  /** Removes `<dataDir>/attachments/<projectId>` and everything under it; a missing dir is fine. */
  removeProject(projectId: string): void;
}

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export function createAttachmentStore(dataDir: string): AttachmentStore {
  const base = resolve(dataDir);
  const root = resolve(base, "attachments");

  // The check runs on the resolved path, never on the input string: `..`, absolute paths and
  // separators inside an id all collapse into something that either stays inside or does not.
  function inside(resolved: string, depth: number): string {
    if (!resolved.startsWith(root + sep)) throw new Error("path is outside the attachment store");
    if (relative(root, resolved).split(sep).length !== depth) throw new Error("path is outside the attachment store");
    return resolved;
  }

  const fileAt = (storagePath: string) => inside(resolve(base, storagePath), 2);

  return {
    put(projectId, attachmentId, bytes) {
      const target = inside(resolve(root, projectId, attachmentId), 2);
      mkdirSync(dirname(target), { recursive: true });
      // "wx": an id collision must fail loudly rather than overwrite bytes another row points at.
      writeFileSync(target, new Uint8Array(bytes), { flag: "wx" });
      return relative(base, target).split(sep).join("/");
    },
    read(storagePath) {
      return new Uint8Array(readFileSync(fileAt(storagePath)));
    },
    remove(storagePath) {
      const target = fileAt(storagePath);
      try {
        unlinkSync(target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    },
    removeProject(projectId) {
      rmSync(inside(resolve(root, projectId), 1), { recursive: true, force: true });
    },
  };
}
