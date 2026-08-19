import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPrReviewResultValidationContext,
  validatePrReviewResultCommandAuthority,
  validatePrReviewResultCommandAuthorityForFindingsPublication,
  validatePrReviewResultCommandAuthorityForReviewBodyRecovery,
} from "./pr-review-result-validation.js";

const execFileAsync = promisify(execFile);
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
});

describe("PR-review result validation context", () => {
  it("reuses one common scope/provider proof while revalidating permissive findings locally", async () => {
    const workspace = await makeWorkspace();
    try {
      const validationContext = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const input = {
        worktreeRoot: workspace.root,
        resultFile: workspace.resultFile,
        repository: "owner/repo",
        prNumber: 42,
        reviewHeadSha: workspace.headSha,
        prReviewDir: workspace.prReviewDir,
        playReviewHelper: workspace.playReviewHelper,
        helperEnv: { COUNT_FILE: workspace.countFile },
        validationContext,
      };

      await validatePrReviewResultCommandAuthority(input);
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe("scope\n");

      await writeFile(
        path.join(workspace.root, ".gitattributes"),
        "*.ts -text\n",
      );
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\n",
      );

      await writeFile(
        path.join(workspace.root, workspace.findingsFile),
        '{"schema":"play-review/findings/v2","findings":[{"id":"F1"}],"carry_forward":[]}\n',
      );
      const publishedDigest = await sha256File(
        path.join(workspace.root, workspace.findingsFile),
      );
      await validatePrReviewResultCommandAuthorityForFindingsPublication(
        input,
        publishedDigest,
      );
      await expect(
        validatePrReviewResultCommandAuthority(input),
      ).rejects.toThrow("findings digest mismatch");

      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\n",
      );
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("does not let review-body recovery allowance satisfy later strict validation", async () => {
    const workspace = await makeWorkspace();
    try {
      const validationContext = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const input = authorityInput(workspace, validationContext);
      await validatePrReviewResultCommandAuthority(input);
      await writeFile(
        path.join(workspace.root, workspace.reviewBodyFile),
        "Recovered body.\n",
      );

      await validatePrReviewResultCommandAuthorityForReviewBodyRecovery(input);
      await expect(
        validatePrReviewResultCommandAuthority(input),
      ).rejects.toThrow("review body digest mismatch");
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("fails closed when dirty worktree state drifts during common validation", async () => {
    const workspace = await makeWorkspace();
    try {
      const validationContext = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const driftFile = path.join(workspace.root, ".gitattributes");
      await expect(
        validatePrReviewResultCommandAuthority({
          ...authorityInput(workspace, validationContext),
          helperEnv: {
            COUNT_FILE: workspace.countFile,
            DRIFT_DURING_SCOPE_FILE: driftFile,
          },
        }),
      ).rejects.toThrow("scope/provider authority changed during validation");
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("does not reuse cached scope authority after a byte-identical path substitution", async () => {
    const workspace = await makeWorkspace();
    try {
      const context = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const input = authorityInput(workspace, context);
      await validatePrReviewResultCommandAuthority(input);
      await substituteScopePath(workspace);
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\n",
      );
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("does not reuse no-prior authority after the canonical prior artifact appears", async () => {
    const workspace = await makeWorkspace();
    try {
      const context = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const input = authorityInput(workspace, context);
      await validatePrReviewResultCommandAuthority(input);
      await writeJson(
        workspace.root,
        `.ephemeral/topic-${workspace.headSha}-prior-threads.json`,
        { schema: "pr-review/prior-threads/v1" },
      );
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\n",
      );
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("retains a failed sequential authority proof", async () => {
    const workspace = await makeWorkspace();
    try {
      const rejectedContext = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const rejected = {
        ...authorityInput(workspace, rejectedContext),
        helperEnv: { COUNT_FILE: workspace.countFile, FAIL_SCOPE: "1" },
      };
      await expect(
        validatePrReviewResultCommandAuthority(rejected),
      ).rejects.toThrow("helper command failed");
      await expect(
        validatePrReviewResultCommandAuthority({
          ...rejected,
          helperEnv: {
            COUNT_FILE: workspace.countFile,
            FAIL_SCOPE: "1",
          },
        }),
      ).rejects.toThrow("helper command failed");
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("validates a prior-bound scope decision once before reusing its proof", async () => {
    const workspace = await makeWorkspace({ withPriorThreads: true });
    try {
      const validationContext = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const input = {
        worktreeRoot: workspace.root,
        resultFile: workspace.resultFile,
        repository: "owner/repo",
        prNumber: 42,
        reviewHeadSha: workspace.headSha,
        prReviewDir: workspace.prReviewDir,
        playReviewHelper: workspace.playReviewHelper,
        helperEnv: {
          COUNT_FILE: workspace.countFile,
          EXPECT_PRIOR_SCOPE: "1",
          EXPECTED_PRIOR_THREADS_FILE: `.ephemeral/topic-${workspace.headSha}-prior-threads.json`,
        },
        validationContext,
      };

      await validatePrReviewResultCommandAuthority(input);
      await validatePrReviewResultCommandAuthority(input);

      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nprior\n",
      );
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("does not reuse a proof after each bound scope/provider artifact changes", async () => {
    const workspace = await makeWorkspace();
    try {
      const validationContext = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const input = authorityInput(workspace, validationContext);
      await validatePrReviewResultCommandAuthority(input);

      await rewriteScopeDecision(workspace, (scope) => ({
        ...scope,
        selection_reason: "Changed selection reason.",
      }));
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\n",
      );

      await rewriteProviderEvidenceWhitespace(workspace);
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\nscope\n",
      );

      await bindPriorThreads(workspace);
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\nscope\nscope\nprior\n",
      );
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it("does not consume cached authority after base, head, or worktree identity drift", async () => {
    const workspace = await makeWorkspace();
    const cloneRoot = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-validation-clone-"),
    );
    try {
      const validationContext = await createPrReviewResultValidationContext({
        worktreeRoot: workspace.root,
      });
      const input = authorityInput(workspace, validationContext);
      await validatePrReviewResultCommandAuthority(input);

      await rewriteScopeDecision(workspace, (scope) => ({
        ...scope,
        full_range: `${workspace.headSha}..${workspace.headSha}`,
        selected_range: `${workspace.headSha}..${workspace.headSha}`,
      }));
      await rewriteProviderEvidence(workspace, (evidence) => ({
        ...evidence,
        provider_pr_diff_base_sha: workspace.headSha,
        full_pr_diff_range: `${workspace.headSha}..${workspace.headSha}`,
      }));
      await rewriteHandoffBase(workspace, workspace.headSha);
      await validatePrReviewResultCommandAuthority(input);
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\n",
      );

      await expect(
        validatePrReviewResultCommandAuthority({
          ...input,
          reviewHeadSha: "f".repeat(40),
        }),
      ).rejects.toThrow("review head mismatch");
      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nscope\n",
      );

      await execFileAsync("git", ["clone", workspace.root, cloneRoot]);
      await execFileAsync("git", ["switch", "topic"], { cwd: cloneRoot });
      await mkdir(path.join(cloneRoot, ".ephemeral"));
      for (const file of [
        workspace.findingsFile,
        workspace.scopeFile,
        workspace.evidenceFile,
        workspace.handoffFile,
        workspace.resultFile,
        workspace.reviewBodyFile,
      ]) {
        await cp(path.join(workspace.root, file), path.join(cloneRoot, file));
      }
      await rewriteHandoffExecution(cloneRoot, workspace);
      await expect(
        validatePrReviewResultCommandAuthority({
          ...input,
          worktreeRoot: cloneRoot,
        }),
      ).rejects.toThrow("validation context worktree root mismatch");
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
      await rm(cloneRoot, { recursive: true, force: true });
    }
  });
});

interface Workspace {
  root: string;
  baseSha: string;
  headSha: string;
  resultFile: string;
  handoffFile: string;
  scopeFile: string;
  evidenceFile: string;
  reviewBodyFile: string;
  findingsFile: string;
  countFile: string;
  prReviewDir: string;
  playReviewHelper: string;
}

async function makeWorkspace(
  options: { withPriorThreads?: boolean } = {},
): Promise<Workspace> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-validation-context-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: root,
  });
  await writeFile(path.join(root, "README.md"), "baseline\n");
  await writeFile(path.join(root, ".gitattributes"), "*.ts text\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: root });
  const baseSha = await git(root, "rev-parse", "HEAD");
  await execFileAsync("git", ["switch", "-c", "topic"], { cwd: root });
  await writeFile(
    path.join(root, "reviewed.ts"),
    "export const reviewed = true;\n",
  );
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "reviewed change"], {
    cwd: root,
  });
  const headSha = await git(root, "rev-parse", "HEAD");
  await mkdir(path.join(root, ".ephemeral"));

  const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
  const scopeFile = `.ephemeral/topic-${headSha}-scope-decision.json`;
  const evidenceFile = `.ephemeral/topic-${headSha}-provider-scope-evidence.json`;
  const handoffFile = `.ephemeral/pr-42-${headSha}-handoff.json`;
  const resultFile = `.ephemeral/pr-42-${headSha}-result.json`;
  const reviewBodyFile = `.ephemeral/pr-42-${headSha}-review-body.md`;
  const priorThreadsFile = options.withPriorThreads
    ? `.ephemeral/topic-${headSha}-prior-threads.json`
    : null;
  const range = `${baseSha}..${headSha}`;
  const physicalRoot = await realpath(root);

  await writeJson(root, evidenceFile, {
    schema: "pr-review/provider-scope-evidence/v2",
    provider: "github",
    repository: "owner/repo",
    pr_number: 42,
    baseRefOid: baseSha,
    headRefOid: headSha,
    provider_pr_diff_base_sha: baseSha,
    local_review_head_sha: headSha,
    full_pr_diff_range: range,
  });
  const evidenceDigest = await sha256File(path.join(root, evidenceFile));
  await writeJson(root, findingsFile, {
    schema: "play-review/findings/v2",
    findings: [],
    carry_forward: [],
  });
  if (priorThreadsFile !== null) {
    await writeJson(root, priorThreadsFile, {
      schema: "pr-review/prior-threads/v1",
    });
  }
  await writeFile(path.join(root, reviewBodyFile), "Review body.\n");
  await writeJson(root, scopeFile, {
    head_sha: headSha,
    selection_reason: "Initial review.",
    selected_range: range,
    full_range: range,
    is_followup_narrow: false,
    language_hints: [],
    mode: "initial",
    last_reviewed_sha: null,
    prior_context:
      priorThreadsFile === null
        ? { kind: "none", path: null }
        : { kind: "github-prior-threads", path: priorThreadsFile },
    artifacts: {
      provider_scope_evidence_file: evidenceFile,
      provider_scope_evidence_sha256: evidenceDigest,
    },
  });
  await writeJson(root, handoffFile, {
    schema: "pr-review/handoff/v1",
    pr_number: 42,
    repository: "owner/repo",
    execution: { kind: "review-worktree", working_directory: physicalRoot },
    base_ref: "main",
    head_ref: "topic",
    review_scope_base_ref: baseSha,
    active_diff_range: range,
    full_pr_diff_range: range,
    review_head_sha: headSha,
    mode: "github-post",
    language_hints: [],
    follow_up: {
      state: "initial",
      last_reviewed_sha: null,
      is_followup_narrow: false,
    },
    artifacts: {
      scope_decision_file: scopeFile,
      prior_threads_file: priorThreadsFile,
      provider_scope_evidence_file: evidenceFile,
      provider_scope_evidence_sha256: evidenceDigest,
    },
  });
  await writeJson(root, resultFile, {
    schema: "pr-review/result/v1",
    pr_number: 42,
    repository: "owner/repo",
    review_head_sha: headSha,
    findings_file: findingsFile,
    review_body_file: reviewBodyFile,
    context_file: null,
    artifacts: {
      handoff_file: handoffFile,
      scope_decision_file: scopeFile,
      prior_threads_file: priorThreadsFile,
      rendered_preview_file: null,
      provider_scope_evidence_file: evidenceFile,
    },
    digests: {
      handoff_sha256: await sha256File(path.join(root, handoffFile)),
      findings_sha256: await sha256File(path.join(root, findingsFile)),
      review_body_sha256: await sha256File(path.join(root, reviewBodyFile)),
      context_sha256: null,
      scope_decision_sha256: await sha256File(path.join(root, scopeFile)),
      prior_threads_sha256:
        priorThreadsFile === null
          ? null
          : await sha256File(path.join(root, priorThreadsFile)),
      rendered_preview_sha256: null,
      provider_scope_evidence_sha256: evidenceDigest,
    },
    scope_decision: {
      summary: "Initial review.",
      selected_range: range,
      full_range: range,
      is_followup_narrow: false,
    },
    presentation: { status: "preview-current", notes: null },
    validation: {
      status: "valid",
      findings_validated: true,
      scope_decision_validated: true,
    },
  });
  const helpers = path.join(root, "helpers");
  const prReviewDir = path.join(helpers, "pr-review");
  const countFile = path.join(root, "scope-count.txt");
  await mkdir(path.join(prReviewDir, "scripts"), { recursive: true });
  await writeExecutable(
    path.join(prReviewDir, "scripts", "prior-thread-artifacts.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'case "$1" in',
      "  validate-scope-decision)",
      '    [ "${EXPECT_PRIOR_SCOPE:-}" != "1" ] || [ "${PRIOR_THREADS_FILE:-}" = "${EXPECTED_PRIOR_THREADS_FILE:-}" ]',
      '    [ "${FAIL_SCOPE:-}" != "1" ] || exit 1',
      '    [ -z "${DRIFT_DURING_SCOPE_FILE:-}" ] || printf "drift\\n" > "$DRIFT_DURING_SCOPE_FILE"',
      '    printf "scope\\n" >> "$COUNT_FILE"',
      "    ;;",
      '  validate-prior-threads) printf "prior\\n" >> "$COUNT_FILE" ;;',
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  const playReviewHelper = await writeExecutable(
    path.join(helpers, "play-review.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'test "$1" = validate-findings',
      "",
    ].join("\n"),
  );
  return {
    root,
    baseSha,
    headSha,
    resultFile,
    handoffFile,
    scopeFile,
    evidenceFile,
    reviewBodyFile,
    findingsFile,
    countFile,
    prReviewDir,
    playReviewHelper,
  };
}

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout.trim();
}

function authorityInput(
  workspace: Workspace,
  validationContext: Awaited<
    ReturnType<typeof createPrReviewResultValidationContext>
  >,
) {
  return {
    worktreeRoot: workspace.root,
    resultFile: workspace.resultFile,
    repository: "owner/repo",
    prNumber: 42,
    reviewHeadSha: workspace.headSha,
    prReviewDir: workspace.prReviewDir,
    playReviewHelper: workspace.playReviewHelper,
    helperEnv: { COUNT_FILE: workspace.countFile },
    validationContext,
  };
}

type JsonObject = Record<string, unknown>;

async function rewriteScopeDecision(
  workspace: Workspace,
  rewrite: (scope: JsonObject) => JsonObject,
): Promise<void> {
  const scope = rewrite(await readJson(workspace.root, workspace.scopeFile));
  await writeJson(workspace.root, workspace.scopeFile, scope);
  await synchronizeBindings(workspace);
}

async function rewriteProviderEvidence(
  workspace: Workspace,
  rewrite: (evidence: JsonObject) => JsonObject,
): Promise<void> {
  const evidence = rewrite(
    await readJson(workspace.root, workspace.evidenceFile),
  );
  await writeJson(workspace.root, workspace.evidenceFile, evidence);
  const scope = await readJson(workspace.root, workspace.scopeFile);
  const artifacts = scope.artifacts as JsonObject;
  artifacts.provider_scope_evidence_sha256 = await sha256File(
    path.join(workspace.root, workspace.evidenceFile),
  );
  await writeJson(workspace.root, workspace.scopeFile, scope);
  await synchronizeBindings(workspace);
}

async function rewriteProviderEvidenceWhitespace(
  workspace: Workspace,
): Promise<void> {
  const evidencePath = path.join(workspace.root, workspace.evidenceFile);
  await writeFile(evidencePath, `${await readFile(evidencePath, "utf8")}\n`);
  const scope = await readJson(workspace.root, workspace.scopeFile);
  const artifacts = scope.artifacts as JsonObject;
  artifacts.provider_scope_evidence_sha256 = await sha256File(evidencePath);
  await writeJson(workspace.root, workspace.scopeFile, scope);
  await synchronizeBindings(workspace);
}

async function bindPriorThreads(workspace: Workspace): Promise<void> {
  const priorThreadsFile = `.ephemeral/topic-${workspace.headSha}-prior-threads.json`;
  await writeJson(workspace.root, priorThreadsFile, {
    schema: "github-prior-threads/v1",
  });
  const scope = await readJson(workspace.root, workspace.scopeFile);
  scope.prior_context = {
    kind: "github-prior-threads",
    path: priorThreadsFile,
  };
  await writeJson(workspace.root, workspace.scopeFile, scope);
  await synchronizeBindings(workspace);
}

async function substituteScopePath(workspace: Workspace): Promise<void> {
  const replacement = `.ephemeral/substitute-${workspace.headSha}-scope-decision.json`;
  await cp(
    path.join(workspace.root, workspace.scopeFile),
    path.join(workspace.root, replacement),
  );
  const handoff = await readJson(workspace.root, workspace.handoffFile);
  (handoff.artifacts as JsonObject).scope_decision_file = replacement;
  await writeJson(workspace.root, workspace.handoffFile, handoff);
  const result = await readJson(workspace.root, workspace.resultFile);
  (result.artifacts as JsonObject).scope_decision_file = replacement;
  (result.digests as JsonObject).handoff_sha256 = await sha256File(
    path.join(workspace.root, workspace.handoffFile),
  );
  await writeJson(workspace.root, workspace.resultFile, result);
}

async function rewriteHandoffBase(
  workspace: Workspace,
  baseSha: string,
): Promise<void> {
  const handoff = await readJson(workspace.root, workspace.handoffFile);
  const range = `${baseSha}..${workspace.headSha}`;
  handoff.review_scope_base_ref = baseSha;
  handoff.active_diff_range = range;
  handoff.full_pr_diff_range = range;
  await writeJson(workspace.root, workspace.handoffFile, handoff);
  await synchronizeBindings(workspace);
}

async function rewriteHandoffExecution(
  cloneRoot: string,
  workspace: Workspace,
): Promise<void> {
  const handoff = await readJson(cloneRoot, workspace.handoffFile);
  (handoff.execution as JsonObject).working_directory =
    await realpath(cloneRoot);
  await writeJson(cloneRoot, workspace.handoffFile, handoff);
  const result = await readJson(cloneRoot, workspace.resultFile);
  (result.digests as JsonObject).handoff_sha256 = await sha256File(
    path.join(cloneRoot, workspace.handoffFile),
  );
  await writeJson(cloneRoot, workspace.resultFile, result);
}

async function synchronizeBindings(workspace: Workspace): Promise<void> {
  const scope = await readJson(workspace.root, workspace.scopeFile);
  const evidenceDigest = await sha256File(
    path.join(workspace.root, workspace.evidenceFile),
  );
  const scopeDigest = await sha256File(
    path.join(workspace.root, workspace.scopeFile),
  );
  const priorContext = scope.prior_context as JsonObject;
  const priorThreadsFile = priorContext.path as string | null;
  const handoff = await readJson(workspace.root, workspace.handoffFile);
  const handoffArtifacts = handoff.artifacts as JsonObject;
  handoffArtifacts.prior_threads_file = priorThreadsFile;
  handoffArtifacts.provider_scope_evidence_sha256 = evidenceDigest;
  await writeJson(workspace.root, workspace.handoffFile, handoff);

  const result = await readJson(workspace.root, workspace.resultFile);
  const artifacts = result.artifacts as JsonObject;
  const digests = result.digests as JsonObject;
  const summary = result.scope_decision as JsonObject;
  artifacts.prior_threads_file = priorThreadsFile;
  digests.handoff_sha256 = await sha256File(
    path.join(workspace.root, workspace.handoffFile),
  );
  digests.scope_decision_sha256 = scopeDigest;
  digests.provider_scope_evidence_sha256 = evidenceDigest;
  digests.prior_threads_sha256 =
    priorThreadsFile === null
      ? null
      : await sha256File(path.join(workspace.root, priorThreadsFile));
  summary.summary = scope.selection_reason;
  summary.selected_range = scope.selected_range;
  summary.full_range = scope.full_range;
  summary.is_followup_narrow = scope.is_followup_narrow;
  await writeJson(workspace.root, workspace.resultFile, result);
}

async function readJson(root: string, file: string): Promise<JsonObject> {
  return JSON.parse(
    await readFile(path.join(root, file), "utf8"),
  ) as JsonObject;
}

async function writeJson(
  root: string,
  file: string,
  value: unknown,
): Promise<void> {
  await writeFile(path.join(root, file), `${JSON.stringify(value)}\n`);
}

async function writeExecutable(
  file: string,
  contents: string,
): Promise<string> {
  await writeFile(file, contents);
  await chmod(file, 0o755);
  return file;
}

async function sha256File(file: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
