import { chmod, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function normalizePackagedShellBytes(
  relativePath: string,
  bytes: Buffer,
): Buffer {
  if (!isPackagedShellPath(relativePath)) {
    return bytes;
  }
  const normalized: number[] = [];
  let changed = false;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) {
      normalized.push(10);
      index += 1;
      changed = true;
    } else {
      normalized.push(bytes[index]);
    }
  }
  return changed ? Buffer.from(normalized) : bytes;
}

export async function normalizePackagedShellTree(
  scriptsDirectory: string,
): Promise<void> {
  const entries = await readdir(scriptsDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(scriptsDirectory, entry.name);
    if (entry.isDirectory()) {
      await normalizePackagedShellTree(entryPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".sh")) {
      continue;
    }

    const stat = await lstat(entryPath);
    if (!stat.isFile()) {
      continue;
    }
    const sourceBytes = await readFile(entryPath);
    const normalizedBytes = normalizePackagedShellBytes(
      path.posix.join(
        "scripts",
        path.relative(scriptsDirectory, entryPath).split(path.sep).join("/"),
      ),
      sourceBytes,
    );
    if (!normalizedBytes.equals(sourceBytes)) {
      const originalMode = stat.mode & 0o7777;
      await chmod(entryPath, originalMode | 0o200);
      try {
        await writeFile(entryPath, normalizedBytes);
      } finally {
        await chmod(entryPath, originalMode);
      }
    }
  }
}

function isPackagedShellPath(relativePath: string): boolean {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/");
  return segments[0] === "scripts" && normalizedPath.endsWith(".sh");
}
