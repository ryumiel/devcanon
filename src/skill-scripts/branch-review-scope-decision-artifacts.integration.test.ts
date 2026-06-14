import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/branch-review/scripts/scope-decision-artifacts.sh",
);
const jqAvailable = await commandAvailable("jq");

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-branch-scope-"));
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

async function commitFile(cwd: string, filePath: string, content: string) {
  await mkdir(path.dirname(path.join(cwd, filePath)), { recursive: true });
  await writeFile(path.join(cwd, filePath), content);
  await execFileAsync("git", ["add", "--", filePath], { cwd });
  await execFileAsync("git", ["commit", "-m", `test: add ${filePath}`], {
    cwd,
  });
  return git(cwd, "rev-parse", "HEAD");
}

async function makeFollowupWorkspace() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "devcanon-branch-scope-"));
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  await commitFile(cwd, "src/full-only.ts", "export const fullOnly = 1;\n");
  const lastReviewedSha = await git(cwd, "rev-parse", "HEAD");
  await commitFile(cwd, "notes/followup.md", "narrow\n");
  const headSha = await git(cwd, "rev-parse", "HEAD");
  await mkdir(path.join(cwd, ".ephemeral"));
  return { cwd, lastReviewedSha, headSha };
}

function scopePath(headSha: string) {
  return `.ephemeral/topic-${headSha}-scope-decision.json`;
}

function approvalSummaryPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-approval-summary.json`;
}

function contractExampleContextPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-contract-example-discipline-context.json`;
}

function findingsPath(headSha: string) {
  return `.ephemeral/topic-${headSha}-findings.json`;
}

