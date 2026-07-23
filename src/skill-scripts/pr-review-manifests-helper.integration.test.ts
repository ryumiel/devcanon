import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
} from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-manifests.sh",
);
const leaseHelperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/review-leases.sh",
);
const priorHelperScript = path.join(
  process.cwd(),
  "skills/pr-review/scripts/prior-thread-artifacts.sh",
);
const playReviewHelperScript = path.join(
  process.cwd(),
  "skills/play-review/scripts/review-artifacts.sh",
);
const supportValidatorScript = path.join(
  process.cwd(),
  "skills/play-validate-review-artifacts/scripts/review-artifacts.sh",
);
const runtimeSkillDir = path.join(process.cwd(), "skills/devcanon-runtime");
const symlinkAvailable = await canCreateSymlinks();
const isWindows = process.platform === "win32";
const prNumber = "390";
const phase5InstalledLayoutTestTimeout = 120_000;
const PROVIDER_EVIDENCE_SCHEMA = "pr-review/provider-scope-evidence/v2";
const DIGEST_PROVENANCE_SCHEMA = "pr-review/digest-provenance/v1";
const CANONICAL_GIT_DIFF_DIALECT = "canonical-git-diff/v1";

async function makeGitWorkspace() {
  const logicalCwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-pr-manifest-"),
  );
  const cwd = await realpath(logicalCwd);
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  const baseSha = await git(cwd, "rev-parse", "HEAD");
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src/app.ts"), "export const value = 1;\n");
  await execFileAsync("git", ["add", "."], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add app"], { cwd });
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, baseSha, headSha };
}

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function gitRaw(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function canonicalGitDiffRaw(
  cwd: string,
  range: string,
  pathspecs: readonly string[] = [],
) {
  return gitRaw(
    cwd,
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
    range,
    ...(pathspecs.length > 0 ? ["--", ...pathspecs] : []),
  );
}

async function bashPhysicalCwd(cwd: string) {
  const { stdout } = await execFileAsync("bash", ["-lc", "pwd -P"], { cwd });
  return stdout.trim();
}

async function acceptedPhysicalRoots(cwd: string) {
  return Array.from(
    new Set([cwd, await bashPhysicalCwd(cwd)].map(normalizePathText)),
  );
}

function normalizePathText(value: string) {
  let normalized = value.replace(/\\/gu, "/");
  if (process.platform === "win32") {
    normalized = normalized.replace(
      /^\/([A-Za-z])\//u,
      (_match, drive: string) => `${drive}:/`,
    );
    if (/^[A-Za-z]:\//u.test(normalized)) {
      normalized = normalized.toLowerCase();
    }
  }
  return normalized;
}

function scopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-scope-decision.json`;
}

function providerScopePath(headSha: string, slug = "topic") {
  return `.ephemeral/${slug}-${headSha}-provider-scope-evidence.json`;
}

function priorThreadsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-prior-threads.json`;
}

function findingsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-findings.json`;
}

function reviewBodyPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-review-body.md`;
}

function previewPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-review-preview.md`;
}

function handoffPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-handoff.json`;
}

function resultPath(headSha: string) {
  return `.ephemeral/pr-${prNumber}-${headSha}-result.json`;
}

function initialScope(
  baseSha: string,
  headSha: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    schema: "pr-review/scope-decision/v1",
    surface: "pr-review",
    mode: "initial",
    head_sha: headSha,
    full_range: `${baseSha}..${headSha}`,
    selected_range: `${baseSha}..${headSha}`,
    candidate_narrow_range: `${baseSha}..${headSha}`,
    last_reviewed_sha: null,
    is_followup_narrow: false,
    selection_reason: "Initial review uses the full review range.",
    changed_files: ["src/app.ts"],
    language_hints: ["ts"],
    escalation_reasons: ["not-followup"],
    prior_context: { kind: "none", path: null },
    mechanical_facts: {
      changed_file_count: 1,
      followup_sha_usable: false,
      mechanical_escalate_full: true,
      mechanical_escalation_reason: "not-followup",
    },
    semantic_decision: { checked: true, ambiguous: false, notes: "" },
    ...overrides,
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function providerScopeEvidence(
  cwd: string,
  baseSha: string,
  headSha: string,
) {
  const range = `${baseSha}..${headSha}`;
  const fullDiff = await canonicalGitDiffRaw(cwd, `${baseSha}..${headSha}`);
  const entries = await providerFileEntries(cwd, range);
  return {
    schema: PROVIDER_EVIDENCE_SCHEMA,
    provider: "github",
    repository: "owner/repo",
    pr_number: Number(prNumber),
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
    provider_files: entries,
    local_files: entries,
    provider_diff_sha256: sha256(fullDiff),
    local_diff_sha256: sha256(fullDiff),
  };
}

async function providerFileEntries(cwd: string, range: string) {
  const tokens = (await gitRaw(cwd, "diff", "--name-status", "-z", range))
    .split("\0")
    .filter(Boolean);
  const entries: Record<string, unknown>[] = [];
  for (let index = 0; index < tokens.length; ) {
    const rawStatus = tokens[index] ?? "";
    index += 1;
    const statusCode = rawStatus[0] ?? "";
    let previousPath: string | null = null;
    let filePath = tokens[index] ?? "";
    if (statusCode === "R") {
      previousPath = tokens[index] ?? "";
      filePath = tokens[index + 1] ?? "";
      index += 2;
    } else {
      index += 1;
    }
    const [additionsRaw, deletionsRaw] = (
      await gitRaw(cwd, "diff", "--numstat", "-z", range, "--", filePath)
    ).split(/\s+/u);
    const additions = Number(additionsRaw);
    const deletions = Number(deletionsRaw);
    const patch = await canonicalGitDiffRaw(cwd, range, [filePath]);
    entries.push({
      path: filePath,
      status:
        statusCode === "A"
          ? "added"
          : statusCode === "D"
            ? "removed"
            : statusCode === "R"
              ? "renamed"
              : "modified",
      previous_path: previousPath,
      additions,
      deletions,
      changes: additions + deletions,
      patch_sha256: sha256(patch),
      patch_available: true,
    });
  }
  return entries.sort((left, right) =>
    [String(left.path), String(left.previous_path ?? ""), String(left.status)]
      .join("\0")
      .localeCompare(
        [
          String(right.path),
          String(right.previous_path ?? ""),
          String(right.status),
        ].join("\0"),
      ),
  );
}

function priorThreadsEnvelope(headSha: string) {
  return {
    schema: "pr-review/prior-threads/v1",
    provider: "github",
    pr_number: Number(prNumber),
    head_sha: headSha,
    threads: [
      {
        thread_id: "PRRT_kwDOExample",
        is_resolved: false,
        is_outdated: false,
        path: "src/app.ts",
        line: 1,
        original_line: 1,
        start_line: null,
        original_start_line: null,
        classification: "actionable",
        model_context: "include",
        staleness_reason: "",
        comments: [
          {
            author: "reviewer",
            author_association: "MEMBER",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:01Z",
            body: "Please check this.",
            is_bot: false,
            minimized_reason: null,
          },
        ],
        summary: "",
      },
    ],
    dropped: [],
  };
}

function findingsEnvelope() {
  return {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  };
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  const writableValue = await withProviderEvidence(cwd, relPath, value);
  await writeFile(
    path.join(cwd, relPath),
    JSON.stringify(writableValue, null, 2),
  );
}

async function withProviderEvidence(
  cwd: string,
  relPath: string,
  value: unknown,
) {
  if (
    relPath.endsWith("-scope-decision.json") &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).surface === "pr-review" &&
    !Object.hasOwn(value as Record<string, unknown>, "artifacts")
  ) {
    const scope = value as Record<string, unknown>;
    const headSha = String(scope.head_sha);
    const [baseSha, rangeHeadSha] = String(scope.full_range).split("..");
    const slug =
      new RegExp(
        `^\\.ephemeral/(.+)-${headSha}-scope-decision\\.json$`,
        "u",
      ).exec(relPath)?.[1] ?? "topic";
    const evidencePath = providerScopePath(headSha, slug);
    const evidenceText = JSON.stringify(
      await providerScopeEvidence(cwd, baseSha ?? "", rangeHeadSha ?? headSha),
      null,
      2,
    );
    await writeFile(path.join(cwd, evidencePath), evidenceText);
    return {
      ...scope,
      artifacts: {
        provider_scope_evidence_file: evidencePath,
        provider_scope_evidence_sha256: sha256(evidenceText),
      },
    };
  }
  return value;
}

