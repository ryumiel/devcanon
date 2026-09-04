import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { LoadedSkill } from "../models/types.js";
import { normalizePackagedShellBytes } from "../render/packaged-shell.js";
import {
  type SkillContextEnvelope,
  canonicalizeSkillContext,
  parseCanonicalSkillContextEnvelope,
} from "./skill-context.js";

const execute = promisify(execFile);
const SHA256 = /^[a-f0-9]{64}$/u;

export class AnalysisFilesError extends Error {
  constructor(
    readonly category: "support-file" | "result" | "comparison",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisFilesError";
  }
}

export interface DeclaredSupportFile {
  readonly path: string;
  readonly target: "claude" | "codex";
  readonly rawBytes: Buffer;
  readonly rawBytesSha256: string;
  readonly targetText: string;
  readonly targetTextSha256: string;
}

export interface ReadDeclaredSupportFileInput {
  readonly skill: LoadedSkill;
  readonly target: "claude" | "codex";
  readonly path: string;
}

/** Read one explicitly declared file without following any symlink. */
export async function readDeclaredSupportFile(
  input: ReadDeclaredSupportFileInput,
): Promise<DeclaredSupportFile> {
  if (input.target !== "claude" && input.target !== "codex") {
    fail("support-file", "support target must be claude or codex");
  }
  const relativePath = validateSupportPath(input.path, input.skill);
  const root = await requireDirectory(
    input.skill.dirPath,
    "support-file",
    "skill bundle root",
  );
  const filePath = path.join(root, ...relativePath.split("/"));
  await assertNonsymlinkPath(root, filePath, "support-file");
  const stat = await requireStat(
    filePath,
    "support-file",
    "declared support file",
  );
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(
      "support-file",
      "declared support file must be a regular non-symlink file",
    );
  }
  const physical = await realpath(filePath).catch(() =>
    fail("support-file", "declared support file could not be resolved"),
  );
  if (!isWithin(root, physical))
    fail("support-file", "declared support file escapes skill bundle root");

  let rawBytes: Buffer;
  try {
    rawBytes = await readOpenedRegularFile(filePath, root, "support-file");
  } catch {
    fail("support-file", "declared support file could not be read");
  }
  const normalized = normalizePackagedShellBytes(relativePath, rawBytes);
  let targetText: string;
  try {
    targetText = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(normalized);
  } catch {
    fail("support-file", "declared support file is not valid UTF-8");
  }
  return Object.freeze({
    path: relativePath,
    target: input.target,
    rawBytes,
    rawBytesSha256: hash(rawBytes),
    targetText,
    targetTextSha256: hash(Buffer.from(targetText, "utf8")),
  });
}

export interface PublishAnalysisResultInput {
  readonly repositoryRoot: string;
  readonly resultDirectory: string;
  readonly envelope: SkillContextEnvelope;
}

export interface PublishedAnalysisResult {
  readonly path: string;
  readonly relativePath: string;
}

