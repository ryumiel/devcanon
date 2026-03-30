import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const EXCLUDED_FILES = new Set([".DS_Store", "Thumbs.db"]);

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export async function hashDirectory(dirPath: string): Promise<string> {
  const entries = await collectFiles(dirPath);
  const hash = createHash("sha256");
  for (const entry of entries) {
    const fileContent = await readFile(entry.absolutePath);
    const fileHash = createHash("sha256")
      .update(`${entry.relativePath}\0`)
      .update(fileContent)
      .digest("hex");
    hash.update(fileHash);
  }
  return hash.digest("hex");
}

interface FileEntry {
  relativePath: string;
  absolutePath: string;
}

async function collectFiles(
  dirPath: string,
  base?: string,
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  const items = await readdir(dirPath, { withFileTypes: true });
  const sorted = items.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  for (const item of sorted) {
    if (EXCLUDED_FILES.has(item.name)) continue;

    const rel = base ? `${base}/${item.name}` : item.name;
    const abs = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      entries.push(...(await collectFiles(abs, rel)));
    } else if (item.isFile() || item.isSymbolicLink()) {
      entries.push({ relativePath: rel, absolutePath: abs });
    }
  }

  return entries;
}
