import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  validatePrReviewResultCommandAuthority,
  validatePrReviewResultCommandAuthorityForFindingsPublication,
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
      const runtime = await import("./pr-review-result-validation.js");
      const createContext = (
        runtime as typeof runtime & {
          createPrReviewResultValidationContext?: () => unknown;
        }
      ).createPrReviewResultValidationContext;
      const validationContext = createContext?.();
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

      await writeFile(path.join(workspace.root, "README.md"), "dirty\n");
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

  it("validates a prior-bound scope decision once before reusing its proof", async () => {
    const workspace = await makeWorkspace({ withPriorThreads: true });
    try {
      const runtime = await import("./pr-review-result-validation.js");
      const createContext = (
        runtime as typeof runtime & {
          createPrReviewResultValidationContext?: () => unknown;
        }
      ).createPrReviewResultValidationContext;
      const validationContext = createContext?.();
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

      expect(await readFile(workspace.countFile, "utf8")).toBe(
        "scope\nprior\n",
      );
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });
});

async function makeWorkspace(
  options: { withPriorThreads?: boolean } = {},
): Promise<{
  root: string;
  headSha: string;
  resultFile: string;
  findingsFile: string;
  countFile: string;
  prReviewDir: string;
  playReviewHelper: string;
}> {
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
  const physicalRoot = await import("node:fs/promises").then(({ realpath }) =>
    realpath(root),
  );

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
      schema: "github-prior-threads/v1",
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
      '  validate-scope-decision) printf "scope\\n" >> "$COUNT_FILE" ;;',
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
    headSha,
    resultFile,
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
