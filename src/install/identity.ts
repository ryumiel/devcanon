import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import type {
  InstallMode,
  ManagedRecord,
  ResolvedConfig,
} from "../config/schema.js";
import { buildSkillContentHash } from "../render/skill.js";
import { UserError } from "../utils/errors.js";
import { sha256 } from "../utils/hash.js";
import { KNOWN_SUBDIRS } from "../validate/skills.js";

export interface ManagedOutputIdentityOptions {
  config: ResolvedConfig;
  record: ManagedRecord;
  output?: ManagedIdentityOutput;
}

interface ManagedIdentityOutput {
  target: ManagedRecord["target"];
  type: ManagedRecord["type"];
  sourcePath: string;
  generatedPath: string | null;
  installedPath: string;
  installMode?: InstallMode;
}

export async function verifyManagedOutputIdentity({
  config,
  record,
  output,
}: ManagedOutputIdentityOptions): Promise<void> {
  assertRecordMatchesOutput(record, output);
  await assertInstalledPathContained(config, record);

  if (record.installMode === "symlink") {
    await assertSymlinkIdentity(record, output);
  } else {
    await assertCopyIdentity(record);
  }
}

function assertRecordMatchesOutput(
  record: ManagedRecord,
  output: ManagedIdentityOutput | undefined,
): void {
  if (!output) return;

  const mismatches: string[] = [];
  if (record.target !== output.target) mismatches.push("target");
  if (record.type !== output.type) mismatches.push("type");
  if (record.sourcePath !== output.sourcePath) mismatches.push("source path");
  if (record.generatedPath !== output.generatedPath) {
    mismatches.push("generated path");
  }
  if (record.installedPath !== output.installedPath) {
    mismatches.push("installed path");
  }
  if (output.installMode && record.installMode !== output.installMode) {
    mismatches.push("install mode");
  }

  if (mismatches.length > 0) {
    throw identityError(record, `manifest ${mismatches.join(", ")} mismatch`);
  }
}

async function assertInstalledPathContained(
  config: ResolvedConfig,
  record: ManagedRecord,
): Promise<void> {
  const targetHome =
    record.type === "skill"
      ? config.targets[record.target].skillsHome
      : config.targets[record.target].agentsHome;
  const resolvedHome = path.resolve(targetHome);
  const resolvedInstalledPath = path.resolve(record.installedPath);
  const relativePath = path.relative(resolvedHome, resolvedInstalledPath);

  await assertNoSymlinkAncestorsToHome(resolvedHome, record);
  await assertTargetHomeIsNotSymlink(resolvedHome, record);

  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw identityError(
      record,
      `installed path is outside configured ${record.target} ${record.type} home`,
    );
  }

  await assertNoSymlinkParents(resolvedHome, resolvedInstalledPath, record);
}

