import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { requireDirectEphemeralChild } from "./paths.js";

const execFileAsync = promisify(execFile);

/** Caller-retained original-artifact custody, never recovered from scratch. */
export interface ReviewAnalysisBinding {
  schema: "pr-review/original-artifact/v1";
  producer: "pr-review/analysis";
  operation_id: string;
  repository: string;
  pr_number: number;
  worktree_path: string;
  old_head: string;
  resource: string;
  dev: string;
  ino: string;
  production: "allocated" | "sealed";
  entries: { name: string; sha256: string; dev: string; ino: string }[];
}

const analysisContext = new AsyncLocalStorage<ReviewAnalysisBinding>();

export function reviewArtifactPath(legacyPath: string): string {
  const binding = analysisContext.getStore();
  return binding === undefined
    ? legacyPath
    : `${binding.resource}/${path.posix.basename(legacyPath)}`;
}

export function requireReviewArtifactPath(file: string): void {
  const binding = analysisContext.getStore();
  if (binding === undefined) {
    requireDirectEphemeralChild(file);
    return;
  }
  if (!file.startsWith(`${binding.resource}/`))
    fail("analysis artifact root mismatch");
  const leaf = file.slice(binding.resource.length + 1);
  requireDirectEphemeralChild(`.ephemeral/${leaf}`);
}

export function currentReviewAnalysis(): ReviewAnalysisBinding | undefined {
  return analysisContext.getStore();
}

export function requireWritableAnalysis(): void {
  if (analysisContext.getStore()?.production === "sealed") {
    fail("sealed analysis is read-only; use the separate posting workflow");
  }
}

export async function withReviewAnalysis<T>(
  raw: string | undefined,
  run: () => Promise<T>,
  expected: {
    repository?: string;
    prNumber?: number;
    reviewHeadSha?: string;
  } = {},
): Promise<T> {
  if (raw === undefined) return run();
  const binding = parseBinding(raw);
  await validateBinding(binding, expected);
  const result = await analysisContext.run(binding, run);
  await validateBinding(binding, expected);
  return result;
}

export async function runAnalysisOperation(command: string): Promise<string> {
  if (command === "allocate-analysis") {
    const root = await sourceRoot();
    const repository = process.env.REPOSITORY ?? "";
    const prNumber = Number(process.env.PR_NUMBER);
    const head = await gitHead();
    if (
      !/^[^/\s]+\/[^/\s]+$/u.test(repository) ||
      !Number.isSafeInteger(prNumber) ||
      prNumber <= 0 ||
      process.env.HEAD_SHA !== head
    ) {
      fail("analysis allocation requires repository, PR and current head");
    }
    await guardParent(root, true);
    const resource = (
      await mkdtemp(".ephemeral/pr-review-analysis-")
    ).replaceAll("\\", "/");
    const identity = await lstat(resource, { bigint: true });
    const binding: ReviewAnalysisBinding = {
      schema: "pr-review/original-artifact/v1",
      producer: "pr-review/analysis",
      operation_id: path.basename(resource),
      repository,
      pr_number: prNumber,
      worktree_path: root,
      old_head: head,
      resource,
      dev: identity.dev.toString(),
      ino: identity.ino.toString(),
      production: "allocated",
      entries: [],
    };
    return JSON.stringify(binding);
  }
  const raw = process.env.REVIEW_ANALYSIS_BINDING;
  if (raw === undefined) fail("REVIEW_ANALYSIS_BINDING is required");
  const binding = parseBinding(raw);
  if (command === "dispose-analysis") {
    await validateSource(binding, false);
    if (!(await lstat(binding.resource).catch(missingOnly))) {
      return JSON.stringify({
        resource: binding.resource,
        outcome: "already-absent",
      });
    }
    // Check the full remaining set before deleting any entry, including on retry.
    const present = await snapshot(binding);
    if (binding.production !== "sealed" && present.length !== 0)
      fail("nonempty analysis disposal requires sealed original custody");
    for (const entry of present) {
      const original = binding.entries.find((item) => item.name === entry.name);
      if (original === undefined || !sameEntry(entry, original))
        fail("analysis cleanup entry changed or unknown");
    }
    const { stdout } = await execFileAsync("git", [
      "ls-files",
      "-z",
      "--",
      binding.resource,
    ]);
    if (stdout !== "") fail("analysis cleanup cannot remove tracked evidence");
    for (const entry of present) {
      const current = await snapshot(binding);
      if (
        !current.every((item) =>
          binding.entries.some((original) => sameEntry(item, original)),
        )
      ) {
        fail("analysis cleanup entries changed");
      }
      await unlink(`${binding.resource}/${entry.name}`);
    }
    await snapshot(binding);
    await rmdir(binding.resource);
    if (await lstat(binding.resource).catch(missingOnly))
      fail("analysis cleanup absence not verified");
    return JSON.stringify({ resource: binding.resource, outcome: "removed" });
  }
  await validateBinding(binding);
  if (command === "analysis-root") return binding.resource;
  if (command === "analysis-write-root") {
    if (binding.production !== "allocated")
      fail("sealed analysis is read-only");
    return binding.resource;
  }
  if (command !== "seal-analysis") fail("unknown analysis operation");
  const entries = await snapshot(binding);
  if (entries.length === 0) fail("analysis production has no bytes");
  return JSON.stringify({ ...binding, production: "sealed", entries });
}

