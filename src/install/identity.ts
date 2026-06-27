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
  allowMissing?: boolean;
}

interface ManagedIdentityOutput {
  target: ManagedRecord["target"];
  type: ManagedRecord["type"];
  sourcePath: string;
  generatedPath: string | null;
  installedPath: string;
  installMode?: InstallMode;
}

type InstalledSkillFiles = Map<string, readonly string[]>;

const MAX_EXHAUSTIVE_SKILL_HASH_CANDIDATES = 1024;

export async function verifyManagedOutputIdentity({
  config,
  record,
  output,
  allowMissing = false,
}: ManagedOutputIdentityOptions): Promise<void> {
  assertRecordMatchesOutput(record, output);
  await assertInstalledPathContained(config, record);

  if (allowMissing && !(await installedPathExists(record.installedPath))) {
    return;
  }

  if (record.installMode === "symlink") {
    await assertSymlinkIdentity(record);
  } else {
    await assertCopyIdentity(record);
  }
}

async function installedPathExists(installedPath: string): Promise<boolean> {
  try {
    await lstat(installedPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
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

async function assertSymlinkIdentity(record: ManagedRecord): Promise<void> {
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

  const expectedTarget = record.generatedPath ?? record.sourcePath;
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
  let actualHashes: string[];
  try {
    actualHashes =
      record.type === "agent"
        ? [await hashInstalledAgent(record.installedPath)]
        : await hashInstalledSkill(record);
  } catch (err) {
    throw identityError(
      record,
      `copy identity check failed: ${(err as Error).message}`,
    );
  }

  if (!actualHashes.includes(record.contentHash)) {
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

async function hashInstalledSkill(record: ManagedRecord): Promise<string[]> {
  const installedPath = record.installedPath;
  const stat = await lstat(installedPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`installed skill is not a directory: ${installedPath}`);
  }

  const skillMdPath = path.join(installedPath, "SKILL.md");
  const skillMdStat = await lstat(skillMdPath);
  if (!skillMdStat.isFile()) {
    throw new Error(`installed skill SKILL.md is not a file: ${skillMdPath}`);
  }
  const content = await readFile(skillMdPath, "utf-8");
  const extraFiles: InstalledSkillFiles = new Map();
  await assertExpectedSkillTopLevelEntries(installedPath);
  await collectInstalledSkillFiles(installedPath, "agents", extraFiles, "raw");
  const expectedRoot = record.generatedPath ?? record.sourcePath;
  for (const subdir of KNOWN_SUBDIRS) {
    await collectInstalledSkillFiles(
      installedPath,
      subdir,
      extraFiles,
      "mirrored",
      expectedRoot,
    );
  }
  return buildSkillContentHashCandidates(content, extraFiles, installedPath);
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
  files: InstalledSkillFiles,
  mode: "raw" | "mirrored",
  expectedRoot?: string,
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
      await collectInstalledSkillFiles(
        root,
        relPath,
        files,
        mode,
        expectedRoot,
      );
      continue;
    }

    if (entry.isFile()) {
      const content =
        mode === "raw"
          ? await readFile(absolutePath, "utf-8")
          : `file:${(await readFile(absolutePath)).toString("base64")}`;
      files.set(absolutePath, [content]);
      continue;
    }

    if (entry.isSymbolicLink()) {
      files.set(
        absolutePath,
        (
          await normalizedInstalledSymlinkTargets(
            absolutePath,
            relPath,
            mode,
            expectedRoot,
          )
        ).map((target) => `symlink:${target}`),
      );
      continue;
    }

    throw new Error(`installed skill contains unsupported entry: ${relPath}`);
  }
}

function buildSkillContentHashCandidates(
  content: string,
  extraFiles: InstalledSkillFiles,
  installedPath: string,
): string[] {
  const extraEntries = Array.from(extraFiles.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const exhaustiveCandidateCount = extraEntries.reduce(
    (total, [, contents]) => total * new Set(contents).size,
    1,
  );

  if (exhaustiveCandidateCount <= MAX_EXHAUSTIVE_SKILL_HASH_CANDIDATES) {
    return buildExhaustiveSkillContentHashCandidates(
      content,
      extraEntries,
      installedPath,
    );
  }

  // The manifest records one aggregate hash, not per-symlink target spelling.
  // Once the generated/source symlink is gone, arbitrary mixed historical
  // spellings cannot be proven without exponential guessing, so large
  // ambiguous copies are checked only against bounded common legacy profiles.
  return buildBoundedSkillContentHashCandidates(
    content,
    extraEntries,
    installedPath,
  );
}

function buildExhaustiveSkillContentHashCandidates(
  content: string,
  extraEntries: Array<[string, readonly string[]]>,
  installedPath: string,
): string[] {
  let candidateFiles = [new Map<string, string>()];

  for (const [filePath, contents] of extraEntries) {
    const uniqueContents = Array.from(new Set(contents));
    candidateFiles = candidateFiles.flatMap((files) =>
      uniqueContents.map((fileContent) => {
        const next = new Map(files);
        next.set(filePath, fileContent);
        return next;
      }),
    );
  }

  return uniqueHashes(
    candidateFiles.map((files) =>
      buildSkillContentHash(content, files, installedPath),
    ),
  );
}

function buildBoundedSkillContentHashCandidates(
  content: string,
  extraEntries: Array<[string, readonly string[]]>,
  installedPath: string,
): string[] {
  const primary = buildCandidateMap(extraEntries, () => 0);
  const candidates = [primary];
  const maxContents = extraEntries.reduce(
    (max, [, contents]) => Math.max(max, new Set(contents).size),
    0,
  );

  for (let contentIndex = 1; contentIndex < maxContents; contentIndex += 1) {
    candidates.push(
      buildCandidateMap(extraEntries, (contents) =>
        Math.min(contentIndex, contents.length - 1),
      ),
    );
  }

  for (let i = 0; i < extraEntries.length; i += 1) {
    const [, contents] = extraEntries[i];
    if (new Set(contents).size <= 1) continue;
    candidates.push(
      buildCandidateMap(extraEntries, (_contents, entryIndex) =>
        entryIndex === i ? 1 : 0,
      ),
    );
  }

  return uniqueHashes(
    candidates.map((files) =>
      buildSkillContentHash(content, files, installedPath),
    ),
  );
}

function buildCandidateMap(
  extraEntries: Array<[string, readonly string[]]>,
  chooseIndex: (contents: string[], entryIndex: number) => number,
): Map<string, string> {
  const files = new Map<string, string>();
  for (let entryIndex = 0; entryIndex < extraEntries.length; entryIndex += 1) {
    const [filePath, contents] = extraEntries[entryIndex];
    const uniqueContents = Array.from(new Set(contents));
    const selectedIndex = Math.min(
      chooseIndex(uniqueContents, entryIndex),
      uniqueContents.length - 1,
    );
    files.set(filePath, uniqueContents[selectedIndex]);
  }
  return files;
}

function uniqueHashes(hashes: string[]): string[] {
  return Array.from(new Set(hashes));
}

async function normalizedInstalledSymlinkTargets(
  installedPath: string,
  relPath: string,
  mode: "raw" | "mirrored",
  expectedRoot: string | undefined,
): Promise<string[]> {
  const actualTarget = await readlink(installedPath);
  if (mode !== "mirrored" || !expectedRoot || !path.isAbsolute(actualTarget)) {
    return [actualTarget];
  }

  const expectedPath = path.join(expectedRoot, ...relPath.split("/"));
  const expectedTarget = await readExpectedSymlinkTarget(expectedPath);
  if (expectedTarget === null) {
    return normalizeAbsoluteTargetsInsideRoot(
      actualTarget,
      expectedRoot,
      expectedPath,
    );
  }
  if (path.isAbsolute(expectedTarget)) {
    return [actualTarget];
  }

  const expectedResolved = path.resolve(
    path.dirname(expectedPath),
    expectedTarget,
  );
  if (actualTarget === expectedResolved) {
    return normalizeAbsoluteTargetsInsideRoot(
      actualTarget,
      expectedRoot,
      expectedPath,
    );
  }

  return [toPosixPath(path.relative(path.dirname(expectedPath), actualTarget))];
}

function normalizeAbsoluteTargetsInsideRoot(
  actualTarget: string,
  expectedRoot: string,
  expectedPath: string,
): string[] {
  const relativeToRoot = path.relative(
    path.resolve(expectedRoot),
    actualTarget,
  );
  if (
    relativeToRoot === "" ||
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    return [actualTarget];
  }

  const relativeTarget = toPosixPath(
    path.relative(path.dirname(expectedPath), actualTarget),
  );
  return relativeSymlinkTargetCandidates(relativeTarget);
}

function relativeSymlinkTargetCandidates(relativeTarget: string): string[] {
  const candidates = new Set<string>();
  for (const spelling of separatorSpellingCandidates(relativeTarget)) {
    candidates.add(spelling);
    if (!spelling.startsWith(".") && !path.isAbsolute(spelling)) {
      candidates.add(`.${path.sep}${spelling}`);
      candidates.add(`./${toPosixPath(spelling)}`);
      candidates.add(`.\\${toWindowsPath(spelling)}`);
    }
  }
  return Array.from(candidates);
}

function separatorSpellingCandidates(relativeTarget: string): string[] {
  return uniqueStrings([
    relativeTarget,
    toPosixPath(relativeTarget),
    toWindowsPath(relativeTarget),
  ]);
}

async function readExpectedSymlinkTarget(
  expectedPath: string,
): Promise<string | null> {
  try {
    const expectedStat = await lstat(expectedPath);
    if (!expectedStat.isSymbolicLink()) {
      return null;
    }
    return readlink(expectedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function toPosixPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").split(path.sep).join("/");
}

function toWindowsPath(filePath: string): string {
  return filePath.replaceAll("/", "\\");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function identityError(record: ManagedRecord, reason: string): UserError {
  return new UserError(
    `Managed output identity failure for ${record.installedPath}: ${reason}`,
  );
}
