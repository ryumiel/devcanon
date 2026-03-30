import { lstat, readlink, rm, symlink } from "node:fs/promises";
import { getLogger } from "../utils/output.js";

export async function createSymlink(
  target: string,
  linkPath: string,
  isDirectory: boolean,
): Promise<void> {
  // Remove existing if present
  try {
    const stat = await lstat(linkPath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      await rm(linkPath);
    } else if (stat.isDirectory()) {
      await rm(linkPath, { recursive: true });
    }
  } catch {
    // Does not exist, fine
  }

  try {
    await symlink(target, linkPath, isDirectory ? "dir" : "file");
  } catch (err: unknown) {
    if (
      (err as NodeJS.ErrnoException).code === "EPERM" &&
      process.platform === "win32"
    ) {
      throw err; // Let caller handle Windows fallback
    }
    throw err;
  }

  getLogger().verbose(`  Symlinked ${linkPath} -> ${target}`);
}