function parseBinding(raw: string): ReviewAnalysisBinding {
  let value: ReviewAnalysisBinding;
  try {
    value = JSON.parse(raw) as ReviewAnalysisBinding;
  } catch {
    fail("analysis binding must be valid JSON");
  }
  const keys = [
    "schema",
    "producer",
    "operation_id",
    "repository",
    "pr_number",
    "worktree_path",
    "old_head",
    "resource",
    "dev",
    "ino",
    "production",
    "entries",
  ];
  if (
    value === null ||
    typeof value !== "object" ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.schema !== "pr-review/original-artifact/v1" ||
    value.producer !== "pr-review/analysis" ||
    !/^\.ephemeral\/pr-review-analysis-[A-Za-z0-9]+$/u.test(value.resource) ||
    value.operation_id !== path.posix.basename(value.resource) ||
    !/^[^/\s]+\/[^/\s]+$/u.test(value.repository) ||
    !Number.isSafeInteger(value.pr_number) ||
    value.pr_number <= 0 ||
    typeof value.worktree_path !== "string" ||
    !path.isAbsolute(value.worktree_path) ||
    !/^[a-f0-9]{40}$/u.test(value.old_head) ||
    !identityValue(value.dev) ||
    !identityValue(value.ino) ||
    !["allocated", "sealed"].includes(value.production) ||
    !Array.isArray(value.entries)
  )
    fail("invalid original analysis binding");
  const names = new Set<string>();
  for (const entry of value.entries) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      Object.keys(entry).sort().join() !== "dev,ino,name,sha256" ||
      typeof entry.name !== "string" ||
      !/^[A-Za-z0-9_.-]+$/u.test(entry.name) ||
      entry.name === "." ||
      entry.name === ".." ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
      !identityValue(entry.dev) ||
      !identityValue(entry.ino) ||
      names.has(entry.name)
    )
      fail("invalid analysis snapshot entry");
    names.add(entry.name);
  }
  if (value.production === "allocated" && value.entries.length !== 0)
    fail("allocated analysis must not claim sealed entries");
  return value;
}

function identityValue(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value);
}

