import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";
import {
  buildApprovedReviewPayload,
  diffHunkForLine,
  gateResultForApprovalTerminalState,
  runReviewArtifactsCommand,
} from "./review-artifacts.js";

const execFileAsync = promisify(execFile);
const originalCwd = process.cwd();

type JsonObject = Record<string, unknown>;

const PROVIDER_EVIDENCE_SCHEMA = "pr-review/provider-scope-evidence/v2";
const DIGEST_PROVENANCE_SCHEMA = "pr-review/digest-provenance/v1";
const CANONICAL_GIT_DIFF_DIALECT = "canonical-git-diff/v1";
const GITHUB_PROVIDER_DIFF_DIALECT = "github-provider-diff/v1";

afterEach(() => {
  process.chdir(originalCwd);
});

async function cleanupRiskSignalsWorkspace(cwd: string): Promise<void> {
  process.chdir(originalCwd);
  await cleanupTempDir(cwd);
}

async function makeRiskSignalsWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-risk-signals-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, headSha };
}

async function makeProviderScopeWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const workspace = await makeRiskSignalsWorkspace();
  process.chdir(workspace.cwd);
  return workspace;
}

async function makeProviderMultiFileWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-provider-files-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await writeFile(path.join(cwd, "src/other.ts"), "export const other = 2;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app files"], {
    cwd,
  });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

async function makeProviderEmptyDiffWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-provider-empty-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await execFileAsync(
    "git",
    ["commit", "--allow-empty", "-m", "test: empty topic"],
    { cwd },
  );
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

async function makeProviderMovingBaseWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  advancedBaseSha: string;
  headSha: string;
}> {
  const workspace = await makeProviderScopeWorkspace();
  const { cwd, baseSha, headSha } = workspace;
  await execFileAsync("git", ["switch", "main"], { cwd });
  await mkdir(path.join(cwd, "docs"), { recursive: true });
  await writeFile(path.join(cwd, "docs/base-only.md"), "base-only\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "docs: advance base"], {
    cwd,
  });
  const advancedBaseSha = await git(cwd, "rev-parse", "HEAD");
  await execFileAsync("git", ["switch", "topic"], { cwd });
  process.chdir(cwd);
  return { cwd, baseSha, advancedBaseSha, headSha };
}

async function makeProviderBinaryWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-provider-binary-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await mkdir(path.join(cwd, "assets"), { recursive: true });
  await writeFile(path.join(cwd, "assets/blob.bin"), Buffer.from([0, 1, 2, 0]));
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "test: add binary asset"], {
    cwd,
  });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

async function makeProviderDiffDriverWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-provider-diff-driver-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, ".gitattributes"), "*.ts diff=poison\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function gitRaw(
  cwd: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    env: options.env,
    maxBuffer: options.maxBuffer,
  });
  return stdout;
}

async function canonicalGitDiffRaw(
  cwd: string,
  range: string,
  pathspecs: readonly string[] = [],
  options: { literalPathspecs?: boolean; maxBuffer?: number } = {},
): Promise<string> {
  return canonicalGitDiffRawWithArgs(
    cwd,
    [range, ...(pathspecs.length > 0 ? ["--", ...pathspecs] : [])],
    options,
  );
}

async function canonicalGitDiffRawWithArgs(
  cwd: string,
  args: readonly string[],
  options: { literalPathspecs?: boolean; maxBuffer?: number } = {},
): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "devcanon-test-diff-"));
  const orderFile = path.join(tempDir, "orderfile");
  const attributesFile = path.join(tempDir, "attributes");
  const globalConfigFile = path.join(tempDir, "global-config");
  await writeFile(orderFile, "");
  await writeFile(attributesFile, "");
  await writeFile(globalConfigFile, "");
  try {
    return await gitRaw(
      cwd,
      [
        ...(options.literalPathspecs === true ? ["--literal-pathspecs"] : []),
        "-c",
        "diff.noprefix=false",
        "-c",
        "diff.mnemonicPrefix=false",
        "-c",
        "diff.srcPrefix=a/",
        "-c",
        "diff.dstPrefix=b/",
        "-c",
        "diff.relative=false",
        "-c",
        "core.abbrev=40",
        "-c",
        "diff.abbrev=40",
        "-c",
        "diff.context=3",
        "-c",
        "diff.interHunkContext=0",
        "-c",
        "diff.algorithm=myers",
        "-c",
        "diff.renames=true",
        "-c",
        "diff.renameLimit=0",
        "-c",
        "diff.color=false",
        "-c",
        "color.ui=false",
        "-c",
        "core.quotePath=true",
        "-c",
        "diff.suppressBlankEmpty=false",
        "-c",
        "diff.indentHeuristic=false",
        "-c",
        `diff.orderFile=${orderFile}`,
        "-c",
        `core.attributesFile=${attributesFile}`,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--find-renames",
        "--diff-algorithm=myers",
        "--unified=3",
        "--inter-hunk-context=0",
        ...args,
      ],
      {
        env: {
          ...canonicalGitTestEnv(),
          GIT_EXTERNAL_DIFF: undefined,
          GIT_DIFF_OPTS: undefined,
          GIT_ATTR_SOURCE: undefined,
          GIT_CONFIG_GLOBAL: globalConfigFile,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_ATTR_NOSYSTEM: "1",
        },
        maxBuffer: options.maxBuffer,
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function canonicalGitTestEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_CONFIG") && key !== "GIT_CONFIG_PARAMETERS",
    ),
  );
}

