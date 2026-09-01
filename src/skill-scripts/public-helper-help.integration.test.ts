import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const bashResolver = path.join(
  repositoryRoot,
  "skills/devcanon-runtime/scripts/resolve-bash.mjs",
);
const { stdout: resolvedBash } = await execFileAsync(process.execPath, [
  bashResolver,
]);
const bashExecutable = resolvedBash.trim();

type CatalogRow = {
  executable: string;
  usageDocument: string;
};

function catalogRows(markdown: string): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const line of markdown.split("\n")) {
    const links = [...line.matchAll(/\]\(\.\.\/([^)]*)\)/gu)].map(
      (match) => match[1],
    );
    if (links.length !== 2 || !links[0].includes("/scripts/")) continue;
    rows.push({
      executable: path.posix.normalize(
        path.posix.join("contracts", "..", links[0]),
      ),
      usageDocument: path.posix.normalize(
        path.posix.join("contracts", "..", links[1]),
      ),
    });
  }
  return rows;
}

async function runHelper(
  executable: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const command = executable.endsWith(".mjs")
    ? process.execPath
    : bashExecutable;
  const result = await execFileAsync(command, [executable, ...args], {
    cwd,
    env: { PATH: process.env.PATH },
  });
  return result;
}

describe("cataloged public helper help", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((directory) => cleanupTempDir(directory)));
    tempDirs.length = 0;
  });

  it("prints its fixed adjacent usage document before normal operation", async () => {
    const rows = catalogRows(
      await readFile(
        path.join(repositoryRoot, "contracts/public-helpers.md"),
        "utf8",
      ),
    );
    expect(rows).toHaveLength(30);

    const fixtureRoot = await createTempDir();
    tempDirs.push(fixtureRoot);
    const unrelatedCwd = path.join(fixtureRoot, "unrelated-cwd");
    await mkdir(unrelatedCwd);

    for (const row of rows) {
      const executable = path.join(fixtureRoot, row.executable);
      const usageDocument = path.join(fixtureRoot, row.usageDocument);
      await mkdir(path.dirname(executable), { recursive: true });
      await mkdir(path.dirname(usageDocument), { recursive: true });
      await cp(path.join(repositoryRoot, row.executable), executable);
      await cp(path.join(repositoryRoot, row.usageDocument), usageDocument);

      const expectedUsage = await readFile(usageDocument, "utf8");
      const before = await readdir(unrelatedCwd);
      const help = await runHelper(executable, ["--help"], unrelatedCwd);
      expect(help.stdout, row.executable).toBe(expectedUsage);
      expect(help.stderr, row.executable).toBe("");
      expect(await readdir(unrelatedCwd), row.executable).toEqual(before);
      expect(await readFile(usageDocument, "utf8")).toBe(expectedUsage);

      await expect(
        runHelper(executable, ["--help", "extra"], unrelatedCwd),
      ).rejects.toMatchObject({ stdout: "" });
      expect(await readFile(usageDocument, "utf8")).toBe(expectedUsage);

      await rename(usageDocument, `${usageDocument}.missing`);
      await expect(
        runHelper(executable, ["--help"], unrelatedCwd),
      ).rejects.toMatchObject({ stdout: "" });

      await mkdir(usageDocument);
      await expect(
        runHelper(executable, ["--help"], unrelatedCwd),
      ).rejects.toMatchObject({ stdout: "" });
    }
  });
});
