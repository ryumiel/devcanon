import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function pathOrSymlinkExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

export async function isSymlink(p: string): Promise<boolean> {
  try {
    const stat = await lstat(p);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await lstat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function isWritable(p: string): Promise<boolean> {
  try {
    await access(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(p: string): Promise<string> {
  return readFile(p, "utf-8");
}

export async function writeTextFile(p: string, content: string): Promise<void> {
  await ensureDir(path.dirname(p));
  await writeFile(p, content, "utf-8");
}

export async function atomicWriteFile(
  p: string,
  content: string,
): Promise<void> {
  const tmpPath = `${p}.tmp.${Date.now()}`;
  await ensureDir(path.dirname(p));
  await writeFile(tmpPath, content, "utf-8");
  try {
    await rename(tmpPath, p);
  } catch (err) {
    // Clean up temp file on rename failure
    try {
      await unlink(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export function isUnobservableSymlinkTargetError(error: unknown): boolean {
  return (
    isNodeErrorCode(error, "ENOENT") ||
    isNodeErrorCode(error, "ELOOP") ||
    isNodeErrorCode(error, "EPERM") ||
    isNodeErrorCode(error, "EACCES")
  );
}

export { readdir, readFile, lstat, access, mkdir };
