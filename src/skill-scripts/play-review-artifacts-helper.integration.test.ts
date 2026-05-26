import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
const symlinkAvailable = await canCreateSymlinks();
const jqAvailable = await commandAvailable("jq");
const mkfifoAvailable = await commandAvailable("mkfifo");
const helperScript = path.join(
  process.cwd(),
  "skills/play-review/scripts/review-artifacts.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
const nitsFile = `.ephemeral/topic-${headSha}-nits-pending.json`;

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-review-artifacts-"),
  );
  await mkdir(path.join(dir, ".ephemeral"));
  return dir;
}

async function makeGitWorkspace(): Promise<string> {
  const cwd = await makeWorkspace();
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd });
  await execFileAsync("git", ["config", "user.name", "Test User"], { cwd });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd,
  });
  await writeFile(path.join(cwd, "README.md"), "baseline\n");
  await execFileAsync("git", ["add", "README.md"], { cwd });
  await execFileAsync("git", ["commit", "-m", "chore: baseline"], { cwd });
  return cwd;
}

async function makeTopicGitWorkspace(): Promise<string> {
  const cwd = await makeGitWorkspace();
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  return cwd;
}

async function makeReviewSourceWorkspace(): Promise<{
  cwd: string;
  reviewHeadSha: string;
  findingsFile: string;
}> {
  const cwd = await makeTopicGitWorkspace();
  await mkdir(path.join(cwd, "src"));
  await writeFile(
    path.join(cwd, "src/review-target.ts"),
    [
      "export function alpha() {",
      "  const first = 1;",
      "  const second = 2;",
      "  return first + second;",
      "}",
      "",
      "export function beta() {",
      "  return alpha();",
      "}",
      "",
    ].join("\n"),
  );
  await execFileAsync("git", ["add", "src/review-target.ts"], { cwd });
  await execFileAsync("git", ["commit", "-m", "feat: add review target"], {
    cwd,
  });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd,
  });
  const reviewHeadSha = stdout.trim();
  return {
    cwd,
    reviewHeadSha,
    findingsFile: `.ephemeral/topic-${reviewHeadSha}-findings.json`,
  };
}

async function writeEnvelope(cwd: string, relPath: string): Promise<void> {
  await writeFile(
    path.join(cwd, relPath),
    JSON.stringify({
      schema: "play-review/findings/v1",
      findings: [],
      carry_forward: [],
    }),
  );
}

async function writeRawEnvelope(
  cwd: string,
  relPath: string,
  envelope: unknown,
): Promise<void> {
  await writeFile(path.join(cwd, relPath), JSON.stringify(envelope));
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    path: "skills/play-review/SKILL.md",
    line: 42,
    start_line: null,
    severity: "Blocking",
    category: "Contracts",
    critic: "VALID",
    anchor: "natural",
    why: "The contract would otherwise be ambiguous.",
    recommendation: "Keep the helper contract explicit.",
    body: "**Blocking | Contracts** - The contract would otherwise be ambiguous.\n\n**Recommendation:** Keep the helper contract explicit.",
    ...overrides,
  };
}

function sourceFinding(overrides: Record<string, unknown> = {}) {
  return finding({
    path: "src/review-target.ts",
    line: 4,
    start_line: null,
    why: "The reviewed source has a problem.",
    recommendation: "Adjust the reviewed source.",
    body: "**Blocking | Contracts** - The reviewed source has a problem.\n\n**Recommendation:** Adjust the reviewed source.",
    ...overrides,
  });
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: { ...process.env, HEAD_SHA: headSha, ...env },
  });
}

