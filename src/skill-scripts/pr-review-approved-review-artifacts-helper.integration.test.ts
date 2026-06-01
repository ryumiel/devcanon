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
  "skills/pr-review/scripts/approved-review-artifacts.sh",
);
const headSha = "0123456789abcdef0123456789abcdef01234567";
const staleHeadSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const findingsFile = `.ephemeral/topic-${headSha}-findings.json`;
const reviewBodyFile = ".ephemeral/topic-review-body.md";
const payloadFile = `.ephemeral/topic-${headSha}-review-payload.json`;
const scopeDecisionFile = `.ephemeral/topic-${headSha}-scope-decision.json`;
const approvedReviewFile = `.ephemeral/topic-${headSha}-approved-review.json`;

async function commandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", ["-c", `command -v ${command}`]);
    return true;
  } catch {
    return false;
  }
}

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "devcanon-pr-review-approved-"),
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
  await execFileAsync("git", ["switch", "-C", "topic"], { cwd });
  return cwd;
}

function findingsEnvelope() {
  return {
    schema: "play-review/findings/v1",
    findings: [],
    carry_forward: [],
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    commit_id: headSha,
    event: "COMMENT",
    body: "Review body\n",
    comments: [
      {
        path: "src/example.ts",
        line: 12,
        side: "RIGHT",
        body: "Inline comment\n",
      },
    ],
    ...overrides,
  };
}

function payloadWithRange(overrides: Record<string, unknown> = {}) {
  return payload({
    comments: [
      {
        path: "src/example.ts",
        line: 12,
        start_line: 10,
        start_side: "RIGHT",
        side: "RIGHT",
        body: "Ranged inline comment\n",
      },
      {
        path: "src/other.ts",
        line: 4,
        side: "RIGHT",
        body: "Single-line inline comment\n",
      },
    ],
    ...overrides,
  });
}

async function writeJson(cwd: string, relPath: string, value: unknown) {
  await writeFile(path.join(cwd, relPath), JSON.stringify(value, null, 2));
}

async function writeInputs(cwd: string) {
  await writeJson(cwd, findingsFile, findingsEnvelope());
  await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
  await writeJson(cwd, payloadFile, payload());
  await writeJson(cwd, scopeDecisionFile, {});
}

