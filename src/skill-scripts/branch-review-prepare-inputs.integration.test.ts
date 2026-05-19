import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
  await execFileAsync("git", ["add", filePath], { cwd });
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

async function runHelper(cwd: string, args: string[] = []) {
  const result = await execFileAsync("bash", [helperScript, ...args], {
    cwd,
    env: { ...process.env, PLAY_REVIEW_DIR: playReviewDir },
  });
  const values: Record<string, string> = {};
  for (const line of result.stdout.trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

describe.skipIf(!jqAvailable)("branch-review prepare inputs helper", () => {
  it("defaults to full branch review without follow-up inputs", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await commitFile(cwd, "src/app.ts", "export const value = 1;\n");

      const values = await runHelper(cwd);

      expect(values.BASE).toBe("main");
      expect(values.FIX_MODE).toBe("false");
      expect(values.FULL_DIFF_RANGE).toBe("main...HEAD");
      expect(values.ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.ESCALATE_FULL).toBe("true");
      expect(values.ESCALATION_REASON).toBe("not-followup");
      expect(values.LANGUAGE_HINTS).toBe("ts");
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
      await commitFile(cwd, "src/app.ts", "export const value = 2;\n");

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
      expect(values.ACTIVE_DIFF_RANGE).toBe(`${lastReviewedSha}..HEAD`);
      expect(values.IS_FOLLOWUP_NARROW).toBe("true");
      expect(values.ESCALATE_FULL).toBe("false");
      expect(values.PRIOR_BRANCH_FINDINGS).toBe(findingsFile);
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

      expect(values.ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.ESCALATE_FULL).toBe("true");
      expect(values.ESCALATION_REASON).toContain("file-count");
      expect(values.ESCALATION_REASON).toContain("governance-path");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("escalates follow-up review to the full branch for skill and generated-output contract paths", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const lastReviewedSha = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
      ).stdout.trim();
      const findingsFile = await writeFindingsEnvelope(cwd, lastReviewedSha);
      await mkdir(path.join(cwd, "skills/branch-review"), { recursive: true });
      await writeFile(
        path.join(cwd, "skills/branch-review/SKILL.md"),
        "policy\n",
      );
      await mkdir(path.join(cwd, "src/render"), { recursive: true });
      await writeFile(path.join(cwd, "src/render/pipeline.ts"), "render\n");
      await execFileAsync(
        "git",
        ["add", "skills/branch-review/SKILL.md", "src/render/pipeline.ts"],
        { cwd },
      );
      await execFileAsync(
        "git",
        ["commit", "-m", "test: governed path change"],
        { cwd },
      );

      const values = await runHelper(cwd, [
        "--last-reviewed",
        lastReviewedSha,
        "--prior-findings",
        findingsFile,
      ]);

      expect(values.ACTIVE_DIFF_RANGE).toBe("main...HEAD");
      expect(values.IS_FOLLOWUP_NARROW).toBe("false");
      expect(values.ESCALATE_FULL).toBe("true");
      expect(values.ESCALATION_REASON).toContain("governance-path");
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