async function validateBinding(
  binding: ReviewAnalysisBinding,
  expected: {
    repository?: string;
    prNumber?: number;
    reviewHeadSha?: string;
  } = {},
): Promise<void> {
  await validateSource(binding, true);
  if (
    (expected.repository !== undefined &&
      expected.repository !== binding.repository) ||
    (expected.prNumber !== undefined &&
      expected.prNumber !== binding.pr_number) ||
    (expected.reviewHeadSha !== undefined &&
      expected.reviewHeadSha !== binding.old_head)
  )
    fail("analysis source identity mismatch");
  const entries = await snapshot(binding);
  if (
    binding.production === "sealed" &&
    (entries.length !== binding.entries.length ||
      entries.some(
        (entry, index) =>
          !sameEntry(
            entry,
            binding.entries[index] as ReviewAnalysisBinding["entries"][number],
          ),
      ))
  )
    fail("sealed analysis entries changed");
}

function sameEntry(
  left: ReviewAnalysisBinding["entries"][number],
  right: ReviewAnalysisBinding["entries"][number],
): boolean {
  return (
    left.name === right.name &&
    left.sha256 === right.sha256 &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

async function validateSource(
  binding: ReviewAnalysisBinding,
  currentHead: boolean,
): Promise<void> {
  if ((await sourceRoot()) !== binding.worktree_path)
    fail("analysis source root mismatch");
  await guardParent(binding.worktree_path, false);
  if (currentHead && (await gitHead()) !== binding.old_head)
    fail("analysis source head mismatch");
  if (
    (process.env.REPOSITORY !== undefined &&
      process.env.REPOSITORY !== binding.repository) ||
    (process.env.PR_NUMBER !== undefined &&
      Number(process.env.PR_NUMBER) !== binding.pr_number) ||
    (currentHead &&
      process.env.HEAD_SHA !== undefined &&
      process.env.HEAD_SHA !== binding.old_head)
  )
    fail("analysis source identity mismatch");
}

async function snapshot(
  binding: ReviewAnalysisBinding,
): Promise<ReviewAnalysisBinding["entries"]> {
  const before = await lstat(binding.resource, { bigint: true });
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    before.dev.toString() !== binding.dev ||
    before.ino.toString() !== binding.ino
  )
    fail("analysis directory identity changed");
  const entries: ReviewAnalysisBinding["entries"] = [];
  for (const name of (await readdir(binding.resource)).sort()) {
    if (!/^[A-Za-z0-9_.-]+$/u.test(name) || name === ".git")
      fail("invalid analysis entry name");
    const leaf = `${binding.resource}/${name}`;
    const first = await lstat(leaf, { bigint: true });
    if (!first.isFile() || first.isSymbolicLink())
      fail("analysis entries must be regular nonsymlink files");
    const bytes = await readFile(leaf);
    const last = await lstat(leaf, { bigint: true });
    if (
      !last.isFile() ||
      last.isSymbolicLink() ||
      first.dev !== last.dev ||
      first.ino !== last.ino ||
      first.size !== last.size ||
      first.mtimeNs !== last.mtimeNs
    )
      fail("analysis entry changed during capture");
    entries.push({
      name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      dev: first.dev.toString(),
      ino: first.ino.toString(),
    });
  }
  const after = await lstat(binding.resource, { bigint: true });
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  )
    fail("analysis directory identity changed");
  return entries;
}

async function guardParent(root: string, create: boolean): Promise<void> {
  const parent = path.join(root, ".ephemeral");
  if (create) await mkdir(parent, { recursive: true });
  const entry = await lstat(parent);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (await realpath(parent)) !== parent
  )
    fail("analysis parent must be physical .ephemeral directory");
}

async function sourceRoot(): Promise<string> {
  const { stdout } = await execFileAsync("git", [
    "rev-parse",
    "--show-toplevel",
  ]);
  const root = await realpath(stdout.trim());
  if ((await realpath(process.cwd())) !== root)
    fail("analysis commands require repository root cwd");
  return root;
}

async function gitHead(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
  return stdout.trim();
}

function missingOnly(error: NodeJS.ErrnoException): null {
  if (error.code !== "ENOENT") throw error;
  return null;
}

function fail(message: string): never {
  throw new Error(message);
}
