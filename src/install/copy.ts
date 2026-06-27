import { cp, rm } from "node:fs/promises";
import { getLogger } from "../utils/output.js";

export async function copyFile(src: string, dst: string): Promise<void> {
  await cp(src, dst, { force: true });
  getLogger().verbose(`  Copied ${src} -> ${dst}`);
}

export async function copyDirectory(src: string, dst: string): Promise<void> {
  // Remove existing destination if present
  try {
    await rm(dst, { recursive: true });
  } catch {
    // Does not exist
  }
  await cp(src, dst, { recursive: true, force: true, verbatimSymlinks: true });
  getLogger().verbose(`  Copied directory ${src} -> ${dst}`);
}
