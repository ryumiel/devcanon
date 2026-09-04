import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("analysis boundary", () => {
  it("keeps producer modules independent of analysis", async () => {
    const sourceRoot = path.resolve(import.meta.dirname, "..");
    const producers = await sourceFiles(sourceRoot, ["render", "validate"]);
    const publicSurfaces = await sourceFiles(sourceRoot, [
      "cli",
      "config",
      "install",
    ]);
    for (const producer of [...producers, ...publicSurfaces]) {
      await expect(readFile(producer, "utf8")).resolves.not.toMatch(
        analysisSpecifier,
      );
    }
    await expect(
      readFile(path.resolve(sourceRoot, "..", "package.json"), "utf8"),
    ).resolves.not.toMatch(/analysis/u);
    await expect(
      readFile(path.join(sourceRoot, "analysis", "runner.ts"), "utf8"),
    ).resolves.toMatch(/from ["']\.\.\/render\/pipeline\.js["']/u);
    await expect(
      readFile(path.join(sourceRoot, "analysis", "runner.ts"), "utf8"),
    ).resolves.toMatch(/from ["']\.\.\/models\/types\.js["']/u);
  });
});

const analysisSpecifier =
  /(?:\b(?:import|export)\s*(?:[^"'()]*?\s+from\s+)?|\bimport\s*\()["'][^"']*(?:\.\.\/|\.?\/)?analysis(?:\/|\.js|["'])/u;

async function sourceFiles(
  root: string,
  directories: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const directory of directories) {
    await collect(path.join(root, directory), files);
  }
  return files;
}

async function collect(directory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filePath, files);
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(filePath);
  }
}
