import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";

export interface AtomicTextWriteResult {
  path: string;
  tempPath: string;
}

export async function writeTextAtomically(
  targetPath: string,
  content: string,
): Promise<AtomicTextWriteResult> {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  const handle = await open(tempPath, "wx");
  try {
    try {
      await handle.writeFile(content, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithTransientRetry(tempPath, targetPath);
    return { path: targetPath, tempPath };
  } catch (err) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function renameWithTransientRetry(
  tempPath: string,
  targetPath: string,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tempPath, targetPath);
      return;
    } catch (err) {
      if (!isTransientRenameError(err) || attempt >= 4) {
        throw err;
      }
      await setTimeout(10 * (attempt + 1));
    }
  }
}

function isTransientRenameError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return (
    process.platform === "win32" && (code === "EPERM" || code === "EACCES")
  );
}