async function makeProviderRenameWorkspace(edited: boolean): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-rename-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(
    path.join(cwd, "src/old.ts"),
    [
      "export const value1 = 1;",
      "export const value2 = 2;",
      "export const value3 = 3;",
      "export const value4 = 4;",
      "export const value5 = 5;",
      "export const value6 = 6;",
      "",
    ].join("\n"),
  );
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await execFileAsync("git", ["mv", "src/old.ts", "src/new.ts"], { cwd });
  if (edited) {
    await writeFile(
      path.join(cwd, "src/new.ts"),
      [
        "export const value1 = 1;",
        "export const value2 = 2;",
        "export const value3 = 3;",
        "export const value4 = 4;",
        "export const value5 = 5;",
        "export const value6 = 6;",
        "export const renamed = true;",
        "",
      ].join("\n"),
    );
  }
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "refactor: rename file"], {
    cwd,
  });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

async function makeProviderLeadingColonWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-leading-colon-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await writeFile(path.join(cwd, ":(top)README.md"), "literal path\n");
  await execFileAsync(
    "git",
    ["--literal-pathspecs", "add", ":(top)README.md"],
    {
      cwd,
    },
  );
  await execFileAsync("git", ["commit", "-m", "test: add literal path"], {
    cwd,
  });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

async function makeProviderLeadingColonRenameWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-leading-colon-rename-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(
    path.join(cwd, ":old.ts"),
    [
      "export const value1 = 1;",
      "export const value2 = 2;",
      "export const value3 = 3;",
      "export const value4 = 4;",
      "export const value5 = 5;",
      "",
    ].join("\n"),
  );
  await execFileAsync("git", ["--literal-pathspecs", "add", ":old.ts"], {
    cwd,
  });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await execFileAsync(
    "git",
    ["--literal-pathspecs", "mv", ":old.ts", ":new.ts"],
    { cwd },
  );
  await writeFile(
    path.join(cwd, ":new.ts"),
    [
      "export const value1 = 1;",
      "export const value2 = 2;",
      "export const value3 = 3;",
      "export const value4 = 4;",
      "export const value5 = 5;",
      "export const renamed = true;",
      "",
    ].join("\n"),
  );
  await execFileAsync("git", ["--literal-pathspecs", "add", ":new.ts"], {
    cwd,
  });
  await execFileAsync("git", ["commit", "-m", "refactor: rename literal"], {
    cwd,
  });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

async function makeProviderLargeDiffWorkspace(): Promise<{
  cwd: string;
  baseSha: string;
  headSha: string;
}> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-large-diff-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");

  await execFileAsync("git", ["switch", "-c", "topic"], { cwd });
  await writeFile(
    path.join(cwd, "large.txt"),
    `${"x".repeat(65 * 1024 * 1024)}\n`,
  );
  await execFileAsync("git", ["add", "large.txt"], { cwd });
  await execFileAsync("git", ["commit", "-m", "test: add large text"], {
    cwd,
  });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  process.chdir(cwd);
  return { cwd, baseSha, headSha };
}

function riskSignalsArtifact(
  baseSha: string,
  headSha: string,
  overrides: JsonObject = {},
): JsonObject {
  return {
    schema: "branch-review/risk-signals/v1",
    producer: "play-subagent-execution",
    evidence_source: {
      kind: "executor-terminal-handoff",
      path: ".ephemeral/example-plan.md",
      summary: "Derived from executor task routing and terminal review state.",
    },
    reviewed_base_ref: "main",
    reviewed_base_sha: baseSha,
    reviewed_head_sha: headSha,
    reviewed_range: "main...HEAD",
    changed_files: ["src/app.ts"],
    signals: {
      user_facing_behavior: "none",
      documentation_examples: "unknown",
      diagnostics: "none",
      contract: "present",
      generated_output: "none",
      governance_path: "present",
    },
    canonical_docs_may_be_affected: true,
    end_user_diagnostics_may_be_affected: false,
    ...overrides,
  };
}

function contractExampleDisciplineContext(overrides: JsonObject = {}) {
  return {
    present: true,
    source: "extracted-plan-task-execution-context",
    obligations:
      "Contract Example Discipline requires valid examples to pass and invalid families to fail.",
    consumer_rule:
      "Contract Example Discipline Consumer Rule: enforce present obligations only.",
    proof_obligations: {
      valid_examples_pass: true,
      invalid_families_fail: true,
    },
    ...overrides,
  };
}

