import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
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

function riskSignalsArgs(
  headSha: string,
  file = ".ephemeral/topic-risk-signals.json",
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
    "main...HEAD",
  ];
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await mkdir(path.dirname(path.join(cwd, relPath)), { recursive: true });
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
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

  it("validates risk-signals artifacts with contract example discipline context", async () => {
    const { cwd, baseSha, headSha } = await makeRiskSignalsWorkspace();
    try {
      process.chdir(cwd);
      await writeJson(
        cwd,
        ".ephemeral/topic-risk-signals.json",
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: {
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
          },
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
      name: "malformed contract example discipline context",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: {
            present: true,
            source: "extracted-plan-task-execution-context",
            obligations: "",
            consumer_rule: "rule",
            proof_obligations: {
              valid_examples_pass: true,
              invalid_families_fail: true,
            },
          },
        }),
      stderr: "risk-signals schema mismatch",
    },
    {
      name: "contract example discipline context with extra proof key",
      artifact: (baseSha: string, headSha: string) =>
        riskSignalsArtifact(baseSha, headSha, {
          contract_example_discipline: {
            present: true,
            source: "extracted-plan-task-execution-context",
            obligations: "obligations",
            consumer_rule: "rule",
            proof_obligations: {
              valid_examples_pass: true,
              invalid_families_fail: true,
              extra: false,
            },
          },
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