/** Publish exactly one canonical envelope inside an existing ignored .ephemeral directory. */
export async function publishAnalysisResult(
  input: PublishAnalysisResultInput,
): Promise<PublishedAnalysisResult> {
  const boundary = await validateResultDirectory(
    input.repositoryRoot,
    input.resultDirectory,
  );
  const canonical = await canonicalizeSkillContext(input.envelope.payload);
  if (!canonical.bytes.equals(input.envelope.bytes)) {
    fail("result", "result envelope must use canonical bytes");
  }
  if (canonical.payloadSha256 !== input.envelope.payloadSha256) {
    fail("result", "result envelope payload hash mismatch");
  }
  const leaf = `analysis-${canonical.payloadSha256}.json`;
  const destination = path.join(boundary.resultDirectory, leaf);
  await assertIgnoredAndTrackedState(boundary, destination);
  const existingIdentical = await assertReplaceableDestination(
    destination,
    boundary.ephemeralDirectory,
    canonical.bytes,
  );
  if (existingIdentical) {
    const relativePath = path
      .relative(boundary.repositoryRoot, destination)
      .split(path.sep)
      .join("/");
    return Object.freeze({ path: destination, relativePath });
  }
  await assertNonsymlinkPath(
    boundary.ephemeralDirectory,
    destination,
    "result",
    true,
  );
  const temporary = `${destination}.tmp-${process.pid}-${randomBytes(12).toString("hex")}`;
  let createdTemporary = false;
  let temporaryIdentity: { dev: number; ino: number } | undefined;
  const parent = await openNonsymlinkDirectory(boundary.resultDirectory);
  try {
    await assertSameDirectory(boundary.resultDirectory, parent);
    const temporaryHandle = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await temporaryHandle.writeFile(canonical.bytes);
      const temporaryStat = await temporaryHandle.stat();
      if (!temporaryStat.isFile()) {
        fail("result", "temporary result leaf must be a regular file");
      }
      temporaryIdentity = { dev: temporaryStat.dev, ino: temporaryStat.ino };
      createdTemporary = true;
    } finally {
      await temporaryHandle.close().catch(() => undefined);
    }
    await assertOwnedTemporary(
      temporary,
      boundary.ephemeralDirectory,
      temporaryIdentity,
      canonical.bytes,
    );
    await assertSameDirectory(boundary.resultDirectory, parent);
    await assertNonsymlinkPath(
      boundary.ephemeralDirectory,
      destination,
      "result",
      true,
    );
    await link(temporary, destination).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        fail("result", "result destination appeared after preflight");
      }
      throw error;
    });
    await assertSameDirectory(boundary.resultDirectory, parent);
    await assertOwnedDestination(
      destination,
      boundary.ephemeralDirectory,
      canonical.bytes,
    );
    await unlinkOwnedTemporary(temporary, temporaryIdentity);
    createdTemporary = false;
  } catch (error) {
    if (createdTemporary && temporaryIdentity !== undefined) {
      await unlinkOwnedTemporary(temporary, temporaryIdentity);
    }
    throw error instanceof AnalysisFilesError
      ? error
      : new AnalysisFilesError("result", "could not publish analysis result");
  } finally {
    await parent.close().catch(() => undefined);
  }
  const relativePath = path
    .relative(boundary.repositoryRoot, destination)
    .split(path.sep)
    .join("/");
  return Object.freeze({ path: destination, relativePath });
}

export interface ReadComparisonResultInput {
  readonly repositoryRoot: string;
  readonly resultPath: string;
  readonly expectedPayloadSha256: string;
}

/** Read a prior envelope only when its on-disk bytes are exactly canonical. */
export async function readComparisonResult(
  input: ReadComparisonResultInput,
): Promise<SkillContextEnvelope> {
  if (!SHA256.test(input.expectedPayloadSha256)) {
    fail("comparison", "comparison expected payload hash must be SHA-256");
  }
  const boundary = await validateRepositoryBoundary(
    input.repositoryRoot,
    "comparison",
  );
  const rawComparisonPath = requireAbsolute(
    input.resultPath,
    "comparison result path",
    "comparison",
  );
  const rawEphemeralDirectory = path.join(
    requireAbsolute(input.repositoryRoot, "repository root", "comparison"),
    ".ephemeral",
  );
  if (!isWithin(rawEphemeralDirectory, rawComparisonPath)) {
    fail("comparison", "comparison result path must be inside .ephemeral");
  }
  await assertNonsymlinkPath(
    rawEphemeralDirectory,
    rawComparisonPath,
    "comparison",
  );
  const comparisonPath = await realpath(rawComparisonPath).catch(() =>
    fail("comparison", "comparison result could not be resolved"),
  );
  if (!isWithin(boundary.ephemeralDirectory, comparisonPath)) {
    fail("comparison", "comparison result path must be inside .ephemeral");
  }
  const stat = await requireStat(
    comparisonPath,
    "comparison",
    "comparison result",
  );
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("comparison", "comparison result must be a regular non-symlink file");
  }
  let bytes: Buffer;
  try {
    bytes = await readOpenedRegularFile(
      comparisonPath,
      boundary.ephemeralDirectory,
      "comparison",
    );
  } catch {
    fail("comparison", "comparison result could not be read");
  }
  const envelope = await parseCanonicalSkillContextEnvelope(bytes).catch(
    (error) => {
      throw new AnalysisFilesError("comparison", (error as Error).message);
    },
  );
  const canonical = await canonicalizeSkillContext(envelope.payload);
  if (!canonical.bytes.equals(bytes)) {
    fail("comparison", "comparison result bytes are not canonical");
  }
  if (envelope.payloadSha256 !== input.expectedPayloadSha256) {
    fail(
      "comparison",
      "comparison result payload hash does not match expected hash",
    );
  }
  return envelope;
}