function riskSignalsArgs(
  headSha: string,
  file = ".ephemeral/topic-risk-signals.json",
  expectedReviewedRange = "main...HEAD",
) {
  return [
    "validate-risk-signals",
    "--surface",
    "branch-review",
    "--head-sha",
    headSha,
    "--risk-signals-file",
    file,
    "--expected-schema",
    "branch-review/risk-signals/v1",
    "--expected-reviewed-range",
    expectedReviewedRange,
  ];
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function providerEvidenceFileEntry(
  cwd: string,
  baseSha: string,
  headSha: string,
  filePath = "src/app.ts",
  options: { literalPathspecs?: boolean; maxBuffer?: number } = {},
): Promise<JsonObject> {
  const patch = await canonicalGitDiffRaw(
    cwd,
    `${baseSha}..${headSha}`,
    [filePath],
    options,
  );
  return {
    path: filePath,
    status: "added",
    previous_path: null,
    additions: 1,
    deletions: 0,
    changes: 1,
    patch_sha256: sha256(patch),
    patch_available: true,
  };
}

function unavailablePatchEntry(entry: JsonObject): JsonObject {
  return {
    ...entry,
    patch_sha256: null,
    patch_available: false,
  };
}

function binaryUnavailablePatchEntry(filePath: string): JsonObject {
  return {
    path: filePath,
    status: "added",
    previous_path: null,
    additions: 0,
    deletions: 0,
    changes: 0,
    patch_sha256: null,
    patch_available: false,
  };
}

function providerNativeDiffProvenance(): JsonObject {
  return {
    schema: DIGEST_PROVENANCE_SCHEMA,
    provider_diff: GITHUB_PROVIDER_DIFF_DIALECT,
    local_diff: CANONICAL_GIT_DIFF_DIALECT,
    provider_patches: CANONICAL_GIT_DIFF_DIALECT,
    local_patches: CANONICAL_GIT_DIFF_DIALECT,
  };
}

async function providerRenameEvidenceFileEntry(
  cwd: string,
  baseSha: string,
  headSha: string,
  paths: { previousPath: string; path: string } = {
    previousPath: "src/old.ts",
    path: "src/new.ts",
  },
  options: { literalPathspecs?: boolean; maxBuffer?: number } = {},
): Promise<JsonObject> {
  const range = `${baseSha}..${headSha}`;
  const numstat = await gitRaw(
    cwd,
    [
      ...(options.literalPathspecs === true ? ["--literal-pathspecs"] : []),
      "diff",
      "--numstat",
      "-z",
      "--find-renames",
      range,
      "--",
      paths.previousPath,
      paths.path,
    ],
    { maxBuffer: options.maxBuffer },
  );
  const [additionsRaw, deletionsRaw] = numstat.split(/\s+/u);
  const additions = Number(additionsRaw);
  const deletions = Number(deletionsRaw);
  const patch = await canonicalGitDiffRaw(
    cwd,
    range,
    [paths.previousPath, paths.path],
    options,
  );
  return {
    path: paths.path,
    status: "renamed",
    previous_path: paths.previousPath,
    additions,
    deletions,
    changes: additions + deletions,
    patch_sha256: sha256(patch),
    patch_available: true,
  };
}

function providerScopeEvidencePath(headSha: string): string {
  return `.ephemeral/topic-${headSha}-provider-scope-evidence.json`;
}

async function providerScopeEvidence(
  cwd: string,
  baseSha: string,
  headSha: string,
  overrides: JsonObject = {},
  options: { maxBuffer?: number } = {},
): Promise<JsonObject> {
  const fullDiff = await canonicalGitDiffRaw(
    cwd,
    `${baseSha}..${headSha}`,
    [],
    {
      maxBuffer: options.maxBuffer,
    },
  );
  const hasExplicitFileEntries =
    Object.hasOwn(overrides, "provider_files") &&
    Object.hasOwn(overrides, "local_files");
  const fileEntry = hasExplicitFileEntries
    ? null
    : await providerEvidenceFileEntry(cwd, baseSha, headSha);
  return {
    schema: PROVIDER_EVIDENCE_SCHEMA,
    provider: "github",
    repository: "owner/repo",
    pr_number: 480,
    baseRefOid: baseSha,
    headRefOid: headSha,
    provider_pr_diff_base_sha: baseSha,
    local_review_head_sha: headSha,
    full_pr_diff_range: `${baseSha}..${headSha}`,
    evidence_complete: true,
    digest_provenance: {
      schema: DIGEST_PROVENANCE_SCHEMA,
      provider_diff: CANONICAL_GIT_DIFF_DIALECT,
      local_diff: CANONICAL_GIT_DIFF_DIALECT,
      provider_patches: CANONICAL_GIT_DIFF_DIALECT,
      local_patches: CANONICAL_GIT_DIFF_DIALECT,
    },
    provider_files: fileEntry === null ? [] : [fileEntry],
    local_files: fileEntry === null ? [] : [fileEntry],
    provider_diff_sha256: sha256(fullDiff),
    local_diff_sha256: sha256(fullDiff),
    ...overrides,
  };
}

async function providerScopeDecision(
  cwd: string,
  baseSha: string,
  headSha: string,
  evidencePath?: string,
  overrides: JsonObject = {},
): Promise<JsonObject> {
  const providerEvidencePath =
    evidencePath ?? providerScopeEvidencePath(headSha);
  const evidenceContent = await readFile(
    path.join(cwd, providerEvidencePath),
    "utf-8",
  );
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    selected_range: `${baseSha}..${headSha}`,
    full_range: `${baseSha}..${headSha}`,
    candidate_narrow_range: `${baseSha}..${headSha}`,
    is_followup_narrow: false,
    selection_reason: "Initial PR review uses the provider-proven PR range.",
    escalation_reasons: ["not-followup"],
    last_reviewed_sha: null,
    head_sha: headSha,
    changed_files: ["src/app.ts"],
    language_hints: ["ts"],
    prior_context: { kind: "none", path: null },
    mechanical_facts: {
      changed_file_count: 1,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: {
      checked: true,
      ambiguous: false,
      notes: "No semantic narrowing for initial PR review.",
    },
    artifacts: {
      provider_scope_evidence_file: providerEvidencePath,
      provider_scope_evidence_sha256: sha256(evidenceContent),
    },
    ...overrides,
  };
}

function providerScopeArgs(
  headSha: string,
  baseRef = "main",
  evidencePath = providerScopeEvidencePath(headSha),
) {
  return [
    "validate-scope-decision",
    "--surface",
    "pr-review",
    "--head-sha",
    headSha,
    "--base-ref",
    baseRef,
    "--scope-decision-file",
    ".ephemeral/topic-scope-decision.json",
    "--expected-schema",
    "pr-review/scope-decision/v1",
    "--expected-prior-context-kind",
    "none",
    "--expected-prior-context-path",
    "null",
    "--governed-path-pattern",
    "^(docs/)",
    "--max-narrow-changed-files",
    "5",
    "--provider-scope-evidence-file",
    evidencePath,
  ];
}

describe("review artifact runtime reducers", () => {
  it("finds right-side diff hunks for inline review lines", () => {
    const diffText = [
      "diff --git a/src/app.ts b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      " export const a = 1;",
      "+export const b = 2;",
      "@@ -20,3 +21,4 @@",
      " export const y = 25;",
      "+export const z = 26;",
      "",
    ].join("\n");

    expect(diffHunkForLine(diffText, 2)).toBe(1);
    expect(diffHunkForLine(diffText, 22)).toBe(2);
    expect(diffHunkForLine(diffText, 50)).toBeNull();
  });

  it("builds the approved review payload from findings and review body", () => {
    const payload = buildApprovedReviewPayload({
      headSha: "a".repeat(40),
      reviewEvent: "COMMENT",
      reviewBody: "Body\n",
      findings: {
        schema: "play-review/findings/v1",
        findings: [
          {
            path: "src/app.ts",
            line: 2,
            start_line: null,
            severity: "Blocking",
            category: "Logic",
            critic: "VALID",
            anchor: "natural",
            why: "why",
            recommendation: "recommendation",
            body: "Inline body.",
          },
          {
            path: "src/missing.ts",
            line: 1,
            severity: "Blocking",
            category: "Safety",
            critic: null,
            anchor: "missing-file",
            why: "why",
            recommendation: "recommendation",
            body: "Missing body.",
          },
        ],
        carry_forward: [
          {
            path: "docs/old.md",
            line: 3,
            severity: "Blocking",
            category: "Documentation",
            critic: "VALID",
            anchor: "out-of-diff",
            why: "why",
            recommendation: "recommendation",
            body: "Carry forward body.",
          },
        ],
      },
    });

    expect(payload).toEqual({
      commit_id: "a".repeat(40),
      event: "COMMENT",
      body: "Body\n\n## Out-of-diff Findings\n\nCarry forward body.",
      comments: [
        {
          path: "src/app.ts",
          line: 2,
          side: "RIGHT",
          body: "Inline body.",
        },
        {
          path: "src/missing.ts",
          line: 1,
          side: "RIGHT",
          body: "Missing-file finding (no natural anchor — see body):\n\nMissing body.",
        },
      ],
    });
  });

  it("maps approval terminal states to gate results centrally", () => {
    expect(gateResultForApprovalTerminalState("approved")).toBe("passing");
    expect(gateResultForApprovalTerminalState("approved_with_nits")).toBe(
      "passing",
    );
    expect(gateResultForApprovalTerminalState("blocked")).toBe("blocking");
    expect(gateResultForApprovalTerminalState("invalid")).toBe("blocking");
  });

  it("validates pr-review scope decisions against provider-proven evidence", async () => {
    const { cwd, baseSha, headSha } = await makeProviderScopeWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("accepts provider-pinned initial review scope when the local base ref has advanced", async () => {
    const { cwd, baseSha, advancedBaseSha, headSha } =
      await makeProviderMovingBaseWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          baseRefOid: advancedBaseSha,
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha, "main")),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("rejects moving-base evidence that omits base-only file deletions", async () => {
    const { cwd, baseSha, advancedBaseSha, headSha } =
      await makeProviderMovingBaseWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    const movingBaseRange = `${advancedBaseSha}..${headSha}`;
    try {
      const movingBaseDiff = await canonicalGitDiffRaw(cwd, movingBaseRange);
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          baseRefOid: advancedBaseSha,
          provider_pr_diff_base_sha: advancedBaseSha,
          full_pr_diff_range: movingBaseRange,
          provider_diff_sha256: sha256(movingBaseDiff),
          local_diff_sha256: sha256(movingBaseDiff),
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, advancedBaseSha, headSha, undefined, {
          selection_reason:
            "Incorrectly treats the moving local base as the full PR range.",
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha, "main")),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining(
          "provider PR diff base must be a strict ancestor of head",
        ),
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("accepts unavailable text evidence with provider-native full diff drift", async () => {
    const { cwd, baseSha, headSha } = await makeProviderScopeWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      const fileEntry = unavailablePatchEntry(
        await providerEvidenceFileEntry(cwd, baseSha, headSha),
      );
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [fileEntry],
          local_files: [fileEntry],
          provider_diff_sha256: "b".repeat(64),
          digest_provenance: providerNativeDiffProvenance(),
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("accepts binary provider evidence with unavailable patches", async () => {
    const { cwd, baseSha, headSha } = await makeProviderBinaryWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      const fileEntry = binaryUnavailablePatchEntry("assets/blob.bin");
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [fileEntry],
          local_files: [fileEntry],
          provider_diff_sha256: "b".repeat(64),
          digest_provenance: providerNativeDiffProvenance(),
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: ["assets/blob.bin"],
          language_hints: ["bin"],
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("accepts all-unavailable provider-native provenance when full diff digests match", async () => {
    const { cwd, baseSha, headSha } = await makeProviderBinaryWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      const fileEntry = binaryUnavailablePatchEntry("assets/blob.bin");
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [fileEntry],
          local_files: [fileEntry],
          digest_provenance: providerNativeDiffProvenance(),
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: ["assets/blob.bin"],
          language_hints: ["bin"],
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("rejects linked-worktree common info attributes before canonical diff hashing", async () => {
    const source = await makeRiskSignalsWorkspace();
    const linkedCwd = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-linked-provider-"),
    );
    try {
      await execFileAsync("git", ["switch", "main"], { cwd: source.cwd });
      await execFileAsync("git", ["worktree", "add", linkedCwd, "topic"], {
        cwd: source.cwd,
      });
      await mkdir(path.join(linkedCwd, ".ephemeral"));
      process.chdir(linkedCwd);
      const evidencePath = providerScopeEvidencePath(source.headSha);
      await writeJson(
        linkedCwd,
        evidencePath,
        await providerScopeEvidence(linkedCwd, source.baseSha, source.headSha),
      );
      await writeJson(
        linkedCwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(linkedCwd, source.baseSha, source.headSha),
      );
      const commonGitDir = await git(
        linkedCwd,
        "rev-parse",
        "--git-common-dir",
      );
      await writeFile(
        path.join(
          path.isAbsolute(commonGitDir)
            ? commonGitDir
            : path.resolve(linkedCwd, commonGitDir),
          "info",
          "attributes",
        ),
        "*.ts diff=ambient\n",
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(source.headSha)),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining(
          "canonical diff driver discovery failed",
        ),
      });
    } finally {
      process.chdir(originalCwd);
      await execFileAsync("git", ["worktree", "remove", "--force", linkedCwd], {
        cwd: source.cwd,
      }).catch(() => undefined);
      await cleanupTempDir(linkedCwd);
      await cleanupTempDir(source.cwd);
    }
  });

  it("ignores ambient GIT_CONFIG_COUNT diff-driver injection for canonical hashing", async () => {
    const { cwd, baseSha, headSha } = await makeProviderDiffDriverWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    const previousConfigCount = process.env.GIT_CONFIG_COUNT;
    const previousConfigKey = process.env.GIT_CONFIG_KEY_0;
    const previousConfigValue = process.env.GIT_CONFIG_VALUE_0;
    try {
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha),
      );
      process.env.GIT_CONFIG_COUNT = "1";
      process.env.GIT_CONFIG_KEY_0 = "diff.poison.binary";
      process.env.GIT_CONFIG_VALUE_0 = "true";

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      if (previousConfigCount === undefined) {
        Reflect.deleteProperty(process.env, "GIT_CONFIG_COUNT");
      } else {
        process.env.GIT_CONFIG_COUNT = previousConfigCount;
      }
      if (previousConfigKey === undefined) {
        Reflect.deleteProperty(process.env, "GIT_CONFIG_KEY_0");
      } else {
        process.env.GIT_CONFIG_KEY_0 = previousConfigKey;
      }
      if (previousConfigValue === undefined) {
        Reflect.deleteProperty(process.env, "GIT_CONFIG_VALUE_0");
      } else {
        process.env.GIT_CONFIG_VALUE_0 = previousConfigValue;
      }
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it.each([
    { name: "pure rename", edited: false },
    { name: "rename plus edit", edited: true },
  ])(
    "validates pr-review provider evidence for a local $name",
    async ({ edited }) => {
      const { cwd, baseSha, headSha } =
        await makeProviderRenameWorkspace(edited);
      const evidencePath = providerScopeEvidencePath(headSha);
      try {
        const renameEntry = await providerRenameEvidenceFileEntry(
          cwd,
          baseSha,
          headSha,
        );
        await writeJson(
          cwd,
          evidencePath,
          await providerScopeEvidence(cwd, baseSha, headSha, {
            provider_files: [renameEntry],
            local_files: [renameEntry],
          }),
        );
        await writeJson(
          cwd,
          ".ephemeral/topic-scope-decision.json",
          await providerScopeDecision(cwd, baseSha, headSha, undefined, {
            changed_files: ["src/new.ts"],
          }),
        );

        await expect(
          runReviewArtifactsCommand(providerScopeArgs(headSha)),
        ).resolves.toEqual({
          exitCode: 0,
          stdout: "",
          stderr: "",
        });
      } finally {
        await cleanupRiskSignalsWorkspace(cwd);
      }
    },
  );

  it("validates provider evidence for a literal leading-colon path", async () => {
    const { cwd, baseSha, headSha } = await makeProviderLeadingColonWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      const fileEntry = await providerEvidenceFileEntry(
        cwd,
        baseSha,
        headSha,
        ":(top)README.md",
        { literalPathspecs: true },
      );
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [fileEntry],
          local_files: [fileEntry],
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: [":(top)README.md"],
          language_hints: ["md"],
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("rejects provider evidence for a leading-colon path when the patch digest is not literal", async () => {
    const { cwd, baseSha, headSha } = await makeProviderLeadingColonWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      const fileEntry = await providerEvidenceFileEntry(
        cwd,
        baseSha,
        headSha,
        ":(top)README.md",
        { literalPathspecs: true },
      );
      const interpretedPatch = await canonicalGitDiffRaw(
        cwd,
        `${baseSha}..${headSha}`,
        [":(top)README.md"],
      );
      const forgedEntry = {
        ...fileEntry,
        patch_sha256: sha256(interpretedPatch),
      };
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [forgedEntry],
          local_files: [forgedEntry],
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: [":(top)README.md"],
          language_hints: ["md"],
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining(
          "provider/local patch evidence mismatch",
        ),
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("validates provider evidence for a literal leading-colon rename tuple", async () => {
    const { cwd, baseSha, headSha } =
      await makeProviderLeadingColonRenameWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      const renameEntry = await providerRenameEvidenceFileEntry(
        cwd,
        baseSha,
        headSha,
        { previousPath: ":old.ts", path: ":new.ts" },
        { literalPathspecs: true },
      );
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [renameEntry],
          local_files: [renameEntry],
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: [":new.ts"],
          language_hints: ["ts"],
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("rejects leading-colon rename evidence when the patch digest omits one rename side", async () => {
    const { cwd, baseSha, headSha } =
      await makeProviderLeadingColonRenameWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    try {
      const renameEntry = await providerRenameEvidenceFileEntry(
        cwd,
        baseSha,
        headSha,
        { previousPath: ":old.ts", path: ":new.ts" },
        { literalPathspecs: true },
      );
      const currentOnlyPatch = await canonicalGitDiffRaw(
        cwd,
        `${baseSha}..${headSha}`,
        [":new.ts"],
        { literalPathspecs: true },
      );
      const forgedEntry = {
        ...renameEntry,
        patch_sha256: sha256(currentOnlyPatch),
      };
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [forgedEntry],
          local_files: [forgedEntry],
        }),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: [":new.ts"],
          language_hints: ["ts"],
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining(
          "provider/local patch evidence mismatch",
        ),
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("validates provider evidence when canonical diff output exceeds the raw stdout cap", async () => {
    const { cwd, baseSha, headSha } = await makeProviderLargeDiffWorkspace();
    const evidencePath = providerScopeEvidencePath(headSha);
    const largeDiffBuffer = 96 * 1024 * 1024;
    try {
      const fileEntry = await providerEvidenceFileEntry(
        cwd,
        baseSha,
        headSha,
        "large.txt",
        { maxBuffer: largeDiffBuffer },
      );
      await writeJson(
        cwd,
        evidencePath,
        await providerScopeEvidence(
          cwd,
          baseSha,
          headSha,
          {
            provider_files: [fileEntry],
            local_files: [fileEntry],
          },
          { maxBuffer: largeDiffBuffer },
        ),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: ["large.txt"],
          language_hints: ["txt"],
        }),
      );

      await expect(
        runReviewArtifactsCommand(providerScopeArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  }, 20_000);

  it.each([
    {
      name: "missing explicit provider evidence input",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha),
      args: (headSha: string) =>
        providerScopeArgs(headSha).filter(
          (arg) =>
            ![
              "--provider-scope-evidence-file",
              providerScopeEvidencePath(headSha),
            ].includes(arg),
        ),
      stderr: "--provider-scope-evidence-file is required for pr-review",
    },
    {
      name: "non-contract provider evidence path",
      evidencePath: ".ephemeral/topic-provider-scope-evidence.json",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(
          cwd,
          baseSha,
          headSha,
          ".ephemeral/topic-provider-scope-evidence.json",
        ),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha),
      args: (_headSha: string) =>
        providerScopeArgs(
          _headSha,
          "main",
          ".ephemeral/topic-provider-scope-evidence.json",
        ),
      stderr: "provider scope evidence path mismatch",
    },
    {
      name: "moving full range",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha, undefined, {
          selected_range: "main...HEAD",
          full_range: "main...HEAD",
          candidate_narrow_range: "main...HEAD",
        }),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha),
      stderr: "full range must use provider PR diff base",
    },
    {
      name: "unproven baseRefOid",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, { baseRefOid: "main" }),
      stderr: "provider evidence baseRefOid is malformed",
    },
    {
      name: "missing provider evidence file",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha),
      removeEvidenceFile: true,
      stderr: "--provider-scope-evidence-file missing or not a regular file",
    },
    {
      name: "incomplete provider evidence",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, {
          evidence_complete: false,
        }),
      stderr: "provider evidence schema mismatch",
    },
    {
      name: "stale provider head",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, { headRefOid: baseSha }),
      stderr: "provider evidence head mismatch",
    },
    {
      name: "missing provider diff base",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, {
          provider_pr_diff_base_sha: "",
        }),
      stderr: "provider evidence provider_pr_diff_base_sha is malformed",
    },
    {
      name: "duplicate provider files",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const evidence = await providerScopeEvidence(cwd, baseSha, headSha);
        const entry = (evidence.provider_files as JsonObject[])[0];
        return {
          ...evidence,
          provider_files: [entry, entry],
          local_files: [entry, entry],
        };
      },
      stderr: "provider evidence contains duplicate file entries",
    },
    {
      name: "provider/local file mismatch",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const evidence = await providerScopeEvidence(cwd, baseSha, headSha);
        const localEntry = {
          ...(evidence.local_files as JsonObject[])[0],
          additions: 2,
          changes: 2,
        };
        return { ...evidence, local_files: [localEntry] };
      },
      stderr: "provider/local file evidence mismatch",
    },
    {
      name: "provider unavailable while local patch is available",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const availableEntry = await providerEvidenceFileEntry(
          cwd,
          baseSha,
          headSha,
        );
        return providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [unavailablePatchEntry(availableEntry)],
          local_files: [availableEntry],
        });
      },
      stderr: "provider/local patch evidence mismatch",
    },
    {
      name: "provider available while local patch is unavailable",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const availableEntry = await providerEvidenceFileEntry(
          cwd,
          baseSha,
          headSha,
        );
        return providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [availableEntry],
          local_files: [unavailablePatchEntry(availableEntry)],
        });
      },
      stderr: "provider/local patch evidence mismatch",
    },
    {
      name: "provider and local forged metadata differs from canonical git",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const fileEntry = await providerEvidenceFileEntry(
          cwd,
          baseSha,
          headSha,
        );
        const forgedEntry = {
          ...fileEntry,
          additions: 2,
          changes: 2,
        };
        return providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [forgedEntry],
          local_files: [forgedEntry],
        });
      },
      stderr: "local provider evidence does not match git",
    },
    {
      name: "available patch digest differs from canonical git",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const fileEntry = await providerEvidenceFileEntry(
          cwd,
          baseSha,
          headSha,
        );
        const forgedEntry = {
          ...fileEntry,
          patch_sha256: "b".repeat(64),
        };
        return providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [forgedEntry],
          local_files: [forgedEntry],
        });
      },
      stderr: "provider/local patch evidence mismatch",
    },
    {
      name: "provider/local diff mismatch",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, {
          provider_diff_sha256: "b".repeat(64),
        }),
      stderr: "provider/local diff digest mismatch",
    },
    {
      name: "unavailable full diff drift with incompatible provenance",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const fileEntry = unavailablePatchEntry(
          await providerEvidenceFileEntry(cwd, baseSha, headSha),
        );
        return providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [fileEntry],
          local_files: [fileEntry],
          provider_diff_sha256: "b".repeat(64),
        });
      },
      stderr: "provider/local diff digest mismatch",
    },
    {
      name: "empty provider and local file sets with provider-native diff drift",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: [],
          language_hints: [],
          mechanical_facts: {
            changed_file_count: 0,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "not-followup",
          },
        }),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [],
          local_files: [],
          provider_diff_sha256: "b".repeat(64),
          digest_provenance: providerNativeDiffProvenance(),
        }),
      workspace: makeProviderEmptyDiffWorkspace,
      stderr: "provider/local diff digest mismatch",
    },
    {
      name: "mixed available and unavailable provider files with diff mismatch",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha, undefined, {
          changed_files: ["src/app.ts", "src/other.ts"],
          mechanical_facts: {
            changed_file_count: 2,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "not-followup",
          },
        }),
      evidence: async (cwd: string, baseSha: string, headSha: string) => {
        const availableEntry = await providerEvidenceFileEntry(
          cwd,
          baseSha,
          headSha,
          "src/app.ts",
        );
        const unavailableEntry = unavailablePatchEntry(
          await providerEvidenceFileEntry(
            cwd,
            baseSha,
            headSha,
            "src/other.ts",
          ),
        );
        return providerScopeEvidence(cwd, baseSha, headSha, {
          provider_files: [availableEntry, unavailableEntry],
          local_files: [availableEntry, unavailableEntry],
          provider_diff_sha256: "b".repeat(64),
          digest_provenance: providerNativeDiffProvenance(),
        });
      },
      workspace: makeProviderMultiFileWorkspace,
      stderr: "provider/local diff digest mismatch",
    },
    {
      name: "self-range provider diff base",
      scope: async (cwd: string, _baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, headSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, {
          provider_pr_diff_base_sha: headSha,
          full_pr_diff_range: `${headSha}..${headSha}`,
          provider_files: [],
          local_files: [],
        }),
      stderr: "provider PR diff base must be a strict ancestor of head",
    },
    {
      name: "malformed provider evidence",
      scope: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeDecision(cwd, baseSha, headSha),
      evidence: async (cwd: string, baseSha: string, headSha: string) =>
        providerScopeEvidence(cwd, baseSha, headSha, {
          schema: "pr-review/provider-scope-evidence/v1",
        }),
      stderr: "provider evidence schema mismatch",
    },
  ])("rejects invalid pr-review provider evidence: $name", async (testCase) => {
    const makeWorkspace =
      "workspace" in testCase && typeof testCase.workspace === "function"
        ? testCase.workspace
        : makeProviderScopeWorkspace;
    const { cwd, baseSha, headSha } = await makeWorkspace();
    const evidencePath =
      "evidencePath" in testCase && typeof testCase.evidencePath === "string"
        ? testCase.evidencePath
        : providerScopeEvidencePath(headSha);
    try {
      await writeJson(
        cwd,
        evidencePath,
        await testCase.evidence(cwd, baseSha, headSha),
      );
      await writeJson(
        cwd,
        ".ephemeral/topic-scope-decision.json",
        await testCase.scope(cwd, baseSha, headSha),
      );
      if (testCase.removeEvidenceFile === true) {
        await rm(path.join(cwd, evidencePath));
      }

      await expect(
        runReviewArtifactsCommand(
          testCase.args === undefined
            ? providerScopeArgs(headSha)
            : testCase.args(headSha),
        ),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining(testCase.stderr),
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("validates canonical risk-signals artifacts without stdout", async () => {
    const { cwd, baseSha, headSha } = await makeRiskSignalsWorkspace();
    try {
      process.chdir(cwd);
      await writeJson(
        cwd,
        ".ephemeral/topic-risk-signals.json",
        riskSignalsArtifact(baseSha, headSha),
      );

      await expect(
        runReviewArtifactsCommand(riskSignalsArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("validates risk-signals artifacts that use the reviewed base SHA as the range left side", async () => {
    const { cwd, baseSha, headSha } = await makeRiskSignalsWorkspace();
    const reviewedRange = `${baseSha}...HEAD`;
    try {
      process.chdir(cwd);
      await writeJson(
        cwd,
        ".ephemeral/topic-risk-signals.json",
        riskSignalsArtifact(baseSha, headSha, {
          reviewed_base_ref: baseSha,
          reviewed_range: reviewedRange,
        }),
      );

      await expect(
        runReviewArtifactsCommand(
          riskSignalsArgs(
            headSha,
            ".ephemeral/topic-risk-signals.json",
            reviewedRange,
          ),
        ),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("validates risk-signals artifacts with contract example discipline context", async () => {
    const { cwd, baseSha, headSha } = await makeRiskSignalsWorkspace();
    try {
      process.chdir(cwd);
      await writeJson(
        cwd,
        ".ephemeral/topic-risk-signals.json",
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: contractExampleDisciplineContext(),
        }),
      );

      await expect(
        runReviewArtifactsCommand(riskSignalsArgs(headSha)),
      ).resolves.toEqual({
        exitCode: 0,
        stdout: "",
        stderr: "",
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it.each([
    {
      name: "missing required flag names the flag",
      artifact: (_baseSha: string, _headSha: string) => undefined,
      args: (headSha: string) =>
        riskSignalsArgs(headSha).filter(
          (arg) =>
            ![
              "--risk-signals-file",
              ".ephemeral/topic-risk-signals.json",
            ].includes(arg),
        ),
      stderr: "--risk-signals-file is required",
    },
    {
      name: "unknown top-level key",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, { extra: true }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "null contract example discipline context",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: null,
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "array contract example discipline context",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: [],
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "contract example discipline context with extra key",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: contractExampleDisciplineContext({
            extra: true,
          }),
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "contract example discipline context missing proof boolean",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: contractExampleDisciplineContext({
            proof_obligations: { valid_examples_pass: true },
          }),
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "contract example discipline context with false valid examples proof",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: contractExampleDisciplineContext({
            proof_obligations: {
              valid_examples_pass: false,
              invalid_families_fail: true,
            },
          }),
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "contract example discipline context with false invalid families proof",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: contractExampleDisciplineContext({
            proof_obligations: {
              valid_examples_pass: true,
              invalid_families_fail: false,
            },
          }),
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "contract example discipline context with nul",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: contractExampleDisciplineContext({
            obligations: "contains\0nul",
          }),
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "contract example discipline context with oversized text",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: contractExampleDisciplineContext({
            consumer_rule: "x".repeat(4001),
          }),
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "missing required signal",
      artifact: (baseSha: string, headSha: string) => {
        const artifact = riskSignalsArtifact(baseSha, headSha);
        const { contract: _omitted, ...signals } =
          artifact.signals as JsonObject;
        return { ...artifact, signals };
      },
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "invalid signal value",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          signals: {
            ...(riskSignalsArtifact(baseSha, headSha).signals as JsonObject),
            diagnostics: "yes",
          },
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "missing boolean",
      artifact: (baseSha: string, headSha: string) => {
        const { canonical_docs_may_be_affected: _omitted, ...artifact } =
          riskSignalsArtifact(baseSha, headSha);
        return artifact;
      },
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "non-boolean",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          end_user_diagnostics_may_be_affected: "false",
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "schema mismatch",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          schema: "branch-review/risk-signals/v2",
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "malformed head",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, { reviewed_head_sha: "ABC" }),
      stderr: "risk-signals head is malformed",
    },
    {
      name: "stale head",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, { reviewed_head_sha: baseSha }),
      stderr: "risk-signals head mismatch",
    },
    {
      name: "command head is not current repository head",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha),
      args: (headSha: string, baseSha: string) => riskSignalsArgs(baseSha),
      stderr: "--head-sha must match current repository HEAD",
    },
    {
      name: "stale base sha",
      artifact: (_baseSha: string, headSha: string) =>
        riskSignalsArtifact(headSha, headSha),
      stderr: "risk-signals base sha mismatch",
    },
    {
      name: "forged base ref",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, { reviewed_base_ref: "topic" }),
      stderr: "risk-signals base ref mismatch",
    },
    {
      name: "range mismatch",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          reviewed_range: `${baseSha}...HEAD`,
        }),
      stderr: "risk-signals reviewed range mismatch",
    },
    {
      name: "unsafe path",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha),
      args: (headSha: string) =>
        riskSignalsArgs(headSha, ".ephemeral/nested/topic-risk-signals.json"),
      stderr: "nested --risk-signals-file path rejected",
    },
    {
      name: "wrong suffix",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha),
      args: (headSha: string) =>
        riskSignalsArgs(headSha, ".ephemeral/topic-risk.json"),
      stderr: "--risk-signals-file path validation failed",
    },
    {
      name: "irrelevant base-ref flag",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha),
      args: (headSha: string) => [
        ...riskSignalsArgs(headSha),
        "--base-ref",
        "main",
      ],
      stderr: "validate-risk-signals does not accept --base-ref",
    },
    {
      name: "irrelevant emit gate result flag",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha),
      args: (headSha: string) => [
        ...riskSignalsArgs(headSha),
        "--emit-gate-result",
      ],
      stderr: "validate-risk-signals does not accept --emit-gate-result",
    },
    {
      name: "changed-file contradiction",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          changed_files: ["src/other.ts"],
        }),
      stderr: "risk-signals changed files do not match expected range",
    },
    {
      name: "duplicate changed-file entry",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          changed_files: ["src/app.ts", "src/app.ts"],
        }),
      stderr: "risk-signals changed files contain duplicates",
    },
  ])("rejects invalid risk-signals artifacts: $name", async (testCase) => {
    const { cwd, baseSha, headSha } = await makeRiskSignalsWorkspace();
    try {
      process.chdir(cwd);
      const artifact = testCase.artifact(baseSha, headSha);
      if (artifact !== undefined) {
        await writeJson(cwd, ".ephemeral/topic-risk-signals.json", artifact);
        await writeJson(cwd, ".ephemeral/topic-risk.json", artifact);
        await writeJson(
          cwd,
          ".ephemeral/nested/topic-risk-signals.json",
          artifact,
        );
      }

      await expect(
        runReviewArtifactsCommand(
          testCase.args === undefined
            ? riskSignalsArgs(headSha)
            : testCase.args(headSha, baseSha),
        ),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining(testCase.stderr),
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });

  it("rejects malformed risk-signals JSON", async () => {
    const { cwd, headSha } = await makeRiskSignalsWorkspace();
    try {
      process.chdir(cwd);
      await writeFile(
        path.join(cwd, ".ephemeral/topic-risk-signals.json"),
        "{not-json",
      );

      await expect(
        runReviewArtifactsCommand(riskSignalsArgs(headSha)),
      ).resolves.toMatchObject({
        exitCode: 1,
        stderr: expect.stringContaining("risk-signals JSON validation failed"),
      });
    } finally {
      await cleanupRiskSignalsWorkspace(cwd);
    }
  });
});