async function assertNoSymlinkAncestorsToHome(
  resolvedHome: string,
  record: ManagedRecord,
): Promise<void> {
  let current = path.parse(resolvedHome).root;
  const parts = path.relative(current, resolvedHome).split(path.sep);
  for (const part of parts.filter(Boolean)) {
    current = path.join(current, part);
    if (current === resolvedHome) return;

    try {
      const stat = await lstat(current);
      if (isUserControlledSymlink(stat)) {
        throw identityError(
          record,
          `configured ${record.target} ${record.type} home crosses symlinked ancestor: ${current}`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

async function assertTargetHomeIsNotSymlink(
  resolvedHome: string,
  record: ManagedRecord,
): Promise<void> {
  try {
    const stat = await lstat(resolvedHome);
    if (stat.isSymbolicLink()) {
      throw identityError(
        record,
        `configured ${record.target} ${record.type} home is a symlink: ${resolvedHome}`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

function isUserControlledSymlink(stat: Awaited<ReturnType<typeof lstat>>) {
  if (!stat.isSymbolicLink()) return false;
  const currentUid = process.getuid?.();
  if (currentUid === undefined) return true;
  return stat.uid === currentUid;
}

async function assertNoSymlinkParents(
  resolvedHome: string,
  resolvedInstalledPath: string,
  record: ManagedRecord,
): Promise<void> {
  const parentPath = path.dirname(resolvedInstalledPath);
  const relativeParent = path.relative(resolvedHome, parentPath);
  if (relativeParent === "") return;

  let current = resolvedHome;
  for (const part of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw identityError(
          record,
          `installed path crosses symlinked parent component: ${current}`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }
}

async function assertSymlinkIdentity(
  record: ManagedRecord,
  output: ManagedIdentityOutput | undefined,
): Promise<void> {
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(record.installedPath);
  } catch (err) {
    throw identityError(
      record,
      `installed path is missing: ${(err as Error).message}`,
    );
  }

  if (!stat.isSymbolicLink()) {
    throw identityError(record, "installed path is not a symlink");
  }

  const expectedTarget = output
    ? (output.generatedPath ?? output.sourcePath)
    : (record.generatedPath ?? record.sourcePath);
  const actualTarget = await readlink(record.installedPath);
  const actualResolved = path.resolve(
    path.dirname(record.installedPath),
    actualTarget,
  );
  const expectedResolved = path.resolve(expectedTarget);

  if (actualResolved !== expectedResolved) {
    throw identityError(
      record,
      `symlink target mismatch: expected ${expectedTarget}, found ${actualTarget}`,
    );
  }
}

async function assertCopyIdentity(record: ManagedRecord): Promise<void> {
  let actualHash: string;
  try {
    actualHash =
      record.type === "agent"
        ? await hashInstalledAgent(record.installedPath)
        : await hashInstalledSkill(record.installedPath);
  } catch (err) {
    throw identityError(
      record,
      `copy identity check failed: ${(err as Error).message}`,
    );
  }

  if (actualHash !== record.contentHash) {
    throw identityError(record, "installed copy content hash mismatch");
  }
}

async function hashInstalledAgent(installedPath: string): Promise<string> {
  const stat = await lstat(installedPath);
  if (!stat.isFile()) {
    throw new Error(`installed agent is not a file: ${installedPath}`);
  }
  return sha256(await readFile(installedPath, "utf-8"));
}

async function hashInstalledSkill(installedPath: string): Promise<string> {
  const stat = await lstat(installedPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`installed skill is not a directory: ${installedPath}`);
  }

  const skillMdPath = path.join(installedPath, "SKILL.md");
  const content = await readFile(skillMdPath, "utf-8");
  const extraFiles = new Map<string, string>();
  await assertExpectedSkillTopLevelEntries(installedPath);
  await collectInstalledSkillFiles(installedPath, "agents", extraFiles, "raw");
  for (const subdir of KNOWN_SUBDIRS) {
    await collectInstalledSkillFiles(
      installedPath,
      subdir,
      extraFiles,
      "mirrored",
    );
  }
  return buildSkillContentHash(content, extraFiles, installedPath);
}

async function assertExpectedSkillTopLevelEntries(
  installedPath: string,
): Promise<void> {
  const allowedTopLevel = new Set(["SKILL.md", "agents", ...KNOWN_SUBDIRS]);
  const entries = await readdir(installedPath, { withFileTypes: true });
  const unexpected = entries
    .map((entry) => entry.name)
    .filter((name) => !allowedTopLevel.has(name))
    .sort();

  if (unexpected.length > 0) {
    throw new Error(
      `installed skill contains unexpected top-level entries: ${unexpected.join(
        ", ",
      )}`,
    );
  }
}

async function collectInstalledSkillFiles(
  root: string,
  base: string,
  files: Map<string, string>,
  mode: "raw" | "mirrored",
): Promise<void> {
  const currentDir = path.join(root, ...base.split("/").filter(Boolean));
  const entries = await readdir(currentDir, { withFileTypes: true }).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    },
  );
  if (entries === null) return;

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const relPath = `${base}/${entry.name}`;
    const absolutePath = path.join(root, ...relPath.split("/"));

    if (entry.isDirectory()) {
      await collectInstalledSkillFiles(root, relPath, files, mode);
      continue;
    }

    if (entry.isFile()) {
      const content =
        mode === "raw"
          ? await readFile(absolutePath, "utf-8")
          : `file:${(await readFile(absolutePath)).toString("base64")}`;
      files.set(absolutePath, content);
      continue;
    }

    if (entry.isSymbolicLink()) {
      files.set(absolutePath, `symlink:${await readlink(absolutePath)}`);
    }
  }
}

function identityError(record: ManagedRecord, reason: string): UserError {
  return new UserError(
    `Managed output identity failure for ${record.installedPath}: ${reason}`,
  );
}