function previewBody(stdout: string): string {
  const match = stdout.match(
    /## GitHub Review Body\n\n(?<body>[\s\S]*?)\n\n## Findings/,
  );
  expect(match?.groups?.body).toBeDefined();
  return match?.groups?.body ?? "";
}

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!jqAvailable)("play-review review artifact helper", () => {
  it("renders a pr-review preview from review-head source with findings, carry-forward, and payload-equivalent body", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const reviewBodyFile = ".ephemeral/review-body.md";
      await writeFile(path.join(cwd, reviewBodyFile), "Draft summary\n");
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [
          sourceFinding({
            line: 4,
            anchor: "natural",
            why: "The natural finding should show reviewed HEAD source.",
            recommendation: "Keep preview evidence tied to HEAD_SHA.",
            body: "**Blocking | Contracts** - The natural finding should show reviewed HEAD source.\n\n**Recommendation:** Keep preview evidence tied to HEAD_SHA.",
          }),
          sourceFinding({
            line: 8,
            anchor: "out-of-diff",
            why: "The out-of-diff finding belongs in the review body.",
            recommendation: "Append it to the top-level body.",
            body: "**Blocking | Contracts** - The out-of-diff finding belongs in the review body.\n\n**Recommendation:** Append it to the top-level body.",
          }),
        ],
        carry_forward: [
          sourceFinding({
            line: 3,
            start_line: 2,
            severity: "Nit",
            category: "Tests",
            critic: null,
            anchor: "missing-file",
            why: "The carry-forward finding should still be rendered.",
            recommendation: "Include carry-forward evidence.",
            body: "**Nit | Tests** - The carry-forward finding should still be rendered.\n\n**Recommendation:** Include carry-forward evidence.",
          }),
          sourceFinding({
            line: 7,
            anchor: "out-of-diff",
            why: "Carry-forward out-of-diff entries also belong in the body.",
            recommendation: "Keep them out of inline comments.",
            body: "**Blocking | Contracts** - Carry-forward out-of-diff entries also belong in the body.\n\n**Recommendation:** Keep them out of inline comments.",
          }),
        ],
      });
      await writeFile(
        path.join(cwd, "src/review-target.ts"),
        "working tree content must not appear\n",
      );

      const preview = await runHelper(cwd, "render-review-preview", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
      });
      const payload = await runHelper(cwd, "build-github-review-payload", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
        REVIEW_EVENT: "REQUEST_CHANGES",
      });
      const decoded = JSON.parse(payload.stdout) as { body: string };

      expect(preview.stdout).toContain(`Review head: ${reviewHeadSha}`);
      expect(preview.stdout).toContain(`Findings file: ${findingsFile}`);
      expect(preview.stdout).toContain("## Findings");
      expect(preview.stdout).toContain("## Carry-forward");
      expect(preview.stdout).toContain("// src/review-target.ts:3-5");
      expect(preview.stdout).toContain("  const second = 2;");
      expect(preview.stdout).not.toContain("working tree content");
      expect(previewBody(preview.stdout)).toBe(decoded.body);
      expect(decoded.body).toContain("Draft summary");
      expect(decoded.body).toContain(
        "The out-of-diff finding belongs in the review body.",
      );
      expect(decoded.body).toContain(
        "Carry-forward out-of-diff entries also belong in the body.",
      );
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("renders exact post-ready inline bodies even when body diverges from live fields", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const reviewBodyFile = ".ephemeral/review-body.md";
      const naturalBody =
        "**Blocking | Contracts** - Posted natural body from the frozen artifact.\n\n**Recommendation:** Post this natural recommendation.";
      const missingBody =
        "**Nit | Tests** - Posted missing-file body from the frozen artifact.\n\n**Recommendation:** Post this missing-file recommendation.";
      await writeFile(path.join(cwd, reviewBodyFile), "Draft summary\n");
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [
          sourceFinding({
            line: 4,
            anchor: "natural",
            why: "STALE natural why must not drive the approved inline text.",
            recommendation:
              "STALE natural recommendation must not drive the approved inline text.",
            body: naturalBody,
          }),
          sourceFinding({
            line: 8,
            anchor: "missing-file",
            why: "STALE missing-file why must not drive the approved inline text.",
            recommendation:
              "STALE missing-file recommendation must not drive the approved inline text.",
            body: missingBody,
          }),
        ],
        carry_forward: [],
      });

      const preview = await runHelper(cwd, "render-review-preview", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
      });
      const payload = await runHelper(cwd, "build-github-review-payload", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
        REVIEW_EVENT: "REQUEST_CHANGES",
      });
      const decoded = JSON.parse(payload.stdout) as {
        comments: Array<{ body: string }>;
      };

      expect(decoded.comments[0].body).toBe(naturalBody);
      expect(decoded.comments[1].body).toBe(
        `Missing-file finding (no natural anchor — see body):\n\n${missingBody}`,
      );
      expect(preview.stdout).toContain(
        `#### Rendered Finding Body\n\n${decoded.comments[0].body}\n\n`,
      );
      expect(preview.stdout).toContain(
        `#### Rendered Finding Body\n\n${decoded.comments[1].body}\n\n`,
      );
      expect(preview.stdout).not.toContain("STALE natural why");
      expect(preview.stdout).not.toContain("STALE missing-file why");
      expect(preview.stdout).not.toContain("STALE natural recommendation");
      expect(preview.stdout).not.toContain("STALE missing-file recommendation");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("renders branch-review preview without a review body or GitHub posting concepts", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [sourceFinding()],
        carry_forward: [],
      });

      const { stdout } = await runHelper(cwd, "render-review-preview", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "branch-review",
      });

      expect(stdout).toContain("## Findings");
      expect(stdout).toContain("src/review-target.ts");
      expect(stdout).not.toContain("GitHub Review Body");
      expect(stdout).not.toContain("posting");
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("builds a pr-review GitHub payload with anchor partitioning and allowlisted comments", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const reviewBodyFile = ".ephemeral/review-body.md";
      await writeFile(path.join(cwd, reviewBodyFile), "Top-level summary\n");
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [
          sourceFinding({
            anchor: "natural",
            body: "**Blocking | Contracts** - Natural body.\n\n**Recommendation:** Fix it.",
          }),
          sourceFinding({
            line: 8,
            anchor: "missing-file",
            body: "**Blocking | Contracts** - Missing file body.\n\n**Recommendation:** Anchor to fallback.",
          }),
          sourceFinding({
            line: 9,
            anchor: "out-of-diff",
            body: "**Blocking | Contracts** - Out of diff body.\n\n**Recommendation:** Put in body.",
          }),
        ],
        carry_forward: [
          sourceFinding({
            line: 3,
            start_line: 2,
            severity: "Nit",
            category: "Tests",
            critic: null,
            anchor: "natural",
            body: "**Nit | Tests** - Range body.\n\n**Recommendation:** Keep range.",
          }),
          sourceFinding({
            line: 7,
            anchor: "out-of-diff",
            body: "**Blocking | Contracts** - Carry forward out of diff.\n\n**Recommendation:** Put in body too.",
          }),
        ],
      });

      const { stdout } = await runHelper(cwd, "build-github-review-payload", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
        REVIEW_EVENT: "COMMENT",
      });
      const payload = JSON.parse(stdout) as {
        commit_id: string;
        event: string;
        body: string;
        comments: Array<Record<string, unknown>>;
      };

      expect(payload.commit_id).toBe(reviewHeadSha);
      expect(payload.event).toBe("COMMENT");
      expect(payload.body).toContain("Top-level summary");
      expect(payload.body).toContain("Out of diff body");
      expect(payload.body).toContain("Carry forward out of diff");
      expect(payload.comments).toHaveLength(3);
      expect(payload.comments[0]).toEqual({
        path: "src/review-target.ts",
        line: 4,
        side: "RIGHT",
        body: "**Blocking | Contracts** - Natural body.\n\n**Recommendation:** Fix it.",
      });
      expect(payload.comments[1].body).toContain(
        "Missing-file finding (no natural anchor — see body):",
      );
      expect(payload.comments[1]).not.toHaveProperty("start_line");
      expect(payload.comments[1]).not.toHaveProperty("start_side");
      expect(payload.comments[2]).toMatchObject({
        path: "src/review-target.ts",
        start_line: 2,
        start_side: "RIGHT",
        line: 3,
        side: "RIGHT",
      });
      expect(Object.keys(payload.comments[2]).sort()).toEqual([
        "body",
        "line",
        "path",
        "side",
        "start_line",
        "start_side",
      ]);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("allows empty comments when every entry is out-of-diff or the envelope is empty", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const reviewBodyFile = ".ephemeral/review-body.md";
      await writeFile(path.join(cwd, reviewBodyFile), "Summary\n");

      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [sourceFinding({ anchor: "out-of-diff" })],
        carry_forward: [],
      });
      const outOfDiffOnly = await runHelper(
        cwd,
        "build-github-review-payload",
        {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "APPROVE",
        },
      );
      expect(JSON.parse(outOfDiffOnly.stdout).comments).toEqual([]);

      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [],
        carry_forward: [],
      });
      const empty = await runHelper(cwd, "build-github-review-payload", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
        REVIEW_EVENT: "APPROVE",
      });
      expect(JSON.parse(empty.stdout).comments).toEqual([]);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects invalid review surfaces, events, missing review bodies, and unreadable review-head source", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const reviewBodyFile = ".ephemeral/review-body.md";
      await writeFile(path.join(cwd, reviewBodyFile), "Summary\n");
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v1",
        findings: [sourceFinding({ path: "src/missing.ts" })],
        carry_forward: [],
      });

      await expect(
        runHelper(cwd, "render-review-preview", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("REVIEW_BODY_FILE is required"),
      });
      await expect(
        runHelper(cwd, "render-review-preview", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "unsupported",
          REVIEW_BODY_FILE: reviewBodyFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "REVIEW_SURFACE must be pr-review or branch-review",
        ),
      });
      await expect(
        runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "branch-review",
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "COMMENT",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "build-github-review-payload requires REVIEW_SURFACE=pr-review",
        ),
      });
      await expect(
        runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "DISMISS",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "REVIEW_EVENT must be APPROVE, REQUEST_CHANGES, or COMMENT",
        ),
      });
      await expect(
        runHelper(cwd, "render-review-preview", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "branch-review",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "failed to read review-head source: src/missing.ts",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects review body files reached through symlinked intermediate directories",
    async () => {
      const { cwd, reviewHeadSha, findingsFile } =
        await makeReviewSourceWorkspace();
      const outside = path.join(cwd, "outside-body");
      try {
        await writeRawEnvelope(cwd, findingsFile, {
          schema: "play-review/findings/v1",
          findings: [sourceFinding()],
          carry_forward: [],
        });
        await mkdir(outside);
        await writeFile(path.join(outside, "review.md"), "unsafe body\n");
        await symlink(outside, path.join(cwd, ".ephemeral/body-link"));

        await expect(
          runHelper(cwd, "render-review-preview", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: findingsFile,
            REVIEW_SURFACE: "pr-review",
            REVIEW_BODY_FILE: ".ephemeral/body-link/review.md",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body path validation failed"),
        });

        await expect(
          runHelper(cwd, "build-github-review-payload", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: findingsFile,
            REVIEW_SURFACE: "pr-review",
            REVIEW_BODY_FILE: ".ephemeral/body-link/review.md",
            REVIEW_EVENT: "COMMENT",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body path validation failed"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("validates findings and nits envelopes", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const nonEmptyEnvelope = {
        schema: "play-review/findings/v1",
        findings: [
          finding(),
          finding({
            line: 43,
            critic: null,
            why: "The critic phase failed before verdicts were available.",
            recommendation: "Preserve the unverified blocking finding.",
            body: "**Blocking | Contracts** - The critic phase failed before verdicts were available.\n\n**Recommendation:** Preserve the unverified blocking finding.",
          }),
        ],
        carry_forward: [
          finding({
            line: 44,
            start_line: 40,
            severity: "Nit",
            category: "Tests",
            critic: null,
            why: "The coverage should prove non-empty carry-forward entries.",
            recommendation: "Keep this positive fixture.",
            body: "**Nit | Tests** - The coverage should prove non-empty carry-forward entries.\n\n**Recommendation:** Keep this positive fixture.",
          }),
        ],
      };
      await writeRawEnvelope(cwd, findingsFile, nonEmptyEnvelope);
      await writeRawEnvelope(cwd, nitsFile, nonEmptyEnvelope);

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: nitsFile }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("derives and prepares the nits-pending write path", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      const { stdout } = await runHelper(cwd, "derive-nits-pending", {
        FINDINGS_FILE: findingsFile,
      });
      expect(stdout.trim()).toBe(nitsFile);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("computes and prepares the findings write path from the checked-out git branch", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const branchSlugCases = [
        ["topic", "topic"],
        ["Feature/ABC.1_2", "Feature-ABC.1_2"],
      ] as const;
      for (const [branchName, slug] of branchSlugCases) {
        await execFileAsync("git", ["switch", "-C", branchName], { cwd });
        await expect(
          runHelper(cwd, "prepare-findings-write", {
            BRANCH_NAME: "caller-override-must-not-apply",
          }),
        ).resolves.toMatchObject({
          stdout: `.ephemeral/${slug}-${headSha}-findings.json\n`,
        });
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("uses the detached slug when HEAD is detached", async () => {
    const cwd = await makeGitWorkspace();
    try {
      await execFileAsync("git", ["checkout", "--detach", "HEAD"], { cwd });

      await expect(
        runHelper(cwd, "prepare-findings-write", {
          BRANCH_NAME: "caller-override-must-not-apply",
        }),
      ).resolves.toMatchObject({
        stdout: `.ephemeral/detached-${headSha}-findings.json\n`,
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("fails loudly when preparing a findings write path outside a git repository", async () => {
    const cwd = await makeWorkspace();
    try {
      await expect(
        runHelper(cwd, "prepare-findings-write"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "failed to determine git repository root",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects execution from a repository subdirectory before preparing paths", async () => {
    const cwd = await makeTopicGitWorkspace();
    const subdir = path.join(cwd, "subdir");
    try {
      await mkdir(subdir);

      await expect(
        runHelper(subdir, "prepare-findings-write"),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "review-artifacts.sh must run from the repository root",
        ),
      });
      await expect(
        lstat(path.join(subdir, ".ephemeral")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("validates findings against the full current branch-derived path", async () => {
    const cwd = await makeTopicGitWorkspace();
    const wrongBranchFindingsFile = `.ephemeral/wrong-${headSha}-findings.json`;
    try {
      await writeEnvelope(cwd, findingsFile);
      await writeEnvelope(cwd, wrongBranchFindingsFile);

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: wrongBranchFindingsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("prepares an explicit findings write path and removes a symlinked leaf", async () => {
    const cwd = await makeTopicGitWorkspace();
    const outside = path.join(cwd, "outside-target");
    try {
      if (symlinkAvailable) {
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, path.join(cwd, findingsFile));
      }

      const { stdout } = await runHelper(cwd, "prepare-findings-write", {
        FINDINGS_FILE: findingsFile,
      });
      expect(stdout.trim()).toBe(findingsFile);
      if (symlinkAvailable) {
        expect(await readFile(outside, "utf-8")).toBe("do not overwrite\n");
        await expect(lstat(path.join(cwd, findingsFile))).rejects.toMatchObject(
          {
            code: "ENOENT",
          },
        );
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects malformed paths, nesting, traversal, schema mismatch, and head mismatch", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeEnvelope(cwd, findingsFile);
      await mkdir(path.join(cwd, ".ephemeral/nested"));
      await writeFile(
        path.join(cwd, ".ephemeral/bad-findings.json"),
        JSON.stringify({
          schema: "wrong/v1",
          findings: [],
          carry_forward: [],
        }),
      );

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: "findings.json" }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path validation failed"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/nested/file-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/topic/.ephemeral/file-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE: ".ephemeral/../bad-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("nested findings path rejected"),
      });
      await expect(
        runHelper(cwd, "validate-findings", {
          FINDINGS_FILE:
            ".ephemeral/topic-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path mismatch"),
      });
      await expect(
        runHelper(cwd, "validate-nits-file", {
          NITS_FILE: ".ephemeral/bad-findings.json",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects malformed envelope shapes before consumers read them", async () => {
    const cwd = await makeTopicGitWorkspace();
    const malformedEnvelopes = [
      {
        schema: "play-review/findings/v1",
        findings: "not-array",
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [],
        carry_forward: {},
      },
      {
        schema: "play-review/findings/v1",
        findings: [
          {
            ...finding(),
            body: undefined,
          },
        ],
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [finding({ path: "../../outside" })],
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [finding({ severity: "Nit", critic: "VALID" })],
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v1",
        findings: [finding({ path: "/absolute/path" })],
        carry_forward: [],
      },
    ];

    try {
      for (const envelope of malformedEnvelopes) {
        await writeRawEnvelope(cwd, findingsFile, envelope);
        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("envelope shape mismatch"),
        });
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a symlinked .ephemeral directory",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      const outside = path.join(cwd, "outside-ephemeral");
      try {
        await rm(path.join(cwd, ".ephemeral"), {
          recursive: true,
          force: true,
        });
        await mkdir(outside);
        await symlink(outside, path.join(cwd, ".ephemeral"));

        await expect(
          runHelper(cwd, "prepare-findings-write", {
            FINDINGS_FILE: findingsFile,
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
    "rejects symlinked leaf files when reading",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      const outside = path.join(cwd, "outside-findings.json");
      try {
        await writeEnvelope(cwd, findingsFile);
        await writeEnvelope(cwd, "outside-findings.json");
        await rm(path.join(cwd, findingsFile));
        await symlink(outside, path.join(cwd, findingsFile));

        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings file must not be a symlink",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("rejects missing files and directory targets", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "findings file missing or not a regular file",
        ),
      });

      await mkdir(path.join(cwd, findingsFile));
      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "findings file missing or not a regular file",
        ),
      });
      await expect(
        runHelper(cwd, "prepare-findings-write", {
          FINDINGS_FILE: findingsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path is a directory"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unreadable files where the platform enforces chmod permissions", async () => {
    const cwd = await makeTopicGitWorkspace();
    const absoluteFindingsFile = path.join(cwd, findingsFile);
    try {
      await writeEnvelope(cwd, findingsFile);
      await chmod(absoluteFindingsFile, 0o000);
      try {
        await readFile(absoluteFindingsFile);
        return;
      } catch {
        await expect(
          runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings file missing or unreadable",
          ),
        });
      }
    } finally {
      await chmod(absoluteFindingsFile, 0o600).catch(() => undefined);
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!mkfifoAvailable)(
    "rejects non-regular findings write targets when mkfifo is available",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      try {
        await execFileAsync("mkfifo", [path.join(cwd, findingsFile)]);

        await expect(
          runHelper(cwd, "prepare-findings-write", {
            FINDINGS_FILE: findingsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings path exists but is not a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it.skipIf(!mkfifoAvailable)(
    "rejects non-regular derived nits-pending targets when mkfifo is available",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      try {
        await writeEnvelope(cwd, findingsFile);
        await execFileAsync("mkfifo", [path.join(cwd, nitsFile)]);

        await expect(
          runHelper(cwd, "derive-nits-pending", {
            FINDINGS_FILE: findingsFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "nits pending path exists but is not a regular file",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );
});
