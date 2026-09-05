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
    const manifest = parseManifest(
      await readFile(path.resolve(sourceRoot, "..", "package.json"), "utf8"),
    );
    for (const entry of manifest.files) {
      expect(
        filesEntryCouldPublishAnalysis(entry),
        `package files entry publishes analysis: ${entry}`,
      ).toBe(false);
    }
    for (const entry of manifest.publicEntries) {
      expect(
        publicEntryExposesAnalysis(entry),
        `package entry exposes analysis: ${entry}`,
      ).toBe(false);
    }
    for (const specifier of manifest.exportSpecifiers) {
      expect(
        exportSpecifierExposesAnalysis(specifier),
        `package export specifier exposes analysis: ${specifier}`,
      ).toBe(false);
    }
    await expect(
      readFile(path.join(sourceRoot, "analysis", "runner.ts"), "utf8"),
    ).resolves.toMatch(/from ["']\.\.\/render\/pipeline\.js["']/u);
    await expect(
      readFile(path.join(sourceRoot, "analysis", "runner.ts"), "utf8"),
    ).resolves.toMatch(/from ["']\.\.\/models\/types\.js["']/u);
  });

  it("distinguishes harmless manifest prose from analysis publication surfaces", () => {
    const harmless = parseManifest(
      JSON.stringify({
        description: "Analysis is implemented behind a private boundary.",
        files: ["dist/cli"],
        exports: { ".": "./dist/cli/index.js" },
      }),
    );
    expect(harmless.files.some(filesEntryCouldPublishAnalysis)).toBe(false);
    expect(harmless.publicEntries.some(publicEntryExposesAnalysis)).toBe(false);
    expect(harmless.exportSpecifiers).toEqual(["."]);
    expect(harmless.exportSpecifiers.some(exportSpecifierExposesAnalysis)).toBe(
      false,
    );

    for (const entry of [
      "dist",
      "dist/**",
      "dist/analysis",
      "src",
      "src/**",
      "src/analysis",
      "/dist",
      "/dist/**",
      "/src",
      "/src/**",
      "dist/{analysis,cli}",
      "src/@(analysis|cli)",
      "dist/+(analysis)",
    ]) {
      expect(filesEntryCouldPublishAnalysis(entry)).toBe(true);
    }
    expect(publicEntryExposesAnalysis("./dist/analysis/index.js")).toBe(true);
    expect(publicEntryExposesAnalysis("./src/analysis/index.ts")).toBe(true);
    expect(exportSpecifierExposesAnalysis("./analysis")).toBe(true);
  });
});

const analysisSpecifier =
  /(?:\b(?:import|export)\s*(?:[^"'()]*?\s+from\s+)?|\bimport\s*\()["'][^"']*(?:\.\.\/|\.?\/)?analysis(?:\/|\.js|["'])/u;
const analysisRoots = ["dist/analysis", "src/analysis"] as const;

function parseManifest(text: string): {
  readonly files: readonly string[];
  readonly publicEntries: readonly string[];
  readonly exportSpecifiers: readonly string[];
} {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || !Array.isArray(value.files)) {
    throw new Error("package manifest must declare a files array");
  }
  const files = value.files;
  if (!files.every((entry): entry is string => typeof entry === "string")) {
    throw new Error("package manifest files entries must be strings");
  }

  const publicEntries: string[] = [];
  const exportSpecifiers: string[] = [];
  for (const field of ["main", "module", "types"] as const) {
    const entry = value[field];
    if (typeof entry === "string") publicEntries.push(entry);
  }
  collectManifestPaths(value.bin, publicEntries);
  collectExportSurfaces(value.exports, publicEntries, exportSpecifiers);
  return { files, publicEntries, exportSpecifiers };
}

function collectManifestPaths(value: unknown, paths: string[]): void {
  if (typeof value === "string") {
    paths.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectManifestPaths(item, paths);
    return;
  }
  if (!isRecord(value)) return;
  for (const item of Object.values(value)) collectManifestPaths(item, paths);
}

function collectExportSurfaces(
  value: unknown,
  targets: string[],
  specifiers: string[],
): void {
  if (typeof value === "string") {
    targets.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExportSurfaces(item, targets, specifiers);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith(".")) specifiers.push(key);
    collectExportSurfaces(item, targets, specifiers);
  }
}

function filesEntryCouldPublishAnalysis(entry: string): boolean {
  if (entry.startsWith("!")) return false;
  const normalized = normalizeManifestPath(entry);
  if (normalized === "" || normalized === ".") return true;

  // npm-packlist accepts several glob syntaxes. Rather than duplicate its full
  // matcher, conservatively compare the literal prefix before any glob, brace,
  // or extglob opener with each private analysis root.
  const pattern = patternStart(normalized);
  if (pattern < normalized.length) {
    const prefix = normalized.slice(0, pattern).replace(/\/$/u, "");
    return (
      prefix.length === 0 ||
      analysisRoots.some(
        (root) => root.startsWith(prefix) || prefix.startsWith(root),
      )
    );
  }
  return analysisRoots.some(
    (root) =>
      normalized === root ||
      root.startsWith(`${normalized}/`) ||
      normalized.startsWith(`${root}/`),
  );
}

function patternStart(entry: string): number {
  let first = entry.length;
  for (const token of ["*", "?", "[", "{"]) {
    const index = entry.indexOf(token);
    if (index >= 0) first = Math.min(first, index);
  }
  const parenthesis = entry.indexOf("(");
  if (parenthesis >= 0) {
    const operator = entry[parenthesis - 1];
    first = Math.min(
      first,
      operator !== undefined && "@+?!*".includes(operator)
        ? parenthesis - 1
        : parenthesis,
    );
  }
  return first;
}

function publicEntryExposesAnalysis(entry: string): boolean {
  const normalized = normalizeManifestPath(entry);
  return (
    /(?:^|\/)analysis(?:\/|$)/u.test(normalized) ||
    filesEntryCouldPublishAnalysis(normalized)
  );
}

function exportSpecifierExposesAnalysis(specifier: string): boolean {
  return /(?:^|\/)analysis(?:\/|$)/u.test(normalizeManifestPath(specifier));
}

function normalizeManifestPath(entry: string): string {
  return entry
    .replace(/\\/gu, "/")
    .replace(/^(?:\.\/|\/)+/u, "")
    .replace(/\/$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
