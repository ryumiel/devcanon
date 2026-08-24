import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const sourceSkill = path.join(process.cwd(), "skills/pr-review/SKILL.md");
const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function sourceScopeNoticeConsumer(): Promise<string> {
  const skill = await readFile(sourceSkill, "utf8");
  const sectionStart = skill.indexOf("### Scope notice");
  const sectionEnd = skill.indexOf("Hand off to `play-review`", sectionStart);
  const match = skill
    .slice(sectionStart, sectionEnd)
    .match(/(emit_pr_review_scope_notice\(\) \{[\s\S]*?\nNODE\n\})/u);
  if (match === null) {
    throw new Error("Phase 4 scope-notice consumer block is missing");
  }
  return match[1];
}

async function runScopeNotice(
  artifact: string | undefined,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-pr-scope-notice-"),
  );
  createdRoots.push(root);
  const consumer = await sourceScopeNoticeConsumer();
  const script = path.join(root, "scope-notice.sh");
  await writeFile(
    script,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      consumer,
      "emit_pr_review_scope_notice",
      'printf "PLAY_REVIEW_CONTINUATION\\n"',
      "",
    ].join("\n"),
  );

  try {
    const { stdout, stderr } = await execFileAsync("bash", [script], {
      cwd: root,
      env: {
        ...process.env,
        ...(artifact === undefined
          ? {}
          : { REVIEW_SCOPE_DECISION_FILE: artifact }),
      },
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const result = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    return {
      status: typeof result.code === "number" ? result.code : 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}

async function writeScopeArtifact(value: unknown): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-pr-scope-artifact-"),
  );
  createdRoots.push(root);
  const file = path.join(root, "scope-decision.json");
  await writeFile(file, JSON.stringify(value));
  return file;
}

describe("pr-review Phase 4 scope notice", () => {
  it.each([
    ["initial", false, ["src/one.ts", "docs/two.md"], "initial", "full"],
    ["follow-up", false, ["src/one.ts"], "follow-up", "full"],
    ["follow-up", true, ["src/one.ts", "src/two.ts"], "follow-up", "narrow"],
  ])(
    "reports %s/%s scope without exposing changed-file text",
    async (mode, isFollowupNarrow, changedFiles, expectedMode, selection) => {
      const hostileFile = "src/$() ; untrusted changed-file text.md";
      const artifact = await writeScopeArtifact({
        mode,
        is_followup_narrow: isFollowupNarrow,
        changed_files: [...changedFiles, hostileFile],
      });

      const result = await runScopeNotice(artifact);

      expect(result).toEqual({
        status: 0,
        stdout: `PR review scope: mode=${expectedMode}; selection=${selection}; changed_files=${changedFiles.length + 1}; continuing.\nPLAY_REVIEW_CONTINUATION\n`,
        stderr: "",
      });
      expect(result.stdout).not.toContain(hostileFile);
    },
  );

  it("stops before continuation when the artifact is unavailable or malformed", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pr-scope-invalid-"),
    );
    createdRoots.push(root);
    const unreadable = path.join(root, "unreadable");
    await mkdir(unreadable);
    const malformed = path.join(root, "malformed.json");
    await writeFile(malformed, "{");
    const valid = {
      mode: "follow-up",
      is_followup_narrow: false,
      changed_files: [],
    };
    const invalidArtifacts = [
      undefined,
      unreadable,
      malformed,
      await writeScopeArtifact({ ...valid, mode: "other" }),
      await writeScopeArtifact({
        ...valid,
        mode: "initial",
        is_followup_narrow: true,
      }),
      await writeScopeArtifact({ ...valid, is_followup_narrow: "false" }),
      await writeScopeArtifact({ ...valid, changed_files: "src/app.ts" }),
      await writeScopeArtifact({ ...valid, changed_files: [1] }),
      await writeScopeArtifact({
        is_followup_narrow: false,
        changed_files: [],
      }),
      await writeScopeArtifact({ mode: "follow-up", changed_files: [] }),
      await writeScopeArtifact({
        mode: "follow-up",
        is_followup_narrow: false,
      }),
    ];

    for (const artifact of invalidArtifacts) {
      const result = await runScopeNotice(artifact);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stdout).not.toContain("PLAY_REVIEW_CONTINUATION");
    }
  });

  it("places the consumer after handoff and HEAD validation and before play-review", async () => {
    const skill = await readFile(sourceSkill, "utf8");
    const handoffValidation = skill.indexOf(
      'bash "$PR_REVIEW_MANIFEST_HELPER" validate-handoff || exit 1',
    );
    const headValidation = skill.indexOf(
      'echo "review worktree HEAD changed since handoff; refusing stale review" >&2',
    );
    const consumer = skill.indexOf(
      "emit_pr_review_scope_notice || exit 1",
      headValidation,
    );
    const playReview = skill.indexOf("Hand off to `play-review`", consumer);

    expect(handoffValidation).toBeGreaterThan(-1);
    expect(headValidation).toBeGreaterThan(handoffValidation);
    expect(consumer).toBeGreaterThan(headValidation);
    expect(playReview).toBeGreaterThan(consumer);
  });
});
