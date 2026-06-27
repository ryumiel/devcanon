import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

type MirroredFileHashEntries = Map<string, string>;

export function collectPackagedMirroredFilesForHash(
  skillDir: string,
  subdirs: readonly string[],
  generatedDir: string,
): MirroredFileHashEntries {
  const mirroredFiles = new Map<string, string>();

  for (const subdir of subdirs) {
    const sourceRoot = path.join(skillDir, subdir);
    const generatedRoot = path.join(generatedDir, subdir);
    walkPackagedMirroredFilesForHash(
      skillDir,
      sourceRoot,
      generatedRoot,
      mirroredFiles,
    );
  }

  return mirroredFiles;
}

export async function writePackagedMirroredSubdirs(
  skillDir: string,
  subdirs: readonly string[],
  generatedDir: string,
): Promise<void> {
  for (const subdir of subdirs) {
    await writePackagedMirroredTree(
      skillDir,
      path.join(skillDir, subdir),
      path.join(generatedDir, subdir),
    );
  }
}

function walkPackagedMirroredFilesForHash(
  skillDir: string,
  sourceDir: string,
  generatedDir: string,
  mirroredFiles: MirroredFileHashEntries,
): void {
  const entries = readdirSync(sourceDir, { withFileTypes: true }).sort(
    compareDirentNames,
  );

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const generatedPath = path.join(generatedDir, entry.name);

    if (entry.isDirectory()) {
      walkPackagedMirroredFilesForHash(
        skillDir,
        sourcePath,
        generatedPath,
        mirroredFiles,
      );
      continue;
    }

    if (entry.isFile()) {
      const sourceBytes = readFileSync(sourcePath);
      const packagedBytes = packageMirroredFileBytes(
        skillDir,
        sourcePath,
        sourceBytes,
      );
      mirroredFiles.set(
        generatedPath,
        `file:${packagedBytes.toString("base64")}`,
      );
      continue;
    }

    if (entry.isSymbolicLink()) {
      const linkedStat = lstatSync(sourcePath);
      if (linkedStat.isSymbolicLink()) {
        mirroredFiles.set(generatedPath, `symlink:${readlinkSync(sourcePath)}`);
      }
    }
  }
}

async function writePackagedMirroredTree(
  skillDir: string,
  sourceDir: string,
  generatedDir: string,
): Promise<void> {
  await mkdir(generatedDir, { recursive: true });
  const entries = (await readdir(sourceDir, { withFileTypes: true })).sort(
    compareDirentNames,
  );

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const generatedPath = path.join(generatedDir, entry.name);

    if (entry.isDirectory()) {
      await writePackagedMirroredTree(skillDir, sourcePath, generatedPath);
      continue;
    }

    if (entry.isFile()) {
      const sourceStat = await lstat(sourcePath);
      const sourceBytes = await readFile(sourcePath);
      const packagedBytes = packageMirroredFileBytes(
        skillDir,
        sourcePath,
        sourceBytes,
      );
      await mkdir(path.dirname(generatedPath), { recursive: true });
      await writeFile(generatedPath, packagedBytes);
      await chmod(generatedPath, sourceStat.mode & 0o777);
      continue;
    }

    if (entry.isSymbolicLink()) {
      await mkdir(path.dirname(generatedPath), { recursive: true });
      await symlink(await readlink(sourcePath), generatedPath);
    }
  }
}

function packageMirroredFileBytes(
  skillDir: string,
  sourcePath: string,
  sourceBytes: Buffer,
): Buffer {
  if (!isMirroredBashScript(skillDir, sourcePath)) {
    return sourceBytes;
  }

  return normalizeCrLfToLf(sourceBytes);
}

function isMirroredBashScript(skillDir: string, sourcePath: string): boolean {
  const relativePath = path.relative(skillDir, sourcePath).split(path.sep);
  return (
    relativePath.length >= 2 &&
    relativePath[0] === "scripts" &&
    relativePath[relativePath.length - 1]?.endsWith(".sh") === true
  );
}

function normalizeCrLfToLf(sourceBytes: Buffer): Buffer {
  const bytes: number[] = [];
  for (let index = 0; index < sourceBytes.length; index += 1) {
    const current = sourceBytes[index];
    const next = sourceBytes[index + 1];
    if (current === 0x0d && next === 0x0a) {
      bytes.push(0x0a);
      index += 1;
      continue;
    }
    bytes.push(current);
  }
  return Buffer.from(bytes);
}

function compareDirentNames(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