async function runHelper(
  cwd: string,
  command: string,
  env: NodeJS.ProcessEnv = {},
) {
  const supportValidator =
    env.PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT ??
    (await writePassingSupportValidator(cwd));
  return execFileAsync("bash", [helperScript, command], {
    cwd,
    env: {
      ...process.env,
      HEAD_SHA: headSha,
      PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: supportValidator,
      ...env,
    },
  });
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

async function writeRecordingSupportValidator(cwd: string, stderr = "") {
  const validator = path.join(cwd, ".ephemeral/recording-support-validator.sh");
  await writeFile(
    validator,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'printf "%s\\n" "$@" > ".ephemeral/support-validator-args.txt"',
      stderr ? `printf '%s\\n' ${JSON.stringify(stderr)} >&2` : "",
      stderr ? "exit 1" : "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(validator, 0o755);
  return validator;
}

describe.skipIf(!jqAvailable)(
  "pr-review approved review artifact helper",
  () => {
    it("derives and prepares the review payload write path from the checked-out git branch", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await expect(
          runHelper(cwd, "prepare-review-payload-write", {
            REVIEW_PAYLOAD_FILE: "",
            BRANCH_NAME: "caller-override-must-not-apply",
          }),
        ).resolves.toMatchObject({
          stdout: `${payloadFile}\n`,
        });

        await execFileAsync("git", ["switch", "-C", "Feature/ABC.1_2"], {
          cwd,
        });
        await expect(
          runHelper(cwd, "prepare-review-payload-write"),
        ).resolves.toMatchObject({
          stdout: `.ephemeral/Feature-ABC.1_2-${headSha}-review-payload.json\n`,
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("freezes an approved-review artifact with schema, paths, digests, and complete payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);

        const { stdout } = await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        expect(stdout).toBe(`${approvedReviewFile}\n`);

        const artifact = JSON.parse(
          await readFile(path.join(cwd, approvedReviewFile), "utf-8"),
        ) as {
          schema: string;
          review_head_sha: string;
          findings_file: string;
          review_body_file: string;
          review_payload_file: string;
          scope_decision_file: string;
          findings_sha256: string;
          review_body_sha256: string;
          review_payload_sha256: string;
          scope_decision_sha256: string;
          payload: unknown;
        };
        expect(artifact).toMatchObject({
          schema: "pr-review/approved-review/v1",
          review_head_sha: headSha,
          findings_file: findingsFile,
          review_body_file: reviewBodyFile,
          review_payload_file: payloadFile,
          scope_decision_file: scopeDecisionFile,
          payload: payload(),
        });
        expect(artifact.findings_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.review_body_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.review_payload_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.scope_decision_sha256).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("delegates approved payload equivalence with explicit scope-policy inputs", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        const validator = await writeRecordingSupportValidator(cwd);

        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
          PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: validator,
        });

        const args = await readFile(
          path.join(cwd, ".ephemeral/support-validator-args.txt"),
          "utf8",
        );
        expect(args).toContain("compare-approved-payload");
        expect(args).toContain("--expected-schema");
        expect(args).toContain("pr-review/scope-decision/v1");
        expect(args).toContain("--expected-prior-context-kind");
        expect(args).toContain("--governed-path-pattern");
        expect(args).toContain("--max-narrow-changed-files");
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("surfaces missing and failing support-validator delegation", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT:
              ".ephemeral/missing-validator.sh",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "play-validate-review-artifacts validator missing",
          ),
        });

        const failingValidator = await writeRecordingSupportValidator(
          cwd,
          "approved review payload does not match generated payload",
        );
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
            PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT: failingValidator,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "approved review payload does not match generated payload",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("validates the approved review and prints the exact frozen payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        const { stdout } = await runHelper(cwd, "validate-approved-review", {
          APPROVED_REVIEW_FILE: approvedReviewFile,
        });

        expect(JSON.parse(stdout)).toEqual(payload());
        expect(stdout).toContain('"body": "Review body\\n"');
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("allows start_side only on ranged inline comments", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await writeJson(cwd, payloadFile, payloadWithRange());

        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        const { stdout } = await runHelper(cwd, "validate-approved-review", {
          APPROVED_REVIEW_FILE: approvedReviewFile,
        });

        const validatedPayload = JSON.parse(stdout) as {
          comments: Array<Record<string, unknown>>;
        };
        expect(validatedPayload.comments[0]).toMatchObject({
          start_line: 10,
          start_side: "RIGHT",
        });
        expect(validatedPayload.comments[1]).not.toHaveProperty("start_line");
        expect(validatedPayload.comments[1]).not.toHaveProperty("start_side");
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects malformed start_side relationships in frozen payload validation", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        const malformedPayloads = [
          payloadWithRange({
            comments: [
              {
                path: "src/example.ts",
                line: 12,
                start_line: 10,
                side: "RIGHT",
                body: "Missing start_side\n",
              },
            ],
          }),
          payloadWithRange({
            comments: [
              {
                path: "src/example.ts",
                line: 12,
                start_line: 10,
                start_side: "LEFT",
                side: "RIGHT",
                body: "Invalid start_side\n",
              },
            ],
          }),
          payloadWithRange({
            comments: [
              {
                path: "src/example.ts",
                line: 12,
                start_side: "RIGHT",
                side: "RIGHT",
                body: "start_side without start_line\n",
              },
            ],
          }),
        ];

        for (const malformedPayload of malformedPayloads) {
          await writeJson(cwd, payloadFile, malformedPayload);
          await expect(
            runHelper(cwd, "validate-approved-review", {
              APPROVED_REVIEW_FILE: approvedReviewFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("payload shape mismatch"),
          });
        }
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects findings, review body, payload, and approved artifact paths that are unsafe or non-canonical", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);

        await expect(
          runHelper(cwd, "prepare-review-payload-write", {
            REVIEW_PAYLOAD_FILE: "payload.json",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "review payload path validation failed",
          ),
        });
        await expect(
          runHelper(cwd, "prepare-review-payload-write", {
            REVIEW_PAYLOAD_FILE: ".ephemeral/nested/review-payload.json",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "nested review payload path rejected",
          ),
        });
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: ".ephemeral/wrong-findings.json",
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings path mismatch"),
        });
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: "review-body.md",
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body path validation failed"),
        });
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        await writeFile(
          path.join(cwd, ".ephemeral/wrong-approved-review.json"),
          await readFile(path.join(cwd, approvedReviewFile)),
        );
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: ".ephemeral/wrong-approved-review.json",
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("approved review path mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects schema mismatch, malformed payload JSON, and malformed approved-review schema", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await writeJson(cwd, payloadFile, payload({ event: "DISMISS" }));
        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload shape mismatch"),
        });

        await writeJson(cwd, payloadFile, payload());
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        await writeJson(cwd, approvedReviewFile, {
          schema: "wrong/v1",
          review_head_sha: headSha,
          findings_file: findingsFile,
          review_body_file: reviewBodyFile,
          review_payload_file: payloadFile,
          findings_sha256: "0".repeat(64),
          review_body_sha256: "0".repeat(64),
          review_payload_sha256: "0".repeat(64),
          payload: payload(),
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("approved review schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects digest drift for findings, review body, payload files, and recorded digests", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        await writeJson(cwd, findingsFile, {
          ...findingsEnvelope(),
          extra: "drift",
        });
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings digest mismatch"),
        });

        await writeJson(cwd, findingsFile, findingsEnvelope());
        await writeFile(path.join(cwd, reviewBodyFile), "Changed body\n");
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review body digest mismatch"),
        });

        await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
        await writeJson(cwd, payloadFile, payload({ body: "Changed payload" }));
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload digest mismatch"),
        });

        await writeJson(cwd, payloadFile, payload());
        const artifact = JSON.parse(
          await readFile(path.join(cwd, approvedReviewFile), "utf-8"),
        );
        artifact.review_payload_sha256 = "0".repeat(64);
        await writeJson(cwd, approvedReviewFile, artifact);
        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("payload digest mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects invalid findings entries before freezing or validating approved reviews", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        const invalidFreezeEntries = [
          {
            line: 12,
            start_line: null,
            severity: "Blocking",
            category: "Safety",
            critic: "VALID",
            anchor: "natural",
            why: "Missing path should be rejected.",
            recommendation: "Reject malformed entries.",
            body: "body",
          },
          {
            path: "src/example.ts",
            line: 12,
            start_line: null,
            severity: "Blocking",
            category: "Safety",
            anchor: "natural",
            why: "Missing critic should be rejected.",
            recommendation: "Reject malformed entries.",
            body: "body",
          },
        ];

        for (const invalidEntry of invalidFreezeEntries) {
          await writeJson(cwd, findingsFile, {
            schema: "play-review/findings/v1",
            findings: [invalidEntry],
            carry_forward: [],
          });

          await expect(
            runHelper(cwd, "freeze-approved-review", {
              FINDINGS_FILE: findingsFile,
              REVIEW_BODY_FILE: reviewBodyFile,
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining("findings schema mismatch"),
          });
        }

        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        const artifact = JSON.parse(
          await readFile(path.join(cwd, approvedReviewFile), "utf-8"),
        );
        artifact.findings_sha256 = "0".repeat(64);
        await writeJson(cwd, approvedReviewFile, artifact);
        await writeJson(cwd, findingsFile, {
          schema: "play-review/findings/v1",
          findings: [
            {
              path: "src/example.ts",
              line: 12,
              start_line: null,
              severity: "Nit",
              category: "Safety",
              critic: "VALID",
              anchor: "natural",
              why: "Nit with critic verdict should be rejected.",
              recommendation: "Mirror play-review semantics.",
              body: "body",
            },
          ],
          carry_forward: [],
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("findings schema mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects multi-document review payload JSON streams", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeJson(cwd, findingsFile, findingsEnvelope());
        await writeFile(path.join(cwd, reviewBodyFile), "Review body\n");
        await writeJson(cwd, scopeDecisionFile, {});
        await writeFile(
          path.join(cwd, payloadFile),
          `${JSON.stringify(payload())}\n${JSON.stringify(payload({ event: "APPROVE" }))}\n`,
        );

        await expect(
          runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "payload must contain exactly one JSON object",
          ),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it("rejects stale PR heads before printing a frozen payload", async () => {
      const cwd = await makeGitWorkspace();
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });

        await expect(
          runHelper(cwd, "validate-approved-review", {
            HEAD_SHA: staleHeadSha,
            APPROVED_REVIEW_FILE: approvedReviewFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("review head mismatch"),
        });
      } finally {
        await cleanupTempDir(cwd);
      }
    });

    it.skipIf(!symlinkAvailable)(
      "rejects symlinked approved-review read targets and symlinked .ephemeral",
      async () => {
        const cwd = await makeGitWorkspace();
        const outside = path.join(cwd, "outside-approved-review.json");
        try {
          await writeInputs(cwd);
          await runHelper(cwd, "freeze-approved-review", {
            FINDINGS_FILE: findingsFile,
            REVIEW_BODY_FILE: reviewBodyFile,
            REVIEW_PAYLOAD_FILE: payloadFile,
          });
          await writeFile(
            outside,
            await readFile(path.join(cwd, approvedReviewFile)),
          );
          await rm(path.join(cwd, approvedReviewFile));
          await symlink(outside, path.join(cwd, approvedReviewFile));

          await expect(
            runHelper(cwd, "validate-approved-review", {
              APPROVED_REVIEW_FILE: approvedReviewFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "approved review file must not be a symlink",
            ),
          });

          await rm(path.join(cwd, ".ephemeral"), {
            recursive: true,
            force: true,
          });
          await mkdir(path.join(cwd, "outside-ephemeral"));
          await symlink(
            path.join(cwd, "outside-ephemeral"),
            path.join(cwd, ".ephemeral"),
          );
          await expect(
            runHelper(cwd, "prepare-review-payload-write"),
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
      "rejects symlinked write targets without removing them",
      async () => {
        const cwd = await makeGitWorkspace();
        const outsidePayload = path.join(cwd, "outside-payload.json");
        const outsideApproved = path.join(cwd, "outside-approved-review.json");
        try {
          await writeInputs(cwd);
          await rm(path.join(cwd, payloadFile));
          await writeFile(outsidePayload, "do not remove\n");
          await symlink(outsidePayload, path.join(cwd, payloadFile));

          await expect(
            runHelper(cwd, "prepare-review-payload-write", {
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "review payload path must not be a symlink",
            ),
          });
          expect(await readFile(outsidePayload, "utf-8")).toBe(
            "do not remove\n",
          );
          expect(
            (await lstat(path.join(cwd, payloadFile))).isSymbolicLink(),
          ).toBe(true);

          await rm(path.join(cwd, payloadFile));
          await writeJson(cwd, payloadFile, payload());
          await writeFile(outsideApproved, "do not remove\n");
          await symlink(outsideApproved, path.join(cwd, approvedReviewFile));

          await expect(
            runHelper(cwd, "freeze-approved-review", {
              FINDINGS_FILE: findingsFile,
              REVIEW_BODY_FILE: reviewBodyFile,
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "approved review path must not be a symlink",
            ),
          });
          expect(await readFile(outsideApproved, "utf-8")).toBe(
            "do not remove\n",
          );
          expect(
            (await lstat(path.join(cwd, approvedReviewFile))).isSymbolicLink(),
          ).toBe(true);
        } finally {
          await cleanupTempDir(cwd);
        }
      },
    );

    it.skipIf(!mkfifoAvailable)(
      "rejects non-regular review payload write targets when mkfifo is available",
      async () => {
        const cwd = await makeGitWorkspace();
        try {
          await execFileAsync("mkfifo", [path.join(cwd, payloadFile)]);

          await expect(
            runHelper(cwd, "prepare-review-payload-write", {
              REVIEW_PAYLOAD_FILE: payloadFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "review payload path exists but is not a regular file",
            ),
          });
        } finally {
          await cleanupTempDir(cwd);
        }
      },
    );

    it("rejects unreadable approved-review files where the platform enforces chmod permissions", async () => {
      const cwd = await makeGitWorkspace();
      const absoluteApprovedReviewFile = path.join(cwd, approvedReviewFile);
      try {
        await writeInputs(cwd);
        await runHelper(cwd, "freeze-approved-review", {
          FINDINGS_FILE: findingsFile,
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_PAYLOAD_FILE: payloadFile,
        });
        await chmod(absoluteApprovedReviewFile, 0o000);
        try {
          await readFile(absoluteApprovedReviewFile);
          return;
        } catch {
          await expect(
            runHelper(cwd, "validate-approved-review", {
              APPROVED_REVIEW_FILE: approvedReviewFile,
            }),
          ).rejects.toMatchObject({
            stderr: expect.stringContaining(
              "approved review file missing or unreadable",
            ),
          });
        }
      } finally {
        await chmod(absoluteApprovedReviewFile, 0o600).catch(() => undefined);
        await cleanupTempDir(cwd);
      }
    });
  },
);