async function readJson(cwd: string, relPath: string) {
  return JSON.parse(await readFile(path.join(cwd, relPath), "utf8"));
}

async function sha256File(cwd: string, relPath: string) {
  return createHash("sha256")
    .update(await readFile(path.join(cwd, relPath)))
    .digest("hex");
}

async function writeValidInputs(cwd: string, baseSha: string, headSha: string) {
  const evidencePath = providerScopePath(headSha);
  const evidenceText = JSON.stringify(
    await providerScopeEvidence(cwd, baseSha, headSha),
    null,
    2,
  );
  await writeFile(path.join(cwd, evidencePath), evidenceText);
  await writeJson(cwd, scopePath(headSha), {
    ...initialScope(baseSha, headSha),
    artifacts: {
      provider_scope_evidence_file: evidencePath,
      provider_scope_evidence_sha256: sha256(evidenceText),
    },
  });
  await writeJson(cwd, findingsPath(headSha), findingsEnvelope());
}

function handoffEnv(cwd: string, baseSha: string, headSha: string) {
  return {
    PR_NUMBER: prNumber,
    HEAD_SHA: headSha,
    REPOSITORY: "owner/repo",
    EXECUTION_WORKING_DIRECTORY: cwd,
    BASE_REF: "main",
    HEAD_REF: "topic",
    REVIEW_SCOPE_BASE_REF: baseSha,
    ACTIVE_DIFF_RANGE: `${baseSha}..${headSha}`,
    FULL_PR_DIFF_RANGE: `${baseSha}..${headSha}`,
    MODE: "github-post",
    LANGUAGE_HINTS_JSON: '["ts"]',
    FOLLOW_UP_STATE: "initial",
    IS_FOLLOWUP_NARROW: "false",
    SCOPE_DECISION_FILE: scopePath(headSha),
  };
}

function resultEnv(headSha: string) {
  return {
    PR_NUMBER: prNumber,
    HEAD_SHA: headSha,
    REPOSITORY: "owner/repo",
    FINDINGS_FILE: findingsPath(headSha),
    SCOPE_DECISION_FILE: scopePath(headSha),
    PRESENTATION_STATUS: "not-presented",
  };
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
  script = helperScript,
) {
  return execFileAsync("bash", [script, command], {
    cwd,
    env: {
      ...process.env,
      PR_NUMBER: prNumber,
      REPOSITORY: "owner/repo",
      ...env,
    },
    maxBuffer: 1024 * 1024,
  });
}

async function copyInstalledPrManifestHelper(root: string) {
  await cp(runtimeSkillDir, path.join(root, "devcanon-runtime"), {
    recursive: true,
  });
  const script = path.join(root, "pr-review/scripts/review-manifests.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(helperScript, script);
  await chmod(script, 0o755);
  return script;
}

async function copyWrapperWithRecordingRuntime(
  root: string,
  sourceScript: string,
  relativeScript: string,
) {
  const runtime = path.join(
    root,
    "devcanon-runtime/scripts/devcanon-runtime.sh",
  );
  const script = path.join(root, relativeScript);
  await mkdir(path.dirname(runtime), { recursive: true });
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(
    runtime,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf '%s\\n' \"$*\"",
      "",
    ].join("\n"),
  );
  await chmod(runtime, 0o755);
  await copyFile(sourceScript, script);
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledPrPriorHelper(root: string) {
  const script = path.join(root, "pr-review/scripts/prior-thread-artifacts.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(priorHelperScript, script);
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledPlayHelper(root: string) {
  const script = path.join(root, "play-review/scripts/review-artifacts.sh");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(playReviewHelperScript, script);
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledSupportValidator(root: string) {
  await cp(runtimeSkillDir, path.join(root, "devcanon-runtime"), {
    recursive: true,
  });
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(supportValidatorScript, script);
  await chmod(script, 0o755);
  return script;
}

async function writePassingSupportValidator(cwd: string) {
  const validator = path.join(cwd, ".ephemeral/support-validator.sh");
  await writeFile(
    validator,
    ["#!/usr/bin/env bash", "set -euo pipefail", "exit 0", ""].join("\n"),
  );
  await chmod(validator, 0o755);
  return validator;
}

async function copyExternalSupportValidator(root: string) {
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(supportValidatorScript, script);
  await chmod(script, 0o755);
  return script;
}

type Phase5AuditWorkspace = {
  installedRoot: string;
  manifestScript: string;
  leaseScript: string;
  primary: string;
  worktree: string;
  physicalPrimary: string;
  physicalWorktree: string;
  baseSha: string;
  headSha: string;
  resultFile: string;
  leaseFile: string;
};

async function copyInstalledPhase5AuditLayout(root: string) {
  await cp(runtimeSkillDir, path.join(root, "devcanon-runtime"), {
    recursive: true,
  });
  const manifestScript = path.join(
    root,
    "pr-review/scripts/review-manifests.sh",
  );
  const leaseScript = path.join(root, "pr-review/scripts/review-leases.sh");
  const priorScript = path.join(
    root,
    "pr-review/scripts/prior-thread-artifacts.sh",
  );
  const playScript = path.join(root, "play-review/scripts/review-artifacts.sh");
  const validatorScript = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(manifestScript), { recursive: true });
  await mkdir(path.dirname(playScript), { recursive: true });
  await mkdir(path.dirname(validatorScript), { recursive: true });
  await Promise.all([
    copyFile(helperScript, manifestScript),
    copyFile(leaseHelperScript, leaseScript),
    copyFile(priorHelperScript, priorScript),
    copyFile(playReviewHelperScript, playScript),
    copyFile(supportValidatorScript, validatorScript),
  ]);
  await Promise.all(
    [manifestScript, leaseScript, priorScript, playScript, validatorScript].map(
      (script) => chmod(script, 0o755),
    ),
  );
  return { manifestScript, leaseScript };
}

function phase5AuditEnv(workspace: Phase5AuditWorkspace) {
  return {
    REPOSITORY: "owner/repo",
    PR_NUMBER: prNumber,
    HEAD_SHA: workspace.headSha,
    RESULT_FILE: workspace.resultFile,
    PRIMARY_REPOSITORY_ROOT: workspace.physicalPrimary,
    WORKTREE_PATH: workspace.physicalWorktree,
    LEASE_FILE: workspace.leaseFile,
  };
}

function phase5ProcessEnv(env: NodeJS.ProcessEnv = {}) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of [
    "PR_REVIEW_DIR",
    "PR_REVIEW_MANIFEST_HELPER_SCRIPT",
    "PR_REVIEW_LEASE_HELPER_SCRIPT",
    "PLAY_REVIEW_HELPER",
    "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
    "DEVCANON_RUNTIME_DIR",
  ]) {
    delete childEnv[key];
  }
  return childEnv;
}

async function runPhase5Helper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv,
  script: string,
) {
  return execFileAsync("bash", [script, command], {
    cwd,
    env: phase5ProcessEnv({
      PR_NUMBER: prNumber,
      REPOSITORY: "owner/repo",
      ...env,
    }),
    maxBuffer: 1024 * 1024,
  });
}