export async function validateResultDirectory(
  repositoryRoot: string,
  resultDirectory: string,
): Promise<{
  readonly repositoryRoot: string;
  readonly ephemeralDirectory: string;
  readonly resultDirectory: string;
}> {
  const boundary = await validateRepositoryBoundary(repositoryRoot);
  const rawSelected = requireAbsolute(resultDirectory, "result directory");
  const rawEphemeralDirectory = path.join(
    requireAbsolute(repositoryRoot, "repository root"),
    ".ephemeral",
  );
  if (!isWithin(rawEphemeralDirectory, rawSelected)) {
    fail("result", "result directory must be inside .ephemeral");
  }
  await assertNonsymlinkPath(rawEphemeralDirectory, rawSelected, "result");
  const selected = await realpath(rawSelected).catch(() =>
    fail("result", "result directory could not be resolved"),
  );
  if (!isWithin(boundary.ephemeralDirectory, selected)) {
    fail("result", "result directory must be inside .ephemeral");
  }
  const resultDirectoryReal = await requireDirectory(
    selected,
    "result",
    "result directory",
  );
  if (!isWithin(boundary.ephemeralDirectory, resultDirectoryReal)) {
    fail("result", "result directory physically escapes .ephemeral");
  }
  const relative = path.relative(boundary.repositoryRoot, resultDirectoryReal);
  try {
    await execute("git", [
      "-C",
      boundary.repositoryRoot,
      "check-ignore",
      "--quiet",
      "--",
      relative,
    ]);
  } catch {
    fail("result", "result directory must be ignored by Git");
  }
  return Object.freeze({
    repositoryRoot: boundary.repositoryRoot,
    ephemeralDirectory: boundary.ephemeralDirectory,
    resultDirectory: resultDirectoryReal,
  });
}

async function validateRepositoryBoundary(
  repositoryRoot: string,
  category: AnalysisFilesError["category"] = "result",
): Promise<{
  readonly repositoryRoot: string;
  readonly ephemeralDirectory: string;
}> {
  const root = await requireDirectory(
    repositoryRoot,
    category,
    "repository root",
  );
  try {
    const { stdout } = await execute("git", [
      "-C",
      root,
      "rev-parse",
      "--show-toplevel",
    ]);
    if (path.resolve(stdout.trim()) !== root)
      fail(category, "repository root must be the Git worktree root");
  } catch (error) {
    if (error instanceof AnalysisFilesError) throw error;
    fail(category, "repository root must be a Git worktree root");
  }
  const ephemeral = path.join(root, ".ephemeral");
  await assertNonsymlinkPath(root, ephemeral, category);
  const ephemeralReal = await requireDirectory(
    ephemeral,
    category,
    ".ephemeral",
  );
  if (!isWithin(root, ephemeralReal))
    fail(category, ".ephemeral physically escapes repository root");
  return Object.freeze({
    repositoryRoot: root,
    ephemeralDirectory: ephemeralReal,
  });
}

function validateSupportPath(raw: string, skill: LoadedSkill): string {
  if (typeof raw !== "string" || raw.length === 0)
    fail("support-file", "support path must be a nonempty relative path");
  if (raw.includes("\\") || path.posix.isAbsolute(raw))
    fail(
      "support-file",
      "support path must be a normalized repository-style relative path",
    );
  const segments = raw.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    fail(
      "support-file",
      "support path must be a normalized repository-style relative path",
    );
  }
  if (!Array.isArray(skill.subdirs) || !skill.subdirs.includes(segments[0])) {
    fail(
      "support-file",
      "support path must be under a declared skill subdirectory",
    );
  }
  return raw;
}

function requireAbsolute(
  value: string,
  label: string,
  category: AnalysisFilesError["category"] = "result",
): string {
  if (typeof value !== "string" || !path.isAbsolute(value))
    fail(category, `${label} must be an absolute path`);
  return path.resolve(value);
}

async function requireDirectory(
  value: string,
  category: AnalysisFilesError["category"],
  label: string,
): Promise<string> {
  const directory = requireAbsolute(value, label, category);
  const stat = await requireStat(directory, category, label);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    fail(category, `${label} must be a non-symlink directory`);
  return realpath(directory).catch(() =>
    fail(category, `${label} could not be resolved`),
  );
}

async function requireStat(
  value: string,
  category: AnalysisFilesError["category"],
  label: string,
) {
  try {
    return await lstat(value);
  } catch {
    fail(category, `${label} does not exist or cannot be inspected`);
  }
}

async function assertNonsymlinkPath(
  root: string,
  destination: string,
  category: AnalysisFilesError["category"],
  allowMissingLeaf = false,
): Promise<void> {
  if (!isWithin(root, destination))
    fail(category, "path escapes its declared boundary");
  const relative = path.relative(root, destination);
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    if (segment.length === 0) continue;
    cursor = path.join(cursor, segment);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        fail(category, "path must not contain a symlink component");
    } catch (error) {
      if (error instanceof AnalysisFilesError) throw error;
      if (allowMissingLeaf && cursor === destination) return;
      fail(category, "path component does not exist or cannot be inspected");
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== "..")
  );
}

