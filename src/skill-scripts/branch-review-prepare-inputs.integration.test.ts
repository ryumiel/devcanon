import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir } from "../__test-helpers__/fixtures.js";

const execFileAsync = promisify(execFile);
const helperScript = path.join(
  process.cwd(),
  "skills/branch-review/scripts/prepare-review-inputs.sh",
);
const playReviewDir = path.join(process.cwd(), "skills/play-review");
const jqAvailable = await commandAvailable("jq");

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeGitWorkspace(): Promise<string> {
  const cwd = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-branch-review-inputs-"),
  );
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  return cwd;
}

async function commitFile(
  cwd: string,
  filePath: string,
  content: string,
): Promise<void> {
  await mkdir(path.dirname(path.join(cwd, filePath)), { recursive: true });
  await writeFile(path.join(cwd, filePath), content);
  await execFileAsync("git", ["add", "--", filePath], { cwd });
  await execFileAsync("git", ["commit", "-m", `test: add ${filePath}`], {
    cwd,
  });
}

async function writeFindingsEnvelope(cwd: string, headSha: string) {
  const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
  await mkdir(path.join(cwd, ".ephemeral"), { recursive: true });
  await writeFile(
    path.join(cwd, findingsFile),
    JSON.stringify({
      schema: "play-review/findings/v1",
      findings: [],
      carry_forward: [],
    }),
  );
  return findingsFile;
}

function parseHelperOutput(stdout: string) {
  const values: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function runHelper(
  cwd: string,
  args: string[] = [],
  env: Record<string, string> = {},
) {
  const result = await execFileAsync("bash", [helperScript, ...args], {
    cwd,
    env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir, ...env },
  });
  return parseHelperOutput(result.stdout);
}

async function readChangedFiles(cwd: string, changedFilesFile: string) {
  const content = await readFile(path.join(cwd, changedFilesFile), "utf8");
  return content.trim().split("\n").filter(Boolean);
}

async function writeFailingSupportValidator(cwd: string, message: string) {
  const validator = path.join(cwd, ".ephemeral/failing-support-validator.sh");
  await mkdir(path.dirname(validator), { recursive: true });
  await writeFile(
    validator,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `printf '%s\\n' ${JSON.stringify(message)} >&2`,
      "exit 1",
      "",
    ].join("\n"),
  );
  await chmod(validator, 0o755);
  return validator;
}