async function runPhase5Audit(workspace: Phase5AuditWorkspace) {
  return execFileAsync(
    "bash",
    [workspace.manifestScript, "render-phase5-audit-summary"],
    {
      cwd: workspace.primary,
      env: phase5ProcessEnv(phase5AuditEnv(workspace)),
      maxBuffer: 1024 * 1024,
    },
  );
}

async function writePhase5Lease(
  workspace: Omit<Phase5AuditWorkspace, "leaseFile">,
  leaseScript: string,
) {
  const leaseIdentity = {
    PRIMARY_REPOSITORY_ROOT: workspace.physicalPrimary,
    WORKTREE_PATH: workspace.physicalWorktree,
  };
  const { stdout } = await runPhase5Helper(
    workspace.primary,
    "derive-path",
    leaseIdentity,
    leaseScript,
  );
  const leaseFile = stdout.trim();
  const writeLease = (state: "created" | "reviewed" | "gated", env = {}) =>
    runPhase5Helper(
      workspace.primary,
      "write",
      {
        ...leaseIdentity,
        LEASE_FILE: leaseFile,
        STATE: state,
        BASE_REF: "main",
        HEAD_REF: "topic",
        CREATED_AT: "2026-07-17T00:00:00Z",
        UPDATED_AT:
          state === "created"
            ? "2026-07-17T00:00:00Z"
            : state === "reviewed"
              ? "2026-07-17T00:01:00Z"
              : "2026-07-17T00:02:00Z",
        ...env,
      },
      leaseScript,
    );
  await writeLease("created");
  await writeLease("reviewed", {
    RESULT_FILE: workspace.resultFile,
    HEAD_SHA: workspace.headSha,
  });
  await writeLease("gated", {
    RESULT_FILE: workspace.resultFile,
    HEAD_SHA: workspace.headSha,
    PRESENTED_AT: "2026-07-17T00:02:00Z",
    PRESENTATION_STATUS: "preview-current",
  });
  return leaseFile;
}

async function makePhase5AuditWorkspace(): Promise<Phase5AuditWorkspace> {
  const { cwd: primary, baseSha, headSha } = await makeGitWorkspace();
  const installedRoot = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-pr-phase5-installed-"),
  );
  const worktree = `${primary}-phase5-worktree`;
  try {
    await execFileAsync("git", ["switch", "main"], { cwd: primary });
    await execFileAsync("git", ["worktree", "add", worktree, "topic"], {
      cwd: primary,
    });
    await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);
    const { manifestScript, leaseScript } =
      await copyInstalledPhase5AuditLayout(installedRoot);
    await writeValidInputs(worktree, baseSha, headSha);
    await runPhase5Helper(
      worktree,
      "write-handoff",
      handoffEnv(physicalWorktree, baseSha, headSha),
      manifestScript,
    );
    await writeFile(
      path.join(worktree, reviewBodyPath(headSha)),
      "Review body\n",
    );
    await writeFile(path.join(worktree, previewPath(headSha)), "Preview\n");
    const resultFile = resultPath(headSha);
    await runPhase5Helper(
      worktree,
      "write-result",
      {
        ...resultEnv(headSha),
        REVIEW_BODY_FILE: reviewBodyPath(headSha),
        RENDERED_PREVIEW_FILE: previewPath(headSha),
        PRESENTATION_STATUS: "preview-current",
      },
      manifestScript,
    );
    const leaseFile = await writePhase5Lease(
      {
        installedRoot,
        manifestScript,
        leaseScript,
        primary,
        worktree,
        physicalPrimary,
        physicalWorktree,
        baseSha,
        headSha,
        resultFile,
      },
      leaseScript,
    );
    return {
      installedRoot,
      manifestScript,
      leaseScript,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      baseSha,
      headSha,
      resultFile,
      leaseFile,
    };
  } catch (error) {
    await cleanupTempDir(installedRoot);
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", worktree], {
        cwd: primary,
      });
    } catch {
      await cleanupTempDir(worktree);
    }
    await cleanupTempDir(primary);
    throw error;
  }
}

async function cleanupPhase5AuditWorkspace(workspace: Phase5AuditWorkspace) {
  await cleanupTempDir(workspace.installedRoot);
  try {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", workspace.worktree],
      { cwd: workspace.primary },
    );
  } catch {
    await cleanupTempDir(workspace.worktree);
  }
  await cleanupTempDir(workspace.primary);
}