function initialScope(baseSha: string, headSha: string, overrides = {}) {
  return {
    schema: "branch-review/scope-decision/v1",
    surface: "branch-review",
    mode: "initial",
    head_sha: headSha,
    full_range: `${baseSha}...HEAD`,
    selected_range: `${baseSha}...HEAD`,
    candidate_narrow_range: `${baseSha}...HEAD`,
    last_reviewed_sha: null,
    is_followup_narrow: false,
    selection_reason: "Initial review uses the full review range.",
    changed_files: ["src/app.ts"],
    language_hints: ["ts"],
    escalation_reasons: ["not-followup"],
    scope_reason_codes: ["range_validation"],
    scope_explanation: "Initial review uses the full review range.",
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

function riskSignals(baseSha: string, headSha: string, overrides = {}) {
  return {
    schema: "branch-review/risk-signals/v1",
    producer: "play-subagent-execution",
    evidence_source: {
      kind: "executor-terminal-handoff",
      path: ".ephemeral/example-plan.md",
      summary: "Derived from executor terminal handoff state.",
    },
    reviewed_base_ref: "main",
    reviewed_base_sha: baseSha,
    reviewed_head_sha: headSha,
    reviewed_range: "main...HEAD",
    changed_files: ["src/app.ts"],
    signals: {
      user_facing_behavior: "none",
      documentation_examples: "none",
      diagnostics: "none",
      contract: "none",
      generated_output: "none",
      governance_path: "none",
    },
    canonical_docs_may_be_affected: false,
    end_user_diagnostics_may_be_affected: false,
    notes: "",
    ...overrides,
  };
}

function parseKeyValues(stdout: string) {
  const values: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function writeEmptyFindings(cwd: string, headSha: string) {
  const file = findingsPath(headSha);
  await writeJson(cwd, file, {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  });
  return file;
}

async function runHelper(
  cwd: string,
  script: string,
  command: string,
  env: Record<string, string> = {},
) {
  return execFileAsync("bash", [script, command], {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024,
  });
}

async function readJson(cwd: string, relPath: string) {
  return JSON.parse(await readFile(path.join(cwd, relPath), "utf8"));
}

async function writeMarkerValidator(root: string, marker: string) {
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      '[ -z "${MARKER_ARGS_FILE:-}" ] || printf "%s\\n" "$@" > "$MARKER_ARGS_FILE"',
      `printf '%s\\n' ${JSON.stringify(marker)}`,
      "",
    ].join("\n"),
  );
  await chmod(script, 0o755);
  return script;
}

async function writeFailingValidator(root: string, message: string) {
  const script = path.join(
    root,
    "play-validate-review-artifacts/scripts/review-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await writeFile(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s\\n' ${JSON.stringify(message)} >&2`,
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(script, 0o755);
  return script;
}

async function copyInstalledBranchAdapter(root: string) {
  const script = path.join(
    root,
    "branch-review/scripts/scope-decision-artifacts.sh",
  );
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(helperScript, script);
  await chmod(script, 0o755);
  return script;
}

describe.skipIf(!jqAvailable)("branch-review scope-decision adapter", () => {
  it("preserves prepare and validate commands in the source skill layout", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      await writeJson(cwd, decisionPath, initialScope(baseSha, headSha));

      await expect(
        runHelper(cwd, helperScript, "prepare-scope-decision-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${decisionPath}\n` });
      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
        }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("classifies absent risk-signals as absent without escalation", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const result = await runHelper(
        cwd,
        helperScript,
        "classify-risk-signals",
        {
          HEAD_SHA: headSha,
          FULL_DIFF_RANGE: "main...HEAD",
          RISK_SIGNALS_FILE: "",
          RISK_SIGNALS_STATUS: "absent",
        },
      );
      const values = parseKeyValues(result.stdout);

      expect(values.RISK_SIGNALS_CLASSIFICATION).toBe("absent");
      expect(values.RISK_SIGNALS_SEMANTIC_ESCALATION_REASON).toBe("");
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toBe("");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("classifies invalid risk-signal paths as fail-closed without reading them", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const result = await runHelper(
        cwd,
        helperScript,
        "classify-risk-signals",
        {
          HEAD_SHA: headSha,
          FULL_DIFF_RANGE: "main...HEAD",
          RISK_SIGNALS_FILE: ".ephemeral/nested/topic-risk-signals.json",
          RISK_SIGNALS_STATUS: "invalid-path",
        },
      );
      const values = parseKeyValues(result.stdout);

      expect(values.RISK_SIGNALS_CLASSIFICATION).toBe("invalid-fail-closed");
      expect(values.RISK_SIGNALS_SEMANTIC_ESCALATION_REASON).toBe(
        "ambiguous-classification",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "invalid-path",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "full branch review",
      );
      expect(result.stdout).not.toContain("prior_findings_validation");
      expect(result.stdout).not.toContain("narrow_allowed");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("keeps invalid risk-signal path text from injecting KEY=VALUE output", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const result = await runHelper(
        cwd,
        helperScript,
        "classify-risk-signals",
        {
          HEAD_SHA: headSha,
          FULL_DIFF_RANGE: "main...HEAD",
          RISK_SIGNALS_FILE:
            ".ephemeral/bad\nRISK_SIGNALS_SEMANTIC_ESCALATION_REASON=-risk-signals.json",
          RISK_SIGNALS_STATUS: "invalid-path",
        },
      );
      const values = parseKeyValues(result.stdout);
      const outputLines = result.stdout.trim().split("\n");

      expect(outputLines).toHaveLength(3);
      expect(values.RISK_SIGNALS_CLASSIFICATION).toBe("invalid-fail-closed");
      expect(values.RISK_SIGNALS_SEMANTIC_ESCALATION_REASON).toBe(
        "ambiguous-classification",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "full branch review",
      );
      expect(result.stdout).not.toContain(
        "\nRISK_SIGNALS_SEMANTIC_ESCALATION_REASON=-risk-signals.json",
      );
      expect(result.stdout).not.toContain("prior_findings_validation");
      expect(result.stdout).not.toContain("narrow_allowed");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("classifies supplied valid no-risk signals without escalation", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const riskSignalsFile = ".ephemeral/topic-risk-signals.json";
      await writeJson(cwd, riskSignalsFile, riskSignals(baseSha, headSha));

      const result = await runHelper(
        cwd,
        helperScript,
        "classify-risk-signals",
        {
          HEAD_SHA: headSha,
          FULL_DIFF_RANGE: "main...HEAD",
          RISK_SIGNALS_FILE: riskSignalsFile,
          RISK_SIGNALS_STATUS: "supplied",
        },
      );
      const values = parseKeyValues(result.stdout);

      expect(values.RISK_SIGNALS_CLASSIFICATION).toBe("valid-no-escalation");
      expect(values.RISK_SIGNALS_SEMANTIC_ESCALATION_REASON).toBe("");
      expect(result.stdout).not.toContain("narrow_allowed");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("classifies supplied contract example discipline context as sanitized source-owned contract escalation", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const riskSignalsFile = ".ephemeral/topic-risk-signals.json";
      const contextPath = contractExampleContextPath(headSha);
      await writeJson(
        cwd,
        riskSignalsFile,
        riskSignals(baseSha, headSha, {
          contract_example_discipline: {
            present: true,
            source: "extracted-plan-task-execution-context",
            obligations:
              "Valid examples must pass.\nInvalid families must fail for the named dimension.",
            consumer_rule: "FULL CONSUMER RULE SHOULD NOT BE REPEATED",
            proof_obligations: {
              valid_examples_pass: true,
              invalid_families_fail: true,
            },
          },
        }),
      );

      const result = await runHelper(
        cwd,
        helperScript,
        "classify-risk-signals",
        {
          HEAD_SHA: headSha,
          FULL_DIFF_RANGE: "main...HEAD",
          RISK_SIGNALS_FILE: riskSignalsFile,
          RISK_SIGNALS_STATUS: "supplied",
        },
      );
      const values = parseKeyValues(result.stdout);

      expect(values.RISK_SIGNALS_CLASSIFICATION).toBe("valid-escalate");
      expect(values.RISK_SIGNALS_SEMANTIC_ESCALATION_REASON).toBe(
        "source-owned-contract",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "contract_example_discipline: present",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "source: extracted-plan-task-execution-context",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "proof_obligations.valid_examples_pass: true",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "proof_obligations.invalid_families_fail: true",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "triggers: contract_example_discipline",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        `contract_example_discipline_context_path: ${contextPath}`,
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).not.toContain(
        "obligations_excerpt",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).not.toContain(
        "Invalid families must fail for the named dimension.",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).not.toContain(
        "FULL CONSUMER RULE SHOULD NOT BE REPEATED",
      );

      await expect(readJson(cwd, contextPath)).resolves.toMatchObject({
        schema: "branch-review/contract-example-discipline-context/v1",
        producer: "branch-review",
        head_sha: headSha,
        source_risk_signals_file: riskSignalsFile,
        contract_example_discipline: {
          present: true,
          source: "extracted-plan-task-execution-context",
          obligations:
            "Valid examples must pass.\nInvalid families must fail for the named dimension.",
          consumer_rule: "FULL CONSUMER RULE SHOULD NOT BE REPEATED",
          proof_obligations: {
            valid_examples_pass: true,
            invalid_families_fail: true,
          },
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("classifies supplied high-risk signals with fixed-order escalation reasons", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const riskSignalsFile = ".ephemeral/topic-risk-signals.json";
      await writeJson(
        cwd,
        riskSignalsFile,
        riskSignals(baseSha, headSha, {
          signals: {
            user_facing_behavior: "present",
            documentation_examples: "unknown",
            diagnostics: "present",
            contract: "present",
            generated_output: "present",
            governance_path: "present",
          },
          canonical_docs_may_be_affected: true,
          end_user_diagnostics_may_be_affected: true,
        }),
      );

      const result = await runHelper(
        cwd,
        helperScript,
        "classify-risk-signals",
        {
          HEAD_SHA: headSha,
          FULL_DIFF_RANGE: "main...HEAD",
          RISK_SIGNALS_FILE: riskSignalsFile,
          RISK_SIGNALS_STATUS: "supplied",
        },
      );
      const values = parseKeyValues(result.stdout);

      expect(values.RISK_SIGNALS_CLASSIFICATION).toBe("valid-escalate");
      expect(values.RISK_SIGNALS_SEMANTIC_ESCALATION_REASON).toBe(
        "ambiguous-classification,generated-output-contract,shared-workflow-policy,source-owned-contract",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        riskSignalsFile,
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "documentation_examples",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "generated_output",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "governance_path",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "canonical_docs_may_be_affected",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "end_user_diagnostics_may_be_affected",
      );
      expect(result.stdout).not.toContain("prior_findings_validation");
      expect(result.stdout).not.toContain("narrow_allowed");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("classifies validator-rejected supplied risk-signals as fail-closed ambiguity", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const riskSignalsFile = ".ephemeral/topic-risk-signals.json";
      await writeJson(
        cwd,
        riskSignalsFile,
        riskSignals(baseSha, headSha, { reviewed_range: "stale...HEAD" }),
      );

      const result = await runHelper(
        cwd,
        helperScript,
        "classify-risk-signals",
        {
          HEAD_SHA: headSha,
          FULL_DIFF_RANGE: "main...HEAD",
          RISK_SIGNALS_FILE: riskSignalsFile,
          RISK_SIGNALS_STATUS: "supplied",
        },
      );
      const values = parseKeyValues(result.stdout);

      expect(values.RISK_SIGNALS_CLASSIFICATION).toBe("invalid-fail-closed");
      expect(values.RISK_SIGNALS_SEMANTIC_ESCALATION_REASON).toBe(
        "ambiguous-classification",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "risk-signals reviewed range mismatch",
      );
      expect(values.RISK_SIGNALS_SEMANTIC_DECISION_NOTES).toContain(
        "higher scrutiny",
      );
      expect(result.stdout).not.toContain("prior_findings_validation");
      expect(result.stdout).not.toContain("narrow_allowed");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("prepares, writes, validates, and announces an approval summary after linked evidence is available", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      const summaryPath = approvalSummaryPath(headSha);
      const findingsFile = await writeEmptyFindings(cwd, headSha);
      await writeJson(
        cwd,
        decisionPath,
        initialScope("main", headSha, {
          full_range: "main...HEAD",
          selected_range: "main...HEAD",
          candidate_narrow_range: "main...HEAD",
          selection_reason: "not-followup",
        }),
      );

      await expect(
        runHelper(cwd, helperScript, "prepare-approval-summary-write", {
          HEAD_SHA: headSha,
        }),
      ).resolves.toMatchObject({ stdout: `${summaryPath}\n` });

      await expect(
        runHelper(cwd, helperScript, "write-approval-summary", {
          HEAD_SHA: headSha,
          BASE: "main",
          FULL_DIFF_RANGE: "main...HEAD",
          ACTIVE_DIFF_RANGE: "main...HEAD",
          SCOPE_DECISION_FILE: decisionPath,
          FINDINGS_FILE: findingsFile,
          APPROVAL_SUMMARY_FILE: summaryPath,
        }),
      ).resolves.toMatchObject({
        stdout: `Approval summary written to ${summaryPath}.\n`,
      });

      await expect(readJson(cwd, summaryPath)).resolves.toMatchObject({
        schema: "branch-review/approval-summary/v1",
        surface: "branch-review",
        review_head_sha: headSha,
        base_ref: "main",
        full_range: "main...HEAD",
        selected_range: "main...HEAD",
        scope_decision_file: decisionPath,
        findings_file: findingsFile,
        terminal_state: "approved",
        blocker_count: 0,
        nit_count: 0,
        carry_forward_count: 0,
      });
      const summary = await readJson(cwd, summaryPath);
      expect(summary).not.toHaveProperty("gate_passed");
      expect(JSON.stringify(summary)).not.toContain("recommendation");
      expect(JSON.stringify(summary)).not.toContain("body");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("derives blocked approval summaries from final findings evidence", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      const summaryPath = approvalSummaryPath(headSha);
      const findingsFile = findingsPath(headSha);
      await writeJson(
        cwd,
        decisionPath,
        initialScope("main", headSha, {
          full_range: "main...HEAD",
          selected_range: "main...HEAD",
          candidate_narrow_range: "main...HEAD",
          selection_reason: "not-followup",
        }),
      );
      await writeJson(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [
          {
            path: "src/app.ts",
            line: 1,
            start_line: null,
            severity: "Blocking",
            category: "Logic",
            critic: "VALID",
            anchor: "natural",
            why: "The value is wrong.",
            recommendation: "Use the correct value.",
            body: "**Blocking | Logic** — The value is wrong.\n\n**Recommendation:** Use the correct value.",
          },
        ],
        carry_forward: [],
      });

      await expect(
        runHelper(cwd, helperScript, "write-approval-summary", {
          HEAD_SHA: headSha,
          BASE: "main",
          FULL_DIFF_RANGE: "main...HEAD",
          ACTIVE_DIFF_RANGE: "main...HEAD",
          SCOPE_DECISION_FILE: decisionPath,
          FINDINGS_FILE: findingsFile,
          APPROVAL_SUMMARY_FILE: summaryPath,
        }),
      ).resolves.toMatchObject({
        stdout: `Approval summary written to ${summaryPath}.\n`,
      });

      await expect(readJson(cwd, summaryPath)).resolves.toMatchObject({
        terminal_state: "blocked",
        blocker_count: 1,
        nit_count: 0,
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("stops before writing an approval summary when linked scope evidence is mismatched", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      const summaryPath = approvalSummaryPath(headSha);
      const findingsFile = await writeEmptyFindings(cwd, headSha);
      await writeJson(
        cwd,
        decisionPath,
        initialScope("main", headSha, {
          full_range: "main...HEAD",
          selected_range: "main...HEAD",
          candidate_narrow_range: "main...HEAD",
          head_sha: "a".repeat(40),
        }),
      );

      await expect(
        runHelper(cwd, helperScript, "write-approval-summary", {
          HEAD_SHA: headSha,
          BASE: "main",
          FULL_DIFF_RANGE: "main...HEAD",
          ACTIVE_DIFF_RANGE: "main...HEAD",
          SCOPE_DECISION_FILE: decisionPath,
          FINDINGS_FILE: findingsFile,
          APPROVAL_SUMMARY_FILE: summaryPath,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "scope decision evidence validation failed",
        ),
      });
      await expect(
        readFile(path.join(cwd, summaryPath), "utf8"),
      ).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("stops before writing the final approval summary when full findings validation fails", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      const summaryPath = approvalSummaryPath(headSha);
      const findingsFile = findingsPath(headSha);
      await writeJson(
        cwd,
        decisionPath,
        initialScope("main", headSha, {
          full_range: "main...HEAD",
          selected_range: "main...HEAD",
          candidate_narrow_range: "main...HEAD",
          selection_reason: "not-followup",
        }),
      );
      await writeJson(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [
          {
            severity: "Blocking",
          },
        ],
        carry_forward: [],
      });

      await expect(
        runHelper(cwd, helperScript, "write-approval-summary", {
          HEAD_SHA: headSha,
          BASE: "main",
          FULL_DIFF_RANGE: "main...HEAD",
          ACTIVE_DIFF_RANGE: "main...HEAD",
          SCOPE_DECISION_FILE: decisionPath,
          FINDINGS_FILE: findingsFile,
          APPROVAL_SUMMARY_FILE: summaryPath,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("approval summary validation failed"),
      });
      await expect(
        readFile(path.join(cwd, summaryPath), "utf8"),
      ).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("removes stale final approval summaries when support validation fails before publish", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-approval-failing-"),
    );
    try {
      const decisionPath = scopePath(headSha);
      const summaryPath = approvalSummaryPath(headSha);
      const findingsFile = await writeEmptyFindings(cwd, headSha);
      const validator = await writeFailingValidator(
        temp,
        "support validator rejected approval summary",
      );
      await writeJson(
        cwd,
        decisionPath,
        initialScope("main", headSha, {
          full_range: "main...HEAD",
          selected_range: "main...HEAD",
          candidate_narrow_range: "main...HEAD",
          selection_reason: "not-followup",
        }),
      );
      await writeFile(
        path.join(cwd, summaryPath),
        JSON.stringify({ stale: true }),
      );

      await expect(
        runHelper(cwd, helperScript, "write-approval-summary", {
          HEAD_SHA: headSha,
          BASE: "main",
          FULL_DIFF_RANGE: "main...HEAD",
          ACTIVE_DIFF_RANGE: "main...HEAD",
          SCOPE_DECISION_FILE: decisionPath,
          FINDINGS_FILE: findingsFile,
          APPROVAL_SUMMARY_FILE: summaryPath,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("approval summary validation failed"),
      });
      await expect(
        readFile(path.join(cwd, summaryPath), "utf8"),
      ).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("delegates approval-summary validation with exact linked evidence paths", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-approval-marker-"),
    );
    try {
      const decisionPath = scopePath(headSha);
      const summaryPath = approvalSummaryPath(headSha);
      const findingsFile = await writeEmptyFindings(cwd, headSha);
      const markerArgs = path.join(temp, "args.txt");
      const validator = await writeMarkerValidator(temp, "approval-validator");
      await writeJson(
        cwd,
        decisionPath,
        initialScope("main", headSha, {
          full_range: "main...HEAD",
          selected_range: "main...HEAD",
          candidate_narrow_range: "main...HEAD",
          selection_reason: "not-followup",
        }),
      );

      await expect(
        runHelper(cwd, helperScript, "write-approval-summary", {
          HEAD_SHA: headSha,
          BASE: "main",
          FULL_DIFF_RANGE: "main...HEAD",
          ACTIVE_DIFF_RANGE: "main...HEAD",
          SCOPE_DECISION_FILE: decisionPath,
          FINDINGS_FILE: findingsFile,
          APPROVAL_SUMMARY_FILE: summaryPath,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          MARKER_ARGS_FILE: markerArgs,
        }),
      ).resolves.toMatchObject({
        stdout: `approval-validator\nApproval summary written to ${summaryPath}.\n`,
      });
      const args = await readFile(markerArgs, "utf8");
      expect(args).toContain("validate-approval-summary");
      expect(args).toContain("--expected-findings-file");
      expect(args).toContain(findingsFile);
      expect(args).toContain("--expected-scope-decision-file");
      expect(args).toContain(decisionPath);
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("uses an explicit support-validator override and forwards branch scope policy flags", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const temp = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-marker-"),
    );
    try {
      const decisionPath = scopePath(headSha);
      const markerArgs = path.join(temp, "args.txt");
      const validator = await writeMarkerValidator(temp, "override-validator");

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN: "^app/",
          MARKER_ARGS_FILE: markerArgs,
        }),
      ).resolves.toMatchObject({ stdout: "override-validator\n" });
      await expect(readFile(markerArgs, "utf8")).resolves.toContain(
        "--configured-path-pattern",
      );
      await expect(readFile(markerArgs, "utf8")).resolves.toContain(
        "branch-review/scope-decision/v1",
      );
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(temp);
    }
  });

  it("resolves an installed-style sibling support validator", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-installed-"),
    );
    try {
      const script = await copyInstalledBranchAdapter(root);
      await writeMarkerValidator(root, "installed-validator");

      await expect(
        runHelper(cwd, script, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
        }),
      ).resolves.toMatchObject({ stdout: "installed-validator\n" });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("fails loud when the support validator is unavailable", async () => {
    const { cwd, headSha } = await makeGitWorkspace();
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-branch-missing-"),
    );
    try {
      const script = await copyInstalledBranchAdapter(root);
      await expect(
        runHelper(cwd, script, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: scopePath(headSha),
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "play-validate-review-artifacts validator missing",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("surfaces delegated support-validator policy failures", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);
      await writeJson(
        cwd,
        decisionPath,
        initialScope(baseSha, headSha, {
          mechanical_facts: {
            changed_file_count: 2,
            followup_sha_usable: false,
            mechanical_escalate_full: true,
            mechanical_escalation_reason: "not-followup",
          },
        }),
      );

      await expect(
        runHelper(cwd, helperScript, "validate-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "changed file count does not match selected range",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("finalizes an initial full review with range-validation reason fields", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "finalize-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          FULL_DIFF_RANGE: `${baseSha}...HEAD`,
          CANDIDATE_ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
          ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
          IS_FOLLOWUP_NARROW: "false",
          CHANGED_FILE_COUNT: "1",
          FOLLOWUP_SHA_USABLE: "false",
          MECHANICAL_ESCALATE_FULL: "true",
          MECHANICAL_ESCALATION_REASON: "not-followup",
          FINAL_CHANGED_FILES_JSON: JSON.stringify(["src/app.ts"]),
          FINAL_LANGUAGE_HINTS_JSON: JSON.stringify(["ts"]),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, decisionPath)).resolves.toMatchObject({
        schema: "branch-review/scope-decision/v1",
        selected_range: `${baseSha}...HEAD`,
        selection_reason: "not-followup",
        escalation_reasons: ["not-followup"],
        scope_reason_codes: ["range_validation"],
        scope_explanation: expect.stringContaining("Initial review"),
        mechanical_facts: {
          mechanical_escalation_reason: "not-followup",
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("finalizes initial full review with risk-signal semantic escalation", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "finalize-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          FULL_DIFF_RANGE: `${baseSha}...HEAD`,
          CANDIDATE_ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
          ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
          IS_FOLLOWUP_NARROW: "false",
          CHANGED_FILE_COUNT: "1",
          FOLLOWUP_SHA_USABLE: "false",
          MECHANICAL_ESCALATE_FULL: "true",
          MECHANICAL_ESCALATION_REASON: "not-followup",
          SEMANTIC_ESCALATION_REASON:
            "generated-output-contract,shared-workflow-policy,source-owned-contract",
          SEMANTIC_DECISION_NOTES:
            "Valid risk signals require higher scrutiny.",
          FINAL_CHANGED_FILES_JSON: JSON.stringify(["src/app.ts"]),
          FINAL_LANGUAGE_HINTS_JSON: JSON.stringify(["ts"]),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, decisionPath)).resolves.toMatchObject({
        selected_range: `${baseSha}...HEAD`,
        escalation_reasons: [
          "generated-output-contract",
          "not-followup",
          "shared-workflow-policy",
          "source-owned-contract",
        ],
        scope_reason_codes: [
          "language_or_surface_change",
          "range_validation",
          "semantic_contract_risk",
        ],
        semantic_decision: {
          checked: true,
          ambiguous: false,
          notes: "Valid risk signals require higher scrutiny.",
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("finalizes initial full review with fail-closed risk-signal ambiguity", async () => {
    const { cwd, baseSha, headSha } = await makeGitWorkspace();
    try {
      const decisionPath = scopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "finalize-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          FULL_DIFF_RANGE: `${baseSha}...HEAD`,
          CANDIDATE_ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
          ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
          IS_FOLLOWUP_NARROW: "false",
          CHANGED_FILE_COUNT: "1",
          FOLLOWUP_SHA_USABLE: "false",
          MECHANICAL_ESCALATE_FULL: "true",
          MECHANICAL_ESCALATION_REASON: "not-followup",
          SEMANTIC_ESCALATION_REASON: "ambiguous-classification",
          SEMANTIC_DECISION_NOTES:
            "Supplied risk signals failed validation; using full branch review.",
          FINAL_CHANGED_FILES_JSON: JSON.stringify(["src/app.ts"]),
          FINAL_LANGUAGE_HINTS_JSON: JSON.stringify(["ts"]),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, decisionPath)).resolves.toMatchObject({
        selected_range: `${baseSha}...HEAD`,
        escalation_reasons: ["ambiguous-classification", "not-followup"],
        scope_reason_codes: ["range_validation", "semantic_contract_risk"],
        semantic_decision: {
          checked: true,
          ambiguous: true,
          notes:
            "Supplied risk signals failed validation; using full branch review.",
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("finalizes mechanical full escalation with file-count and governed-path reason fields", async () => {
    const { cwd, baseSha } = await makeGitWorkspace();
    try {
      const lastReviewedSha = baseSha;
      await mkdir(path.join(cwd, "docs/adr"), { recursive: true });
      await writeFile(path.join(cwd, "docs/adr/adr-9999.md"), "ADR\n");
      for (let index = 0; index < 6; index += 1) {
        await writeFile(path.join(cwd, `src/multi-${index}.ts`), "x\n");
      }
      await execFileAsync("git", ["add", "."], { cwd });
      await execFileAsync("git", ["commit", "-m", "test: multi trigger"], {
        cwd,
      });
      const newHead = await git(cwd, "rev-parse", "HEAD");
      const decisionPath = scopePath(newHead);

      await expect(
        runHelper(cwd, helperScript, "finalize-scope-decision", {
          HEAD_SHA: newHead,
          SCOPE_DECISION_FILE: decisionPath,
          FULL_DIFF_RANGE: `${baseSha}...HEAD`,
          CANDIDATE_ACTIVE_DIFF_RANGE: `${lastReviewedSha}..HEAD`,
          ACTIVE_DIFF_RANGE: `${baseSha}...HEAD`,
          IS_FOLLOWUP_NARROW: "false",
          LAST_REVIEWED_SHA: lastReviewedSha,
          PRIOR_BRANCH_FINDINGS: ".ephemeral/topic-findings.json",
          CHANGED_FILE_COUNT: "8",
          FOLLOWUP_SHA_USABLE: "true",
          MECHANICAL_ESCALATE_FULL: "true",
          MECHANICAL_ESCALATION_REASON: "file-count,governance-path",
          FINAL_CHANGED_FILES_JSON: JSON.stringify([
            "docs/adr/adr-9999.md",
            ...Array.from({ length: 6 }, (_, index) => `src/multi-${index}.ts`),
            "src/app.ts",
          ]),
          FINAL_LANGUAGE_HINTS_JSON: JSON.stringify(["md", "ts"]),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, decisionPath)).resolves.toMatchObject({
        schema: "branch-review/scope-decision/v1",
        selected_range: `${baseSha}...HEAD`,
        is_followup_narrow: false,
        escalation_reasons: ["file-count", "governance-path"],
        scope_reason_codes: ["file_count", "governed_path"],
        scope_explanation: expect.stringMatching(/file count|govern/i),
        mechanical_facts: {
          mechanical_escalation_reason: "file-count,governance-path",
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("finalizes a mechanically narrow follow-up as full when semantic classification escalates", async () => {
    const { cwd, lastReviewedSha, headSha } = await makeFollowupWorkspace();
    try {
      const decisionPath = scopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "finalize-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          FULL_DIFF_RANGE: "main...HEAD",
          CANDIDATE_ACTIVE_DIFF_RANGE: `${lastReviewedSha}..HEAD`,
          ACTIVE_DIFF_RANGE: "main...HEAD",
          IS_FOLLOWUP_NARROW: "false",
          LAST_REVIEWED_SHA: lastReviewedSha,
          PRIOR_BRANCH_FINDINGS: ".ephemeral/topic-findings.json",
          CHANGED_FILE_COUNT: "1",
          FOLLOWUP_SHA_USABLE: "true",
          MECHANICAL_ESCALATE_FULL: "false",
          MECHANICAL_ESCALATION_REASON: "",
          SEMANTIC_ESCALATION_REASON: "source-owned-contract",
          SEMANTIC_DECISION_NOTES:
            "Wrapper semantic classification found source-owned contract impact.",
          FINAL_CHANGED_FILES_JSON: JSON.stringify([
            "notes/followup.md",
            "src/full-only.ts",
          ]),
          FINAL_LANGUAGE_HINTS_JSON: JSON.stringify(["md", "ts"]),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, decisionPath)).resolves.toMatchObject({
        schema: "branch-review/scope-decision/v1",
        selected_range: "main...HEAD",
        is_followup_narrow: false,
        escalation_reasons: ["source-owned-contract"],
        scope_reason_codes: ["semantic_contract_risk"],
        scope_explanation: expect.stringContaining(
          "source-owned contract impact",
        ),
        semantic_decision: {
          checked: true,
          ambiguous: false,
          notes:
            "Wrapper semantic classification found source-owned contract impact.",
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("finalizes ambiguous semantic classification with semantic ambiguity recorded", async () => {
    const { cwd, lastReviewedSha, headSha } = await makeFollowupWorkspace();
    try {
      const decisionPath = scopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "finalize-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          FULL_DIFF_RANGE: "main...HEAD",
          CANDIDATE_ACTIVE_DIFF_RANGE: `${lastReviewedSha}..HEAD`,
          ACTIVE_DIFF_RANGE: "main...HEAD",
          IS_FOLLOWUP_NARROW: "false",
          LAST_REVIEWED_SHA: lastReviewedSha,
          PRIOR_BRANCH_FINDINGS: ".ephemeral/topic-findings.json",
          CHANGED_FILE_COUNT: "1",
          FOLLOWUP_SHA_USABLE: "true",
          MECHANICAL_ESCALATE_FULL: "false",
          MECHANICAL_ESCALATION_REASON: "",
          SEMANTIC_ESCALATION_REASON: "ambiguous-classification",
          SEMANTIC_DECISION_NOTES:
            "Wrapper semantic classification could not prove narrow scope.",
          FINAL_CHANGED_FILES_JSON: JSON.stringify([
            "notes/followup.md",
            "src/full-only.ts",
          ]),
          FINAL_LANGUAGE_HINTS_JSON: JSON.stringify(["md", "ts"]),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, decisionPath)).resolves.toMatchObject({
        schema: "branch-review/scope-decision/v1",
        selected_range: "main...HEAD",
        is_followup_narrow: false,
        escalation_reasons: ["ambiguous-classification"],
        scope_reason_codes: ["semantic_contract_risk"],
        scope_explanation: expect.stringContaining("could not prove narrow"),
        semantic_decision: {
          checked: true,
          ambiguous: true,
          notes:
            "Wrapper semantic classification could not prove narrow scope.",
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("finalizes a mechanically narrow follow-up as narrow when semantic classification preserves it", async () => {
    const { cwd, lastReviewedSha, headSha } = await makeFollowupWorkspace();
    try {
      const decisionPath = scopePath(headSha);

      await expect(
        runHelper(cwd, helperScript, "finalize-scope-decision", {
          HEAD_SHA: headSha,
          SCOPE_DECISION_FILE: decisionPath,
          FULL_DIFF_RANGE: "main...HEAD",
          CANDIDATE_ACTIVE_DIFF_RANGE: `${lastReviewedSha}..HEAD`,
          ACTIVE_DIFF_RANGE: `${lastReviewedSha}..HEAD`,
          IS_FOLLOWUP_NARROW: "true",
          LAST_REVIEWED_SHA: lastReviewedSha,
          PRIOR_BRANCH_FINDINGS: ".ephemeral/topic-findings.json",
          CHANGED_FILE_COUNT: "1",
          FOLLOWUP_SHA_USABLE: "true",
          MECHANICAL_ESCALATE_FULL: "false",
          MECHANICAL_ESCALATION_REASON: "",
          SEMANTIC_DECISION_NOTES:
            "Wrapper semantic classification permits narrow follow-up.",
          FINAL_CHANGED_FILES_JSON: JSON.stringify(["notes/followup.md"]),
          FINAL_LANGUAGE_HINTS_JSON: JSON.stringify(["md"]),
        }),
      ).resolves.toMatchObject({ stdout: "" });

      await expect(readJson(cwd, decisionPath)).resolves.toMatchObject({
        schema: "branch-review/scope-decision/v1",
        selected_range: `${lastReviewedSha}..HEAD`,
        is_followup_narrow: true,
        escalation_reasons: [],
        scope_reason_codes: ["narrow_allowed"],
        scope_explanation: expect.stringContaining("permits narrow follow-up"),
        semantic_decision: {
          checked: true,
          ambiguous: false,
          notes: "Wrapper semantic classification permits narrow follow-up.",
        },
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