describe.skipIf(!jqAvailable)("branch-review prepare inputs helper", () => {
  it("defaults to full branch review without follow-up inputs", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await commitFile(cwd, "src/app.ts", "export const value = 1;\n");
      const headSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();

      const values = await runHelper(cwd);

      expect(values.BASE).toBe("main");
      expect(values.FIX_MODE).toBe("false");
      expect(values.FULL_DIFF_RANGE).toBe("main...HEAD");
      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("true");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe("not-followup");
      expect(values.FOLLOWUP_SHA_USABLE).toBe("false");
      expect(values.CHANGED_FILE_COUNT).toBe("1");
      expect(values.LANGUAGE_HINTS).toBe("ts");
      expect(path.dirname(values.CHANGED_FILES_FILE)).toBe(".ephemeral");
      expect(values.SCOPE_DECISION_FILE).toBe(
        `.ephemeral/topic-${headSha}-scope-decision.json`,
      );
      await expect(
        readChangedFiles(cwd, values.CHANGED_FILES_FILE),
      ).resolves.toEqual(["src/app.ts"]);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("accepts flags around the base and selects a narrow follow-up range", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      await commitFile(cwd, "notes/followup.md", "narrow\n");

      const values = await runHelper(cwd, [
        "--fix",
        "--last-reviewed",
        lastReviewedSha,
        "main",
        "--prior-findings",
        findingsFile,
      ]);

      expect(values.BASE).toBe("main");
      expect(values.FIX_MODE).toBe("true");
      expect(values.FULL_DIFF_RANGE).toBe("main...HEAD");
      expect(values.CANDIDATE_ACTIVE_DIFF_RANGE).toBe(
        `${lastReviewedSha}..HEAD`,
      );
      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe(
        `${lastReviewedSha}..HEAD`,
      );
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("true");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("false");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe("");
      expect(values.FOLLOWUP_SHA_USABLE).toBe("true");
      expect(values.CHANGED_FILE_COUNT).toBe("1");
      expect(values.LANGUAGE_HINTS).toBe("md");
      expect(values.PRIOR_BRANCH_FINDINGS).toBe(findingsFile);
      await expect(
        readChangedFiles(cwd, values.CHANGED_FILES_FILE),
      ).resolves.toEqual(["notes/followup.md"]);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("escalates follow-up review to the full branch for broad or governed changes", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      for (let index = 0; index < 6; index += 1) {
        await mkdir(path.join(cwd, "src"), { recursive: true });
        await writeFile(path.join(cwd, `src/file-${index}.ts`), `${index}\n`);
      }
      await mkdir(path.join(cwd, "docs/adr"), { recursive: true });
      await writeFile(path.join(cwd, "docs/adr/adr-9999-test.md"), "adr\n");
      await execFileAsync("git", ["add", "src", "docs/adr/adr-9999-test.md"], {
        cwd,
      });
      await execFileAsync("git", ["commit", "-m", "test: broad change"], {
        cwd,
      });

      const values = await runHelper(cwd, [
        "--last-reviewed",
        lastReviewedSha,
        "--prior-findings",
        findingsFile,
      ]);

      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("true");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe(
        "file-count,governance-path",
      );
      expect(values.FOLLOWUP_SHA_USABLE).toBe("true");
      expect(values.CHANGED_FILE_COUNT).toBe("7");
      expect(values.LANGUAGE_HINTS).toBe("md,ts");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("escalates follow-up review for product requirements changes", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      await commitFile(
        cwd,
        "docs/product-requirements/new-product.md",
        "intent\n",
      );

      const values = await runHelper(cwd, [
        "--last-reviewed",
        lastReviewedSha,
        "--prior-findings",
        findingsFile,
      ]);

      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("true");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe("governance-path");
      expect(values.FOLLOWUP_SHA_USABLE).toBe("true");
      expect(values.CHANGED_FILE_COUNT).toBe("1");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("does not treat src as a built-in mechanical escalation path", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      await commitFile(
        cwd,
        "src/cli/commands/foo.ts",
        "export const foo = 1;\n",
      );

      const values = await runHelper(cwd, [
        "--last-reviewed",
        lastReviewedSha,
        "--prior-findings",
        findingsFile,
      ]);

      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe(
        `${lastReviewedSha}..HEAD`,
      );
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("true");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("false");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe("");
      await expect(
        readChangedFiles(cwd, values.CHANGED_FILES_FILE),
      ).resolves.toEqual(["src/cli/commands/foo.ts"]);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("escalates follow-up review when a repo-owned path trigger matches", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      await commitFile(cwd, "app/workflow.ts", "export const value = 1;\n");

      const values = await runHelper(
        cwd,
        ["--last-reviewed", lastReviewedSha, "--prior-findings", findingsFile],
        {
          BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN: "^app/",
        },
      );

      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("true");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe("configured-path");
      expect(values.FOLLOWUP_SHA_USABLE).toBe("true");
      expect(values.CHANGED_FILE_COUNT).toBe("1");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("treats option-like repo-owned path triggers as regex patterns", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      await commitFile(cwd, "-review/path.md", "configured\n");

      const values = await runHelper(
        cwd,
        ["--last-reviewed", lastReviewedSha, "--prior-findings", findingsFile],
        {
          BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN: "-review/",
        },
      );

      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("true");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe("configured-path");
      expect(values.FOLLOWUP_SHA_USABLE).toBe("true");
      expect(values.CHANGED_FILE_COUNT).toBe("1");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("escalates unusable follow-up SHAs without emitting git probe noise", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const missingSha = "b".repeat(40);
      const findingsFile = await writeFindingsEnvelope(cwd, missingSha);
      await commitFile(cwd, "notes/followup.md", "fallback\n");

      const result = await execFileAsync(
        "bash",
        [
          helperScript,
          "--last-reviewed",
          missingSha,
          "--prior-findings",
          findingsFile,
        ],
        {
          cwd,
          env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
        },
      );
      const values = parseHelperOutput(result.stdout);

      expect(result.stderr).toBe("");
      expect(values.MECHANICAL_ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.MECHANICAL_IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.MECHANICAL_ESCALATE_FULL).toBe("true");
      expect(values.MECHANICAL_ESCALATION_REASON).toBe(
        "last-reviewed-unusable",
      );
      expect(values.FOLLOWUP_SHA_USABLE).toBe("false");
      expect(values.CHANGED_FILE_COUNT).toBe("1");
      await expect(
        readChangedFiles(cwd, values.CHANGED_FILES_FILE),
      ).resolves.toEqual(["notes/followup.md"]);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed for invalid configured path regexes in the normal path", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await commitFile(cwd, "src/app.ts", "export const value = 1;\n");

      await expect(
        execFileAsync("bash", [helperScript], {
          cwd,
          env: {
            ...process.env,
            PLAY_REVIEW_DIR: playReviewDir,
            BRANCH_REVIEW_FULL_REVIEW_PATH_PATTERN: "[",
          },
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "--configured-path-pattern must be a valid extended regular expression",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("writes changed files from the candidate follow-up range", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await commitFile(cwd, "src/full-only.ts", "export const fullOnly = 1;\n");
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      await commitFile(cwd, "notes/followup.md", "narrow\n");

      const values = await runHelper(cwd, [
        "--last-reviewed",
        lastReviewedSha,
        "--prior-findings",
        findingsFile,
      ]);

      await expect(
        readChangedFiles(cwd, values.CHANGED_FILES_FILE),
      ).resolves.toEqual(["notes/followup.md"]);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("does not validate the final scope decision during mechanical input preparation", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await commitFile(cwd, "src/app.ts", "export const value = 1;\n");
      const validator = await writeFailingSupportValidator(
        cwd,
        "changed file count does not match selected range",
      );

      await expect(
        execFileAsync("bash", [helperScript], {
          cwd,
          env: {
            ...process.env,
            PLAY_REVIEW_DIR: playReviewDir,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
          },
        }),
      ).resolves.toMatchObject({ stderr: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails closed for malformed follow-up inputs and parser errors", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);

      await expect(
        execFileAsync(
          "bash",
          [helperScript, "--last-reviewed", lastReviewedSha],
          {
            cwd,
            env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
          },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "--last-reviewed and --prior-findings must be supplied together",
        ),
      });
      await expect(
        execFileAsync("bash", [helperScript, "--last-reviewed"], {
          cwd,
          env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("--last-reviewed requires a SHA"),
      });
      await expect(
        execFileAsync("bash", [helperScript, "--unknown"], {
          cwd,
          env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("unknown branch-review argument"),
      });
      await expect(
        execFileAsync("bash", [helperScript, "main", "other"], {
          cwd,
          env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("multiple base arguments supplied"),
      });
      await expect(
        execFileAsync(
          "bash",
          [
            helperScript,
            "--last-reviewed",
            lastReviewedSha.toUpperCase(),
            "--prior-findings",
            findingsFile,
          ],
          {
            cwd,
            env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
          },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "--last-reviewed requires a 40-character lowercase hex SHA",
        ),
      });
      await expect(
        execFileAsync(
          "bash",
          [
            helperScript,
            "--last-reviewed",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "--prior-findings",
            findingsFile,
          ],
          {
            cwd,
            env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
          },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "--prior-findings review head must match --last-reviewed",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });
});