async function readOpenedRegularFile(
  filePath: string,
  root: string,
  category: AnalysisFilesError["category"],
): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    const current = await lstat(filePath);
    const physical = await realpath(filePath);
    if (
      !opened.isFile() ||
      current.isSymbolicLink() ||
      !current.isFile() ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino ||
      !isWithin(root, physical)
    ) {
      fail(
        category,
        "opened file no longer satisfies containment and regular-file checks",
      );
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof AnalysisFilesError) throw error;
    return fail(
      category,
      "declared file could not be opened without following links",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function assertIgnoredAndTrackedState(
  boundary: Awaited<ReturnType<typeof validateResultDirectory>>,
  destination: string,
): Promise<void> {
  const relative = path.relative(boundary.repositoryRoot, destination);
  if (!isWithin(boundary.ephemeralDirectory, destination)) {
    fail("result", "derived result leaf escapes .ephemeral");
  }
  try {
    await execute("git", [
      "-C",
      boundary.repositoryRoot,
      "check-ignore",
      "--quiet",
      "--no-index",
      "--",
      relative,
    ]);
  } catch {
    fail("result", "derived result leaf must be ignored by Git");
  }
  try {
    await execute("git", [
      "-C",
      boundary.repositoryRoot,
      "ls-files",
      "--error-unmatch",
      "--",
      relative,
    ]);
    fail("result", "tracked result leaf is never publishable");
  } catch (error) {
    if (error instanceof AnalysisFilesError) throw error;
    if (Number((error as NodeJS.ErrnoException).code) !== 1) {
      fail("result", "could not inspect Git tracked state for result leaf");
    }
  }
}

async function assertOwnedDestination(
  destination: string,
  root: string,
  expectedBytes: Buffer,
): Promise<void> {
  try {
    const stat = await lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail("result", "result destination must be an owned regular file");
    }
  } catch (error) {
    if (error instanceof AnalysisFilesError) throw error;
    fail("result", "result destination could not be inspected");
  }
  const current = await readOpenedRegularFile(destination, root, "result");
  if (!current.equals(expectedBytes)) {
    fail("result", "result destination bytes changed during publication");
  }
}

async function assertReplaceableDestination(
  destination: string,
  root: string,
  expectedBytes: Buffer,
): Promise<boolean> {
  try {
    const stat = await lstat(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail(
        "result",
        "result destination must be absent or an owned regular file",
      );
    }
    const current = await readOpenedRegularFile(destination, root, "result");
    if (!current.equals(expectedBytes)) {
      fail(
        "result",
        "existing result destination is not this owned analysis result",
      );
    }
    return true;
  } catch (error) {
    if (error instanceof AnalysisFilesError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    fail("result", "result destination could not be inspected");
  }
}

async function assertOwnedTemporary(
  temporary: string,
  root: string,
  identity: { dev: number; ino: number },
  expectedBytes: Buffer,
): Promise<void> {
  const stat = await lstat(temporary);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== identity.dev ||
    stat.ino !== identity.ino
  ) {
    fail("result", "temporary result leaf changed during publication");
  }
  const bytes = await readOpenedRegularFile(temporary, root, "result");
  if (!bytes.equals(expectedBytes)) {
    fail("result", "temporary result leaf bytes changed during publication");
  }
}

async function unlinkOwnedTemporary(
  temporary: string,
  identity: { dev: number; ino: number },
): Promise<void> {
  try {
    const stat = await lstat(temporary);
    if (stat.dev !== identity.dev || stat.ino !== identity.ino) return;
    await unlink(temporary);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function openNonsymlinkDirectory(directory: string) {
  try {
    const handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isDirectory()) {
      await handle.close();
      fail("result", "result directory must be a directory");
    }
    return handle;
  } catch (error) {
    if (error instanceof AnalysisFilesError) throw error;
    fail(
      "result",
      "result directory could not be opened without following links",
    );
  }
}

async function assertSameDirectory(
  directory: string,
  handle: Awaited<ReturnType<typeof open>>,
): Promise<void> {
  const opened = await handle.stat();
  const current = await lstat(directory);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    opened.dev !== current.dev ||
    opened.ino !== current.ino
  ) {
    fail("result", "result directory changed during publication");
  }
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(
  category: AnalysisFilesError["category"],
  message: string,
): never {
  throw new AnalysisFilesError(category, message);
}