describe("pr-review manifest helper", () => {
  it("lists the Phase 5 audit summary and lease status commands in wrapper usage diagnostics", async () => {
    await expect(
      execFileAsync("bash", [helperScript, "unknown-command"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("render-phase5-audit-summary"),
    });
    await expect(
      execFileAsync("bash", [leaseHelperScript, "unknown-command"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("read-status"),
    });
    await expect(
      execFileAsync("bash", [leaseHelperScript, "unknown-command"]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("record-audit-failure"),
    });
  });

  it("delegates the Phase 5 audit summary command to the pr-review-manifests runtime route", async () => {
    const installed = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-wrapper-"),
    );
    try {
      const script = await copyWrapperWithRecordingRuntime(
        installed,
        helperScript,
        "pr-review/scripts/review-manifests.sh",
      );

      await expect(
        runHelper(installed, "render-phase5-audit-summary", {}, script),
      ).resolves.toMatchObject({
        stdout: "runtime pr-review-manifests render-phase5-audit-summary\n",
      });
    } finally {
      await cleanupTempDir(installed);
    }
  });

  it("delegates the read-only lease status command to the pr-review-leases runtime route", async () => {
    const installed = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-wrapper-"),
    );
    try {
      const script = await copyWrapperWithRecordingRuntime(
        installed,
        leaseHelperScript,
        "pr-review/scripts/review-leases.sh",
      );

      await expect(
        runHelper(installed, "read-status", {}, script),
      ).resolves.toMatchObject({
        stdout: "runtime pr-review-leases read-status\n",
      });
    } finally {
      await cleanupTempDir(installed);
    }
  });

  it("delegates the Phase 5 audit failure command to the pr-review-leases runtime route", async () => {
    const installed = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-wrapper-"),
    );
    try {
      const script = await copyWrapperWithRecordingRuntime(
        installed,
        leaseHelperScript,
        "pr-review/scripts/review-leases.sh",
      );

      await expect(
        runHelper(installed, "record-audit-failure", {}, script),
      ).resolves.toMatchObject({
        stdout: "runtime pr-review-leases record-audit-failure\n",
      });
    } finally {
      await cleanupTempDir(installed);
    }
  });

  // skills/pr-review/SKILL.md owns this public invocation; runtime unit tests
  // cannot prove the copied wrapper's sibling discovery composes end to end.
  it(
    "renders the Phase 5 audit through a copied installed sibling layout using only public inputs",
    async () => {
      const previousValidatorOverride =
        process.env.PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT;
      process.env.PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT = helperScript;
      let workspace: Phase5AuditWorkspace | undefined;
      try {
        workspace = await makePhase5AuditWorkspace();
        expect(Object.keys(phase5AuditEnv(workspace))).toEqual([
          "REPOSITORY",
          "PR_NUMBER",
          "HEAD_SHA",
          "RESULT_FILE",
          "PRIMARY_REPOSITORY_ROOT",
          "WORKTREE_PATH",
          "LEASE_FILE",
        ]);
        const beforeLease = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        const lease = JSON.parse(beforeLease) as {
          worktree_digest: string;
          validation: {
            result_manifest: { sha256: string; validated_at: string };
          };
        };
        const { stdout } = await runPhase5Audit(workspace);

        expect(stdout).toContain("## Phase 5 Artifact Audit Summary");
        expect(stdout).toContain(`Reviewed head SHA: \`${workspace.headSha}\``);
        expect(stdout).toContain("Repository and PR: `owner/repo#390`");
        expect(stdout).toContain("Base/head refs: `main` -> `topic`");
        expect(stdout).toContain(
          `Active diff range: \`${workspace.baseSha}..${workspace.headSha}\``,
        );
        expect(stdout).toContain(
          `Full PR diff range: \`${workspace.baseSha}..${workspace.headSha}\``,
        );
        expect(stdout).toContain(
          `Result manifest: \`${workspace.resultFile}\``,
        );
        expect(stdout).toContain(
          `Findings: \`${findingsPath(workspace.headSha)}\` (0 active, 0 carry-forward)`,
        );
        expect(stdout).toContain(
          `Result artifacts: handoff \`${handoffPath(workspace.headSha)}\`, scope \`${scopePath(workspace.headSha)}\`, prior threads \`none\`, review body \`${reviewBodyPath(workspace.headSha)}\`, context \`none\`, rendered preview \`${previewPath(workspace.headSha)}\``,
        );
        expect(stdout).toContain(
          `Validation status: result \`valid\`; findings validated \`true\`; scope validated \`true\`; lease result digest \`${lease.validation.result_manifest.sha256}\`; lease validated at \`${lease.validation.result_manifest.validated_at}\``,
        );
        expect(stdout).toContain(
          "Presentation status: result `preview-current`; lease `preview-current`; presented at `2026-07-17T00:02:00Z`",
        );
        expect(stdout).toContain(
          `Lease/worktree status: lease \`gated\`; worktree \`${workspace.physicalWorktree}\`; digest \`${lease.worktree_digest}\`; exists \`true\`; registered \`true\`; dirty \`true\`; identity match \`true\``,
        );
        expect(stdout).toContain(
          "Cleanup note: lease-gated cleanup pending; cleanup not attempted in Phase 5.",
        );
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(beforeLease);
      } finally {
        if (previousValidatorOverride === undefined) {
          Reflect.deleteProperty(
            process.env,
            "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
          );
        } else {
          process.env.PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT =
            previousValidatorOverride;
        }
        if (workspace !== undefined) {
          await cleanupPhase5AuditWorkspace(workspace);
        }
      }
    },
    phase5InstalledLayoutTestTimeout,
  );

  it(
    "fails closed when the copied Phase 5 audit layout is missing its prior-thread sibling",
    async () => {
      const workspace = await makePhase5AuditWorkspace();
      try {
        await rm(
          path.join(
            workspace.installedRoot,
            "pr-review/scripts/prior-thread-artifacts.sh",
          ),
        );

        await expect(runPhase5Audit(workspace)).rejects.toMatchObject({
          stdout: "",
          stderr: expect.stringContaining(
            "pr-review prior-thread artifact helper missing or not executable",
          ),
        });
      } finally {
        await cleanupPhase5AuditWorkspace(workspace);
      }
    },
    phase5InstalledLayoutTestTimeout,
  );

  it(
    "fails closed when the copied play-review helper is outside the installed sibling layout",
    async () => {
      const workspace = await makePhase5AuditWorkspace();
      try {
        await rename(
          path.join(workspace.installedRoot, "play-review"),
          path.join(workspace.installedRoot, "misplaced-play-review"),
        );

        await expect(runPhase5Audit(workspace)).rejects.toMatchObject({
          stdout: "",
          stderr: expect.stringContaining(
            "play-review findings helper missing or not executable",
          ),
        });
      } finally {
        await cleanupPhase5AuditWorkspace(workspace);
      }
    },
    phase5InstalledLayoutTestTimeout,
  );

  it(
    "fails before summary when the gated lease result digest is stale",
    async () => {
      const workspace = await makePhase5AuditWorkspace();
      try {
        const lease = await readJson(workspace.primary, workspace.leaseFile);
        await writeJson(workspace.primary, workspace.leaseFile, {
          ...lease,
          validation: {
            ...(lease.validation as Record<string, unknown>),
            result_manifest: {
              ...((lease.validation as Record<string, unknown>)
                .result_manifest as Record<string, unknown>),
              sha256: "f".repeat(64),
            },
          },
        });

        await expect(runPhase5Audit(workspace)).rejects.toMatchObject({
          stdout: "",
          stderr: expect.stringContaining(
            "read-status failed: result manifest digest mismatch",
          ),
        });
      } finally {
        await cleanupPhase5AuditWorkspace(workspace);
      }
    },
    phase5InstalledLayoutTestTimeout,
  );

  it("derives deterministic handoff/result paths and separates different heads", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      await expect(
        runHelper(cwd, "prepare-handoff-write", {
          PR_NUMBER: prNumber,
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${handoffPath(headSha)}\n` });
      await expect(
        runHelper(cwd, "prepare-result-write", {
          PR_NUMBER: prNumber,
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${resultPath(headSha)}\n` });

      const nextHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      expect(handoffPath(nextHead)).not.toBe(handoffPath(headSha));
      expect(resultPath(nextHead)).not.toBe(resultPath(headSha));
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("writes and validates a minimal valid handoff manifest", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);

      await expect(
        runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha)),
      ).resolves.toMatchObject({ stdout: `${handoffPath(headSha)}\n` });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(readJson(cwd, handoffPath(headSha))).resolves.toMatchObject({
        execution: {
          working_directory: expect.stringMatching(/^(\/|[A-Za-z]:[\\/])/u),
        },
      });
      await expect(acceptedPhysicalRoots(cwd)).resolves.toContain(
        normalizePathText(
          (await readJson(cwd, handoffPath(headSha))).execution
            .working_directory,
        ),
      );
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("writes and validates a minimal valid result manifest", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));

      await expect(
        runHelper(cwd, "write-result", resultEnv(headSha)),
      ).resolves.toMatchObject({ stdout: `${resultPath(headSha)}\n` });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, resultPath(headSha))).resolves.toMatchObject({
        schema: "pr-review/result/v1",
        artifacts: {
          handoff_file: handoffPath(headSha),
        },
        digests: {
          handoff_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          findings_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          review_body_sha256: null,
          context_sha256: null,
          scope_decision_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          prior_threads_sha256: null,
          rendered_preview_sha256: null,
        },
        validation: {
          status: "valid",
          findings_validated: true,
          scope_decision_validated: true,
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("requires repository identity for handoff and result validation", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));

      await expect(
        runHelper(cwd, "validate-handoff", {
          REPOSITORY: "",
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("REPOSITORY is required"),
      });
      await expect(
        runHelper(cwd, "validate-result", {
          REPOSITORY: "",
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("REPOSITORY is required"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  }, 30_000);

  it("rejects handoff validation for the wrong repository", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));

      await expect(
        runHelper(cwd, "validate-handoff", {
          REPOSITORY: "other/repo",
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff repository mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects result validation for the wrong repository", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));

      await expect(
        runHelper(cwd, "validate-result", {
          REPOSITORY: "other/repo",
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result repository mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects review scope base refs that do not match provider evidence", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      const wrongBaseSha = "f".repeat(40);

      await expect(
        runHelper(cwd, "write-handoff", {
          ...handoffEnv(cwd, baseSha, headSha),
          REVIEW_SCOPE_BASE_REF: wrongBaseSha,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "scope decision review scope base mismatch",
        ),
      });

      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));
      const handoff = await readJson(cwd, handoffPath(headSha));
      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        review_scope_base_ref: wrongBaseSha,
      });
      const result = await readJson(cwd, resultPath(headSha));
      await writeJson(cwd, resultPath(headSha), {
        ...result,
        digests: {
          ...result.digests,
          handoff_sha256: await sha256File(cwd, handoffPath(headSha)),
        },
      });

      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff review scope base mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  }, 30_000);

  it("rejects shaped provider diff-base evidence that is not derived from baseRefOid", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      const scope = await readJson(cwd, scopePath(headSha));
      const artifacts = scope.artifacts as Record<string, unknown>;
      const evidenceFile = String(artifacts.provider_scope_evidence_file);
      const evidence = await readJson(cwd, evidenceFile);
      const staleEvidenceText = JSON.stringify(
        {
          ...evidence,
          baseRefOid: headSha,
        },
        null,
        2,
      );
      await writeFile(path.join(cwd, evidenceFile), staleEvidenceText);
      await writeJson(cwd, scopePath(headSha), {
        ...scope,
        artifacts: {
          ...artifacts,
          provider_scope_evidence_sha256: sha256(staleEvidenceText),
        },
      });

      await expect(
        runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha)),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "provider PR diff base must equal single merge base",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(isWindows)(
    "rejects handoff manifests with whitespace in head_ref",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).resolves.toMatchObject({ stdout: "" });

        const handoff = await readJson(cwd, handoffPath(headSha));
        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          head_ref: "topic branch",
        });

        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
    30_000,
  );

  it.skipIf(isWindows)(
    "accepts language hints containing plus from normalized extensions",
    async () => {
      const { cwd, baseSha } = await makeGitWorkspace();
      try {
        await writeFile(path.join(cwd, "src/native.c++"), "int value = 1;\n");
        await execFileAsync("git", ["add", "src/native.c++"], { cwd });
        await execFileAsync("git", ["commit", "-m", "feat: add native"], {
          cwd,
        });
        const headSha = await git(cwd, "rev-parse", "HEAD");
        await writeJson(
          cwd,
          scopePath(headSha),
          initialScope(baseSha, headSha, {
            changed_files: ["src/app.ts", "src/native.c++"],
            language_hints: ["c++", "ts"],
            mechanical_facts: {
              changed_file_count: 2,
              followup_sha_usable: false,
              mechanical_escalate_full: true,
              mechanical_escalation_reason: "not-followup",
            },
          }),
        );

        await expect(
          runHelper(cwd, "write-handoff", {
            ...handoffEnv(cwd, baseSha, headSha),
            LANGUAGE_HINTS_JSON: '["c++","ts"]',
          }),
        ).resolves.toMatchObject({ stdout: `${handoffPath(headSha)}\n` });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
    30_000,
  );

  it.skipIf(isWindows)(
    "rejects unknown and forbidden top-level or nested fields",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));

        const handoff = await readJson(cwd, handoffPath(headSha));
        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          unexpected: "extra",
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff schema mismatch"),
        });

        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          approval_state: "approved",
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff schema mismatch"),
        });

        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          execution: { ...handoff.execution, extra: true },
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff schema mismatch"),
        });

        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          follow_up: { ...handoff.follow_up, approval: true },
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff schema mismatch"),
        });

        const result = await readJson(cwd, resultPath(headSha));
        await writeJson(cwd, resultPath(headSha), {
          ...result,
          unexpected: "extra",
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("result schema mismatch"),
        });

        await writeJson(cwd, resultPath(headSha), {
          ...result,
          artifacts: {
            ...result.artifacts,
            lease_file: ".ephemeral/lease.json",
          },
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("result schema mismatch"),
        });

        await writeJson(cwd, resultPath(headSha), {
          ...result,
          review_payload_file: ".ephemeral/payload.json",
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("result schema mismatch"),
        });

        await writeJson(cwd, resultPath(headSha), {
          ...result,
          presentation: { ...result.presentation, payload: {} },
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("result schema mismatch"),
        });

        await writeJson(cwd, resultPath(headSha), {
          ...result,
          validation: { ...result.validation, lease: "active" },
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("result schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
    20_000,
  );

  it("rejects missing required fields, invalid identities, nested paths, and relative execution roots", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));

      await expect(
        runHelper(cwd, "prepare-handoff-write", {
          PR_NUMBER: prNumber,
          HEAD_SHA: "not-a-sha",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "HEAD_SHA must be a 40-character lowercase hex SHA",
        ),
      });
      await expect(
        runHelper(cwd, "prepare-result-write", {
          PR_NUMBER: "0",
          HEAD_SHA: headSha,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("PR_NUMBER must be a positive integer"),
      });
      await expect(
        runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          SCOPE_DECISION_FILE: ".ephemeral/nested/scope-decision.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested scope decision path rejected"),
      });
      await expect(
        runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          SCOPE_DECISION_FILE: ".ephemeral\\nested\\scope-decision.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "scope decision path validation failed",
        ),
      });
      await expect(
        runHelper(cwd, "write-handoff", {
          ...handoffEnv(cwd, baseSha, headSha),
          EXECUTION_WORKING_DIRECTORY: ".",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "execution working_directory must be absolute",
        ),
      });

      const handoff = await readJson(cwd, handoffPath(headSha));
      const { repository: _handoffRepository, ...handoffMissingRepository } =
        handoff;
      await writeJson(cwd, handoffPath(headSha), handoffMissingRepository);
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: { ...handoff.execution, working_directory: "." },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });

      await writeJson(cwd, handoffPath(headSha), handoff);
      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        artifacts: {
          ...handoff.artifacts,
          scope_decision_file: `.ephemeral\\topic-${headSha}-scope-decision.json`,
        },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff schema mismatch"),
      });
      await writeJson(cwd, handoffPath(headSha), handoff);
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: ".ephemeral/nested/bad-handoff.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested handoff path rejected"),
      });

      const result = await readJson(cwd, resultPath(headSha));
      const { repository: _resultRepository, ...resultMissingRepository } =
        result;
      await writeJson(cwd, resultPath(headSha), resultMissingRepository);
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });

      await writeJson(cwd, resultPath(headSha), result);
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: ".ephemeral/nested/bad-result.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested result path rejected"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects invalid path identity values", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));

      const handoff = await readJson(cwd, handoffPath(headSha));
      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        pr_number: 999,
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("handoff PR number mismatch"),
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          PR_NUMBER: "",
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("PR_NUMBER is required"),
      });
      await writeJson(cwd, handoffPath(headSha), handoff);

      const result = await readJson(cwd, resultPath(headSha));
      await writeJson(cwd, resultPath(headSha), {
        ...result,
        pr_number: 999,
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result PR number mismatch"),
      });
      await expect(
        runHelper(cwd, "validate-result", {
          PR_NUMBER: "",
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("PR_NUMBER is required"),
      });
      await writeJson(cwd, resultPath(headSha), result);

      await writeJson(cwd, resultPath(headSha), {
        ...result,
        review_head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("review head mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects handoff physical roots outside the repository root", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    const other = await makeGitWorkspace();
    const sameHeadOther = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-same-head-"),
    );
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await execFileAsync("git", ["clone", cwd, sameHeadOther]);
      await execFileAsync("git", ["checkout", "--detach", headSha], {
        cwd: sameHeadOther,
      });

      const handoff = await readJson(cwd, handoffPath(headSha));

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: { ...handoff.execution, working_directory: sameHeadOther },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "execution working_directory must equal repository root",
        ),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: { ...handoff.execution, working_directory: other.cwd },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "execution working_directory must equal repository root",
        ),
      });

      await writeJson(cwd, handoffPath(headSha), {
        ...handoff,
        execution: {
          ...handoff.execution,
          working_directory: path.join(cwd, "src"),
        },
      });
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "execution working_directory must equal repository root",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(other.cwd);
      await cleanupTempDir(sameHeadOther);
    }
  });

  it("rejects nested optional result paths", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));

      await expect(
        runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          REVIEW_BODY_FILE: ".ephemeral/nested/body-review-body.md",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested review body path rejected"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects stale handoff worktree HEAD", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      const handoff = await readJson(cwd, handoffPath(headSha));
      await writeFile(
        path.join(cwd, "src/app.ts"),
        "export const value = 2;\n",
      );
      await execFileAsync("git", ["add", "src/app.ts"], { cwd });
      await execFileAsync("git", ["commit", "-m", "feat: advance head"], {
        cwd,
      });
      await writeJson(cwd, handoffPath(headSha), handoff);
      await expect(
        runHelper(cwd, "validate-handoff", {
          HEAD_SHA: headSha,
          HANDOFF_FILE: handoffPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("execution worktree HEAD mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects stale result schema fields", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      await writeValidInputs(cwd, baseSha, headSha);
      await runHelper(cwd, "write-handoff", handoffEnv(cwd, baseSha, headSha));
      await runHelper(cwd, "write-result", resultEnv(headSha));
      const result = await readJson(cwd, resultPath(headSha));
      await writeJson(cwd, resultPath(headSha), {
        ...result,
        context_file: ".ephemeral/current.txt",
      });
      await expect(
        runHelper(cwd, "validate-result", {
          HEAD_SHA: headSha,
          RESULT_FILE: resultPath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("result schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(isWindows)(
    "rejects handoff and result mismatches against scope and prior-thread authority",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));

        const handoff = await readJson(cwd, handoffPath(headSha));
        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          active_diff_range: "HEAD^..HEAD",
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff active diff range mismatch"),
        });

        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          full_pr_diff_range: "HEAD^..HEAD",
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff full diff range mismatch"),
        });

        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          language_hints: ["ts", "ts"],
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff language hints mismatch"),
        });

        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          follow_up: {
            state: "follow-up-full",
            last_reviewed_sha: baseSha,
            is_followup_narrow: false,
          },
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff follow-up state mismatch"),
        });

        await writeJson(cwd, scopePath(headSha), {
          ...initialScope(baseSha, headSha),
          head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        });
        await writeJson(cwd, handoffPath(headSha), handoff);
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "provider scope evidence path mismatch",
          ),
        });
        await writeJson(
          cwd,
          scopePath(headSha),
          initialScope(baseSha, headSha),
        );

        const result = await readJson(cwd, resultPath(headSha));
        await writeJson(cwd, resultPath(headSha), {
          ...result,
          artifacts: {
            ...result.artifacts,
            prior_threads_file: priorThreadsPath(headSha),
          },
          digests: {
            ...result.digests,
            prior_threads_sha256:
              "0000000000000000000000000000000000000000000000000000000000000000",
          },
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "result handoff prior threads mismatch",
          ),
        });

        await writeJson(
          cwd,
          priorThreadsPath(headSha),
          priorThreadsEnvelope(headSha),
        );
        await writeJson(
          cwd,
          scopePath(headSha),
          initialScope(baseSha, headSha, {
            mode: "follow-up",
            last_reviewed_sha: baseSha,
            is_followup_narrow: true,
            selected_range: `${baseSha}..HEAD`,
            candidate_narrow_range: `${baseSha}..HEAD`,
            escalation_reasons: [],
            prior_context: {
              kind: "github-prior-threads",
              path: priorThreadsPath(headSha),
            },
            mechanical_facts: {
              changed_file_count: 1,
              followup_sha_usable: true,
              mechanical_escalate_full: false,
              mechanical_escalation_reason: "",
            },
          }),
        );
        await writeJson(cwd, handoffPath(headSha), {
          ...handoff,
          artifacts: {
            ...handoff.artifacts,
            prior_threads_file: `.ephemeral/topic-${headSha}-stale-prior-threads.json`,
          },
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("prior threads path mismatch"),
        });

        await writeJson(cwd, resultPath(headSha), result);
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("prior threads path mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
    30_000,
  );

  it.skipIf(isWindows)(
    "binds result manifests to the deterministic handoff and rejects handoff drift",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));

        const alternateHandoff = `.ephemeral/pr-${prNumber}-${headSha}-alternate-handoff.json`;
        await copyFile(
          path.join(cwd, handoffPath(headSha)),
          path.join(cwd, alternateHandoff),
        );
        await writeJson(cwd, resultPath(headSha), {
          ...(await readJson(cwd, resultPath(headSha))),
          artifacts: {
            ...(await readJson(cwd, resultPath(headSha))).artifacts,
            handoff_file: alternateHandoff,
          },
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff path mismatch"),
        });

        await runHelper(cwd, "write-result", resultEnv(headSha));
        const wrongPrHandoff = `.ephemeral/pr-999-${headSha}-handoff.json`;
        await writeJson(cwd, wrongPrHandoff, {
          ...(await readJson(cwd, handoffPath(headSha))),
          pr_number: 999,
        });
        const currentResult = await readJson(cwd, resultPath(headSha));
        await writeJson(cwd, resultPath(headSha), {
          ...currentResult,
          artifacts: {
            ...currentResult.artifacts,
            handoff_file: wrongPrHandoff,
          },
          digests: {
            ...currentResult.digests,
            handoff_sha256: await sha256File(cwd, wrongPrHandoff),
          },
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("result handoff path mismatch"),
        });

        await runHelper(cwd, "write-result", resultEnv(headSha));
        await rm(path.join(cwd, handoffPath(headSha)));
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("handoff file missing"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
    30_000,
  );

  it.skipIf(isWindows)(
    "rejects result manifest content drift after write",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await writeFile(path.join(cwd, reviewBodyPath(headSha)), "Ready.\n");
        await writeFile(path.join(cwd, previewPath(headSha)), "Preview.\n");
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          REVIEW_BODY_FILE: reviewBodyPath(headSha),
          RENDERED_PREVIEW_FILE: previewPath(headSha),
        });

        await writeFile(
          path.join(cwd, findingsPath(headSha)),
          `${JSON.stringify(findingsEnvelope(), null, 2)}\n`,
        );
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings digest mismatch"),
        });

        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          REVIEW_BODY_FILE: reviewBodyPath(headSha),
          RENDERED_PREVIEW_FILE: previewPath(headSha),
        });
        await writeFile(path.join(cwd, reviewBodyPath(headSha)), "Edited.\n");
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body digest mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it.skipIf(isWindows)(
    "delegates findings validation to explicit and sibling-discovered play-review helpers",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const installed = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-installed-"),
      );
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await copyInstalledPrManifestHelper(installed);
        await copyInstalledPrPriorHelper(installed);
        await copyInstalledPlayHelper(installed);
        await copyInstalledSupportValidator(installed);

        const recordingPlayHelper = path.join(cwd, ".ephemeral/play-helper.sh");
        await writeFile(
          recordingPlayHelper,
          [
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            'printf "%s\\n" "$@" > ".ephemeral/play-helper-args.txt"',
            "exit 0",
            "",
          ].join("\n"),
        );
        await chmod(recordingPlayHelper, 0o755);

        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          PLAY_REVIEW_HELPER: recordingPlayHelper,
        });
        await expect(
          readFile(path.join(cwd, ".ephemeral/play-helper-args.txt"), "utf8"),
        ).resolves.toContain("validate-findings");

        await expect(
          runHelper(
            cwd,
            "validate-result",
            {
              HEAD_SHA: headSha,
              RESULT_FILE: resultPath(headSha),
            },
            path.join(installed, "pr-review/scripts/review-manifests.sh"),
          ),
        ).resolves.toMatchObject({ stdout: "" });

        await writeJson(cwd, findingsPath(headSha), {
          schema: "play-review/findings/v1",
          findings: [{ invalid: true }],
          carry_forward: [],
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings digest mismatch"),
        });

        const resultWithCurrentFindingsDigest = await readJson(
          cwd,
          resultPath(headSha),
        );
        await writeJson(cwd, resultPath(headSha), {
          ...resultWithCurrentFindingsDigest,
          digests: {
            ...resultWithCurrentFindingsDigest.digests,
            findings_sha256: await sha256File(cwd, findingsPath(headSha)),
          },
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("envelope shape mismatch"),
        });

        const invalidFindingsFile = `.ephemeral/topic-${headSha}-bad-findings.json`;
        await writeJson(cwd, invalidFindingsFile, {
          schema: "play-review/findings/v1",
          findings: [{ invalid: true }],
          carry_forward: [],
        });
        await writeJson(cwd, resultPath(headSha), {
          ...(await readJson(cwd, resultPath(headSha))),
          findings_file: invalidFindingsFile,
        });
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings path mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(installed);
      }
    },
  );

  it.skipIf(isWindows)(
    "preserves explicit validator and runtime overrides through delegated result validation",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const external = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-external-validator-"),
      );
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));
        const externalValidator = await copyExternalSupportValidator(external);

        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: externalValidator,
            DEVCANON_RUNTIME_DIR: runtimeSkillDir,
          }),
        ).resolves.toMatchObject({ stdout: "" });

        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: externalValidator,
            DEVCANON_RUNTIME_DIR: path.join(external, "missing-runtime"),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "devcanon-runtime support skill missing",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(external);
      }
    },
    30_000,
  );

  it.skipIf(isWindows)(
    "keeps sibling validator fallback when explicit overrides are absent",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const installed = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-sibling-validator-"),
      );
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));
        const installedScript = await copyInstalledPrManifestHelper(installed);
        await copyInstalledPrPriorHelper(installed);
        await copyInstalledPlayHelper(installed);
        await copyInstalledSupportValidator(installed);

        await expect(
          runHelper(
            cwd,
            "validate-result",
            {
              HEAD_SHA: headSha,
              RESULT_FILE: resultPath(headSha),
            },
            installedScript,
          ),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(installed);
      }
    },
  );

  it.skipIf(isWindows)(
    "accepts play-review findings paths derived from the current branch slug",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await execFileAsync("git", ["switch", "-c", "feature/pr-432"], {
          cwd,
        });
        const branchScopePath = `.ephemeral/feature-pr-432-${headSha}-scope-decision.json`;
        const branchFindingsPath = `.ephemeral/feature-pr-432-${headSha}-findings.json`;
        await writeJson(cwd, branchScopePath, initialScope(baseSha, headSha));
        await writeJson(cwd, branchFindingsPath, findingsEnvelope());

        await runHelper(cwd, "write-handoff", {
          ...handoffEnv(cwd, baseSha, headSha),
          SCOPE_DECISION_FILE: branchScopePath,
        });
        await runHelper(cwd, "write-result", {
          ...resultEnv(headSha),
          FINDINGS_FILE: branchFindingsPath,
          SCOPE_DECISION_FILE: branchScopePath,
        });

        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).resolves.toMatchObject({ stdout: "" });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it.skipIf(isWindows)(
    "fails closed for missing or non-executable helper authorities before continuing",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const installed = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-missing-"),
      );
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));
        const installedScript = await copyInstalledPrManifestHelper(installed);
        await copyInstalledPrPriorHelper(installed);
        await copyInstalledSupportValidator(installed);

        await expect(
          runHelper(
            cwd,
            "validate-result",
            {
              HEAD_SHA: headSha,
              RESULT_FILE: resultPath(headSha),
            },
            installedScript,
          ),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "play-review findings helper missing or not executable",
          ),
        });

        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
            PR_REVIEW_DIR: path.join(installed, "missing-pr-review"),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "pr-review prior-thread artifact helper missing or not executable",
          ),
        });

        const nonExecutablePlayHelper = path.join(
          cwd,
          ".ephemeral/non-exec-play.sh",
        );
        await writeFile(
          nonExecutablePlayHelper,
          "#!/usr/bin/env bash\nexit 0\n",
        );
        await chmod(nonExecutablePlayHelper, 0o644);
        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
            PLAY_REVIEW_HELPER: nonExecutablePlayHelper,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "play-review findings helper missing or not executable",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(installed);
      }
    },
  );

  it.skipIf(isWindows)(
    "preserves final manifests and removes temp files when temp validation fails",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));
        const before = await readFile(
          path.join(cwd, resultPath(headSha)),
          "utf8",
        );

        await expect(
          runHelper(cwd, "write-result", {
            ...resultEnv(headSha),
            PRESENTATION_STATUS: "approved",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("result schema mismatch"),
        });
        await expect(
          readFile(path.join(cwd, resultPath(headSha)), "utf8"),
        ).resolves.toBe(before);
        await expect(
          readFile(
            path.join(
              cwd,
              `.ephemeral/.pr-${prNumber}-${headSha}-result.json.tmp`,
            ),
            "utf8",
          ),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it.skipIf(!symlinkAvailable)(
    "guards direct-child write targets and symlinked .ephemeral",
    async () => {
      const { cwd, headSha } = await makeGitWorkspace();
      try {
        await rm(path.join(cwd, ".ephemeral"), {
          recursive: true,
          force: true,
        });
        await symlink(os.tmpdir(), path.join(cwd, ".ephemeral"));
        await expect(
          runHelper(cwd, "prepare-handoff-write", {
            PR_NUMBER: prNumber,
            HEAD_SHA: headSha,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            ".ephemeral must be a directory, not a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked execution and result artifact paths before reading them",
    async () => {
      const { cwd, baseSha, headSha } = await makeGitWorkspace();
      const external = await mkdtemp(
        path.join(os.tmpdir(), "devcanon-pr-symlink-scope-"),
      );
      try {
        await writeValidInputs(cwd, baseSha, headSha);
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );
        await runHelper(cwd, "write-result", resultEnv(headSha));
        const externalScope = path.join(external, "scope-decision.json");
        const linkedRoot = path.join(external, "linked-root");
        await symlink(cwd, linkedRoot);
        await writeJson(cwd, handoffPath(headSha), {
          ...(await readJson(cwd, handoffPath(headSha))),
          execution: {
            kind: "review-worktree",
            working_directory: linkedRoot,
          },
        });
        await expect(
          runHelper(cwd, "validate-handoff", {
            HEAD_SHA: headSha,
            HANDOFF_FILE: handoffPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "execution working_directory must equal repository root",
          ),
        });
        await runHelper(
          cwd,
          "write-handoff",
          handoffEnv(cwd, baseSha, headSha),
        );

        const externalReviewBody = path.join(external, "review-body.md");
        await writeFile(externalReviewBody, "external body\n");
        await symlink(
          externalReviewBody,
          path.join(cwd, reviewBodyPath(headSha)),
        );
        await expect(
          runHelper(cwd, "write-result", {
            ...resultEnv(headSha),
            REVIEW_BODY_FILE: reviewBodyPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "review body file must not be a symlink",
          ),
        });
        await rm(path.join(cwd, reviewBodyPath(headSha)));

        await writeFile(
          externalScope,
          JSON.stringify(initialScope(baseSha, headSha), null, 2),
        );
        await rm(path.join(cwd, scopePath(headSha)));
        await symlink(externalScope, path.join(cwd, scopePath(headSha)));

        await expect(
          runHelper(cwd, "validate-result", {
            HEAD_SHA: headSha,
            RESULT_FILE: resultPath(headSha),
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "scope decision file must not be a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
        await cleanupTempDir(external);
      }
    },
  );

  it("keeps approval payload and GitHub mutation authority out of the manifest helper", async () => {
    const manifestHelper = await readFile(helperScript, "utf8");
    const leaseHelper = await readFile(leaseHelperScript, "utf8");
    const approvedHelper = await readFile(
      path.join(
        process.cwd(),
        "skills/pr-review/scripts/approved-review-artifacts.sh",
      ),
      "utf8",
    );

    expect(manifestHelper).not.toContain("freeze-approved-review");
    expect(manifestHelper).not.toContain("build-github-review-payload");
    expect(manifestHelper).not.toMatch(/\bgh\s+api\b/);
    expect(manifestHelper).not.toMatch(/\bjq\b/);
    expect(manifestHelper).not.toContain("pr-review/approved-review/v1");
    expect(leaseHelper).not.toMatch(/\bgh\s+api\b/);
    expect(leaseHelper).not.toMatch(/\bjq\b/);
    expect(approvedHelper).toContain("freeze_approved_review");
    expect(approvedHelper).toContain("pr-review/approved-review/v1");
  });
});
