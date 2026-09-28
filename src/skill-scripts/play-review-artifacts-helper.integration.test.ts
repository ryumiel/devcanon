import { execFile, spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
import { createReviewEnvelope } from "../__test-helpers__/review-evidence.js";
import {
  buildApprovedReviewPayload,
  validateTargetedReviewEvidence,
} from "../runtime/review-artifacts.js";

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
  await writeRawEnvelope(cwd, relPath, {
    schema: "play-review/findings/v3",
    findings: [],
    carry_forward: [],
    incomplete_review_routes: [],
  });
}

async function writeRawEnvelope(
  cwd: string,
  relPath: string,
  envelope: unknown,
): Promise<void> {
  await writeFile(
    path.join(cwd, relPath),
    JSON.stringify(
      createReviewEnvelope(
        envelope,
        /([a-f0-9]{40})/.exec(relPath)?.[1] ?? headSha,
      ),
    ),
  );
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
    body: "**Blocking | Contracts** — The contract would otherwise be ambiguous.\n\n**Recommendation:** Keep the helper contract explicit.",
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
    body: "**Blocking | Contracts** — The reviewed source has a problem.\n\n**Recommendation:** Adjust the reviewed source.",
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

async function runHelperWithStdin(
  cwd: string,
  command: string,
  stdin: string | Uint8Array,
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [helperScript, command], {
      cwd,
      env: { ...process.env, HEAD_SHA: headSha, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(Object.assign(new Error(stderr), { code, stdout, stderr }));
    });
    child.stdin.end(stdin);
  });
}

async function currentHeadSha(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd,
  });
  return stdout.trim();
}

async function expectNoPublishStaging(cwd: string): Promise<void> {
  const entries = await readdir(path.join(cwd, ".ephemeral"));
  expect(
    entries.filter((entry) => entry.startsWith(".publish-findings.")),
  ).toEqual([]);
}

async function waitForPublishStaging(cwd: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      (await readdir(path.join(cwd, ".ephemeral"))).some((entry) =>
        entry.startsWith(".publish-findings."),
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("publish-findings did not create its staging file");
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
  it("rejects malformed enum types at runtime, approval and shell publication boundaries", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const baseline = createReviewEnvelope(
        {
          schema: "play-review/findings/v3",
          findings: [sourceFinding({ critic: "INVALID" })],
          carry_forward: [],
          incomplete_review_routes: [],
        },
        reviewHeadSha,
      ) as Record<string, unknown>;
      baseline.prior_dispositions = [
        {
          id: "old",
          origin_head_sha: reviewHeadSha,
          assessed_head_sha: reviewHeadSha,
          status: "resolved",
          reason: "Disproved",
        },
      ];
      const cases = [
        ["findings", 0, "assessment", "state"],
        ["findings", 0, "assessment", "selection"],
        ["findings", 0, "assessment", "verification"],
        ["verification", "state"],
        ["findings", 0, "critic"],
        ["findings", 0, "severity"],
        ["findings", 0, "category"],
        ["findings", 0, "anchor"],
        ["prior_dispositions", 0, "status"],
        ["incomplete_review_routes", 0, "route"],
        ["incomplete_review_routes", 0, "disposition"],
      ];
      for (const keys of cases) {
        for (const kind of ["array", "object", "number", "boolean", "null"]) {
          const value = structuredClone(baseline);
          if (keys[0] === "incomplete_review_routes")
            value.incomplete_review_routes = [
              { route: "D7", disposition: "FAILED" },
            ];
          let target = value;
          for (const key of keys.slice(0, -1))
            target = target[key] as Record<string, unknown>;
          const key = keys.at(-1);
          if (key === undefined) throw new Error("Empty enum path");
          const original = target[key];
          target[key] =
            kind === "array"
              ? [original]
              : kind === "object"
                ? { value: original }
                : kind === "number"
                  ? 1
                  : kind === "boolean"
                    ? true
                    : null;
          expect(
            () => validateTargetedReviewEvidence(value),
            `${keys.join(".")} ${kind}`,
          ).toThrow();
          expect(() =>
            buildApprovedReviewPayload({
              headSha: reviewHeadSha,
              reviewEvent: "APPROVE",
              reviewBody: "Summary",
              findings: value,
            }),
          ).toThrow();
          await expect(
            runHelperWithStdin(cwd, "publish-findings", JSON.stringify(value), {
              HEAD_SHA: reviewHeadSha,
              FINDINGS_FILE: findingsFile,
            }),
          ).rejects.toThrow();
        }
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("projects mirrors and presentation edits once without weakening raw approval", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const claim = sourceFinding({ anchor: "out-of-diff" });
      const value = createReviewEnvelope(
        {
          schema: "play-review/findings/v3",
          findings: [claim],
          carry_forward: [claim],
          incomplete_review_routes: [],
        },
        reviewHeadSha,
      ) as Record<string, unknown>;
      const id = (value.findings as Record<string, unknown>[])[0].id;
      const bodyFile = ".ephemeral/review-body.md";
      await writeFile(path.join(cwd, bodyFile), "Summary");
      for (const overrides of [
        [],
        [
          {
            id,
            action: "reclassify",
            severity: "Nit",
            category: "Documentation",
          },
        ],
        [{ id, action: "drop" }],
      ]) {
        value.presentation_overrides = overrides;
        await writeRawEnvelope(cwd, findingsFile, value);
        const expected = buildApprovedReviewPayload({
          headSha: reviewHeadSha,
          reviewEvent: "COMMENT",
          reviewBody: "Summary",
          findings: value,
        });
        const result = await runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: bodyFile,
          REVIEW_EVENT: "COMMENT",
        });
        expect(JSON.parse(result.stdout)).toEqual(expected);
        expect(
          (String(expected.body).match(/Recommendation:/gu) ?? []).length,
        ).toBe(overrides[0]?.action === "drop" ? 0 : 1);
        if (overrides[0]?.action === "reclassify")
          expect(expected.body).toContain("**Nit | Documentation**");
        expect(() =>
          buildApprovedReviewPayload({
            headSha: reviewHeadSha,
            reviewEvent: "APPROVE",
            reviewBody: "Summary",
            findings: value,
          }),
        ).toThrow();
        await expect(
          runHelper(cwd, "build-github-review-payload", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: findingsFile,
            REVIEW_SURFACE: "pr-review",
            REVIEW_BODY_FILE: bodyFile,
            REVIEW_EVENT: "APPROVE",
          }),
        ).rejects.toThrow();
        const preview = await runHelper(cwd, "render-review-preview", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: bodyFile,
        });
        expect(preview.stdout).toContain("**Severity:** Blocking");
        if (overrides.length)
          expect(preview.stdout).toContain("**Presentation override:**");
      }
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.each(["natural", "missing-file", "out-of-diff"])(
    "projects DOWNGRADE reclassification consistently for %s without granting APPROVE",
    async (anchor) => {
      const { cwd, reviewHeadSha, findingsFile } =
        await makeReviewSourceWorkspace();
      try {
        const value = createReviewEnvelope(
          {
            schema: "play-review/findings/v3",
            findings: [sourceFinding({ critic: "DOWNGRADE", anchor })],
            carry_forward: [],
            incomplete_review_routes: [],
          },
          reviewHeadSha,
        ) as Record<string, unknown>;
        value.presentation_overrides = [
          {
            id: "F1",
            action: "reclassify",
            severity: "Blocking",
            category: "Documentation",
          },
        ];
        const bodyFile = ".ephemeral/body.md";
        await writeFile(path.join(cwd, bodyFile), "Summary");
        await writeRawEnvelope(cwd, findingsFile, value);
        const env = {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: bodyFile,
        };
        const expected = buildApprovedReviewPayload({
          headSha: reviewHeadSha,
          reviewEvent: "COMMENT",
          reviewBody: "Summary",
          findings: value,
        });
        expect(
          JSON.parse(
            (
              await runHelper(cwd, "build-github-review-payload", {
                ...env,
                REVIEW_EVENT: "COMMENT",
              })
            ).stdout,
          ),
        ).toEqual(expected);
        expect(JSON.stringify(expected)).toContain(
          "**Blocking | Documentation**",
        );
        expect(
          (await runHelper(cwd, "render-review-preview", env)).stdout,
        ).toContain("**Blocking | Documentation**");
        expect(() =>
          buildApprovedReviewPayload({
            headSha: reviewHeadSha,
            reviewEvent: "APPROVE",
            reviewBody: "Summary",
            findings: value,
          }),
        ).toThrow();
        await expect(
          runHelper(cwd, "build-github-review-payload", {
            ...env,
            REVIEW_EVENT: "APPROVE",
          }),
        ).rejects.toThrow();
        const nits = (
          await runHelper(cwd, "prepare-judgment-nits", {
            ...env,
            JUDGMENT_REQUIRED_FINDING_INDEXES: "0",
          })
        ).stdout.trim();
        const projection = JSON.parse(
          (
            await runHelper(cwd, "project-nits", {
              HEAD_SHA: reviewHeadSha,
              NITS_FILE: nits,
            })
          ).stdout,
        );
        expect(projection[0].body).toContain("**Blocking | Documentation**");
        const evidence = JSON.parse(
          await readFile(path.join(cwd, nits), "utf8"),
        );
        expect(evidence.findings).toEqual(value.findings);
        expect(evidence.verification).toEqual(value.verification);
        expect(evidence.presentation_overrides).toEqual(
          value.presentation_overrides,
        );
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("rejects malformed presentation overrides in both validators and retains failed verification after a drop", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const value = createReviewEnvelope(
        {
          schema: "play-review/findings/v3",
          findings: [sourceFinding()],
          carry_forward: [],
          incomplete_review_routes: [],
        },
        reviewHeadSha,
      ) as Record<string, unknown>;
      for (const overrides of [
        null,
        [{ id: "unknown", action: "drop" }],
        [{ id: "F1", action: "drop", critic: null }],
        [
          { id: "F1", action: "drop" },
          { id: "F1", action: "drop" },
        ],
        [
          {
            id: "F1",
            action: "reclassify",
            severity: ["Nit"],
            category: "Logic",
          },
        ],
        [{ id: "F1", action: "resolve" }],
      ]) {
        value.presentation_overrides = overrides;
        expect(() => validateTargetedReviewEvidence(value)).toThrow();
        await expect(
          runHelperWithStdin(cwd, "publish-findings", JSON.stringify(value), {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: findingsFile,
          }),
        ).rejects.toThrow();
      }
      const claims = value.findings as Record<string, unknown>[];
      claims[0].critic = null;
      (claims[0].assessment as Record<string, unknown>).verification =
        "incomplete";
      value.verification = {
        state: "incomplete",
        selected_ids: ["F1"],
        reason: "Verifier failed",
      };
      value.incomplete_review_routes = [
        { route: "D10", disposition: "FAILED" },
      ];
      value.presentation_overrides = [{ id: "F1", action: "drop" }];
      await runHelperWithStdin(cwd, "publish-findings", JSON.stringify(value), {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
      });
      expect(() =>
        buildApprovedReviewPayload({
          headSha: reviewHeadSha,
          reviewEvent: "APPROVE",
          reviewBody: "Summary",
          findings: value,
        }),
      ).toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("requires the checked head for nits and rejects stale evidence", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeEnvelope(cwd, nitsFile);
      await expect(
        runHelper(cwd, "validate-nits-file", {
          NITS_FILE: nitsFile,
          HEAD_SHA: "",
        }),
      ).rejects.toThrow();
      await expect(
        runHelper(cwd, "validate-nits-file", {
          NITS_FILE: nitsFile,
          HEAD_SHA: "b".repeat(40),
        }),
      ).rejects.toThrow();
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: nitsFile }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("keeps INVALID audit evidence out of runtime and shell public payloads", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const value = createReviewEnvelope(
        {
          schema: "play-review/findings/v3",
          findings: [
            sourceFinding({ critic: "INVALID" }),
            sourceFinding({ critic: "INVALID", anchor: "out-of-diff" }),
          ],
          carry_forward: [
            sourceFinding({
              critic: "INVALID",
              anchor: "out-of-diff",
              line: 3,
            }),
          ],
          incomplete_review_routes: [],
        },
        reviewHeadSha,
      ) as Record<string, unknown>;
      const bodyFile = ".ephemeral/review-body.md";
      await writeFile(path.join(cwd, bodyFile), "Summary");
      await writeRawEnvelope(cwd, findingsFile, value);
      const expected = {
        commit_id: reviewHeadSha,
        event: "APPROVE",
        body: "Summary",
        comments: [],
      };
      expect(
        buildApprovedReviewPayload({
          headSha: reviewHeadSha,
          reviewEvent: "APPROVE",
          reviewBody: "Summary",
          findings: value,
        }),
      ).toEqual(expected);
      const { stdout } = await runHelper(cwd, "build-github-review-payload", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: bodyFile,
        REVIEW_EVENT: "APPROVE",
      });
      expect(JSON.parse(stdout)).toEqual(expected);
      expect(
        JSON.parse(await readFile(path.join(cwd, findingsFile), "utf8")),
      ).toEqual(value);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.each(["resolved", "invalid"])(
    "publishes a prior %s disposition with runtime/shell parity",
    async (status) => {
      const { cwd, reviewHeadSha, findingsFile } =
        await makeReviewSourceWorkspace();
      try {
        const value = {
          schema: "play-review/findings/v3",
          review_head_sha: reviewHeadSha,
          findings: [],
          carry_forward: [],
          incomplete_review_routes: [],
          verification: {
            state: "not-required",
            selected_ids: [],
            reason: "No unresolved blocking claims",
          },
          prior_dispositions: [
            {
              id: "prior-1",
              origin_head_sha: "b".repeat(40),
              status,
              assessed_head_sha: reviewHeadSha,
              reason: "Current source disproves the prior claim",
            },
          ],
        };
        expect(() => validateTargetedReviewEvidence(value)).not.toThrow();
        await expect(
          runHelperWithStdin(cwd, "publish-findings", JSON.stringify(value), {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: findingsFile,
          }),
        ).resolves.toMatchObject({ stdout: `${findingsFile}\n` });
        await expect(
          runHelper(cwd, "validate-findings", {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: findingsFile,
          }),
        ).resolves.toMatchObject({ stderr: "" });
        expect(
          JSON.parse(await readFile(path.join(cwd, findingsFile), "utf8")),
        ).toEqual(value);
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("binds validation to the supplied review head without requiring checkout HEAD", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const priorHead = await currentHeadSha(cwd);
      const file = `.ephemeral/topic-${priorHead}-findings.json`;
      await execFileAsync(
        "git",
        ["commit", "--allow-empty", "-m", "Later candidate"],
        { cwd },
      );
      const value = createReviewEnvelope(
        {
          schema: "play-review/findings/v3",
          findings: [],
          carry_forward: [],
          incomplete_review_routes: [],
        },
        priorHead,
      ) as Record<string, unknown>;
      await writeFile(path.join(cwd, file), JSON.stringify(value));
      await expect(
        runHelper(cwd, "validate-findings", {
          HEAD_SHA: priorHead,
          FINDINGS_FILE: file,
        }),
      ).resolves.toMatchObject({ stderr: "" });
      value.review_head_sha = await currentHeadSha(cwd);
      await writeFile(path.join(cwd, file), JSON.stringify(value));
      await expect(
        runHelper(cwd, "validate-findings", {
          HEAD_SHA: priorHead,
          FINDINGS_FILE: file,
        }),
      ).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects legacy evidence for reads, nits and publication", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const reviewHeadSha = await currentHeadSha(cwd);
      const file = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const historical = JSON.stringify({
        schema: "play-review/findings/v2",
        findings: [],
        carry_forward: [],
        incomplete_topical_routes: [],
      });
      await writeFile(path.join(cwd, file), historical);
      await expect(
        runHelper(cwd, "validate-findings", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: file,
        }),
      ).rejects.toThrow();
      await expect(
        runHelperWithStdin(cwd, "publish-findings", historical, {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: file,
        }),
      ).rejects.toThrow();
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: file }),
      ).rejects.toThrow();
      expect(await readFile(path.join(cwd, file), "utf8")).toBe(historical);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("validates targeted skip, failure, freshness and per-finding verification in v3", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const value = {
        schema: "play-review/findings/v3",
        review_head_sha: reviewHeadSha,
        findings: [] as Record<string, unknown>[],
        carry_forward: [],
        prior_dispositions: [],
        incomplete_review_routes: [] as Record<string, string>[],
        verification: {
          state: "not-required",
          selected_ids: [] as string[],
          reason: "No selected blockers",
        },
      };
      const validate = async () => {
        await writeRawEnvelope(cwd, findingsFile, value);
        return runHelper(cwd, "validate-findings", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
        });
      };
      await expect(validate()).resolves.toMatchObject({ stderr: "" });
      const claim = {
        ...sourceFinding(),
        id: "F1",
        origin_head_sha: reviewHeadSha,
        critic: null,
        assessment: {
          state: "fresh",
          assessed_head_sha: reviewHeadSha,
          reuse_checked_head_sha: null,
          basis: "Source, dependency, contract and anchor checked",
          selection: "none",
          verification: "not-required",
        },
      };
      value.findings.push(claim);
      await expect(validate()).resolves.toMatchObject({ stderr: "" });
      value.findings[0] = { ...claim, critic: "VALID" };
      await expect(validate()).rejects.toThrow();
      value.findings[0] = claim;
      claim.assessment.selection = "consequential";
      claim.assessment.verification = "incomplete";
      value.verification = {
        state: "incomplete",
        selected_ids: ["F1"],
        reason: "Verifier unavailable",
      };
      await expect(validate()).rejects.toThrow();
      value.incomplete_review_routes = [
        { route: "D10", disposition: "FAILED" },
      ];
      await expect(validate()).resolves.toMatchObject({ stderr: "" });
      await writeFile(
        path.join(cwd, ".ephemeral/review-body.md"),
        "Unverified review",
      );
      await expect(
        runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: ".ephemeral/review-body.md",
          REVIEW_EVENT: "APPROVE",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "incomplete or blocking review cannot approve",
        ),
      });
      claim.assessment.assessed_head_sha = "b".repeat(40);
      await expect(validate()).rejects.toThrow();
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("renders a pr-review preview from review-head source with findings, carry-forward, and payload-equivalent body", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const reviewBodyFile = ".ephemeral/review-body.md";
      await writeFile(path.join(cwd, reviewBodyFile), "Draft summary\n");
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          sourceFinding({
            line: 4,
            anchor: "natural",
            why: "The natural finding should show reviewed HEAD source.",
            recommendation: "Keep preview evidence tied to HEAD_SHA.",
            body: "**Blocking | Contracts** — The natural finding should show reviewed HEAD source.\n\n**Recommendation:** Keep preview evidence tied to HEAD_SHA.",
          }),
          sourceFinding({
            line: 8,
            anchor: "out-of-diff",
            why: "The out-of-diff finding belongs in the review body.",
            recommendation: "Append it to the top-level body.",
            body: "**Blocking | Contracts** — The out-of-diff finding belongs in the review body.\n\n**Recommendation:** Append it to the top-level body.",
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
            body: "**Nit | Tests** — The carry-forward finding should still be rendered.\n\n**Recommendation:** Include carry-forward evidence.",
          }),
          sourceFinding({
            line: 7,
            anchor: "out-of-diff",
            why: "Carry-forward out-of-diff entries also belong in the body.",
            recommendation: "Keep them out of inline comments.",
            body: "**Blocking | Contracts** — Carry-forward out-of-diff entries also belong in the body.\n\n**Recommendation:** Keep them out of inline comments.",
          }),
        ],
        incomplete_review_routes: [],
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
      const decoded = JSON.parse(payload.stdout) as {
        body: string;
        comments: Array<Record<string, unknown>>;
      };

      expect(preview.stdout).toContain(`Review head: ${reviewHeadSha}`);
      expect(preview.stdout).toContain(`Findings file: ${findingsFile}`);
      expect(preview.stdout).toContain("## Findings");
      expect(preview.stdout).toContain("## Carry-forward");
      expect(preview.stdout).toContain(
        "- **Critic:** (not required — unverified)",
      );
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
      expect(decoded.comments).toHaveLength(1);
      expect(decoded.comments[0]).toMatchObject({
        path: "src/review-target.ts",
        line: 4,
        side: "RIGHT",
      });
      expect(JSON.stringify(decoded.comments)).not.toContain(
        "The carry-forward finding should still be rendered.",
      );
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("accepts anchors on review-head trailing blank lines", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await mkdir(path.join(cwd, "src"));
      await writeFile(
        path.join(cwd, "src/trailing.ts"),
        "const value = 1;\n\n",
      );
      await execFileAsync("git", ["add", "src/trailing.ts"], { cwd });
      await execFileAsync("git", ["commit", "-m", "feat: add trailing blank"], {
        cwd,
      });
      const { stdout: shaStdout } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD"],
        { cwd },
      );
      const reviewHeadSha = shaStdout.trim();
      const reviewFindingsFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const reviewBodyFile = ".ephemeral/review-body.md";

      await writeFile(path.join(cwd, reviewBodyFile), "Summary\n");
      await writeRawEnvelope(cwd, reviewFindingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          sourceFinding({
            path: "src/trailing.ts",
            line: 2,
            why: "The trailing blank line remains valid review-head source.",
            recommendation: "Keep trailing source lines anchorable.",
            body: "**Blocking | Contracts** — The trailing blank line remains valid review-head source.\n\n**Recommendation:** Keep trailing source lines anchorable.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [
          { route: "D7", disposition: "NEEDS_CONTEXT" },
        ],
      });

      const preview = await runHelper(cwd, "render-review-preview", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: reviewFindingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
      });
      const payload = await runHelper(cwd, "build-github-review-payload", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: reviewFindingsFile,
        REVIEW_SURFACE: "pr-review",
        REVIEW_BODY_FILE: reviewBodyFile,
        REVIEW_EVENT: "COMMENT",
      });

      expect(preview.stdout).toContain("// src/trailing.ts:1-2");
      expect(preview.stdout).toContain("const value = 1;");
      expect(JSON.parse(payload.stdout).comments[0]).toMatchObject({
        path: "src/trailing.ts",
        line: 2,
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects inline anchors against empty review-head files before preview or payload output", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await mkdir(path.join(cwd, "src"));
      await writeFile(path.join(cwd, "src/empty.ts"), "");
      await execFileAsync("git", ["add", "src/empty.ts"], { cwd });
      await execFileAsync("git", ["commit", "-m", "feat: add empty source"], {
        cwd,
      });
      const { stdout: shaStdout } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD"],
        { cwd },
      );
      const reviewHeadSha = shaStdout.trim();
      const reviewFindingsFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const reviewBodyFile = ".ephemeral/review-body.md";

      await writeFile(path.join(cwd, reviewBodyFile), "Summary\n");
      await writeRawEnvelope(cwd, reviewFindingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          sourceFinding({
            path: "src/empty.ts",
            line: 1,
            why: "The empty source file has no line to anchor.",
            recommendation: "Reject empty-file inline anchors.",
            body: "**Blocking | Contracts** — The empty source file has no line to anchor.\n\n**Recommendation:** Reject empty-file inline anchors.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [
          { route: "D7", disposition: "NEEDS_CONTEXT" },
        ],
      });

      await expect(
        runHelper(cwd, "render-review-preview", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: reviewFindingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: reviewBodyFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "review-head source line out of range: src/empty.ts:1",
        ),
      });
      await expect(
        runHelper(cwd, "build-github-review-payload", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: reviewFindingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "COMMENT",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "review-head source line out of range: src/empty.ts:1",
        ),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("renders exact post-ready inline bodies from validated body fields", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      const reviewBodyFile = ".ephemeral/review-body.md";
      const naturalBody =
        "**Blocking | Contracts** — Posted natural body from the frozen artifact.\n\n**Recommendation:** Post this natural recommendation.";
      const missingBody =
        "**Nit | Tests** — Posted missing-file body from the frozen artifact.\n\n**Recommendation:** Post this missing-file recommendation.";
      await writeFile(path.join(cwd, reviewBodyFile), "Draft summary\n");
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          sourceFinding({
            line: 4,
            anchor: "natural",
            why: "Posted natural body from the frozen artifact.",
            recommendation: "Post this natural recommendation.",
            body: naturalBody,
          }),
          sourceFinding({
            line: 8,
            anchor: "missing-file",
            severity: "Nit",
            category: "Tests",
            critic: null,
            why: "Posted missing-file body from the frozen artifact.",
            recommendation: "Post this missing-file recommendation.",
            body: missingBody,
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
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
      const normalizedPreview = preview.stdout.replace(/\r\n/g, "\n");

      expect(decoded.comments[0].body).toBe(naturalBody);
      expect(decoded.comments[1].body).toBe(
        `Missing-file finding (no natural anchor — see body):\n\n${missingBody}`,
      );
      expect(normalizedPreview).toContain(
        `#### Rendered Finding Body\n\n${decoded.comments[0].body}\n\n`,
      );
      expect(normalizedPreview).toContain(
        `#### Rendered Finding Body\n\n${decoded.comments[1].body}\n\n`,
      );
      expect(normalizedPreview).toContain(naturalBody);
      expect(normalizedPreview).toContain(missingBody);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects bodies that diverge from live finding fields", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          sourceFinding({
            line: 4,
            why: "The structured why must match the body.",
            recommendation: "The structured recommendation must match too.",
            body: "**Blocking | Contracts** — Posted natural body from the frozen artifact.\n\n**Recommendation:** Post this natural recommendation.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      });

      await expect(
        runHelper(cwd, "validate-findings", {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope shape mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects empty why and recommendation fields before writing downgraded nits", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            critic: "DOWNGRADE",
            why: "",
            recommendation: "",
            body: "**Blocking | Contracts** — \n\n**Recommendation:** ",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      });

      await expect(
        runHelper(cwd, "prepare-judgment-nits", {
          FINDINGS_FILE: findingsFile,
          JUDGMENT_REQUIRED_FINDING_INDEXES: "0",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope shape mismatch"),
      });
      await expect(lstat(path.join(cwd, nitsFile))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("renders branch-review preview without a review body or GitHub posting concepts", async () => {
    const { cwd, reviewHeadSha, findingsFile } =
      await makeReviewSourceWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          sourceFinding({
            severity: "Nit",
            category: "Tests",
            critic: null,
            body: "**Nit | Tests** — The reviewed source has a problem.\n\n**Recommendation:** Adjust the reviewed source.",
          }),
          sourceFinding({
            line: 5,
            critic: null,
            why: "The ordinary blocker does not require separate verification.",
            recommendation: "Preserve the unverified blocking finding.",
            body: "**Blocking | Contracts** — The ordinary blocker does not require separate verification.\n\n**Recommendation:** Preserve the unverified blocking finding.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      });

      const { stdout } = await runHelper(cwd, "render-review-preview", {
        HEAD_SHA: reviewHeadSha,
        FINDINGS_FILE: findingsFile,
        REVIEW_SURFACE: "branch-review",
      });

      expect(stdout).toContain("## Findings");
      expect(stdout).toContain("src/review-target.ts");
      expect(stdout).toContain("- **Critic:** (not required — unverified)");
      expect(stdout).toContain("- **Critic:** (not required — unverified)");
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
        schema: "play-review/findings/v3",
        findings: [
          sourceFinding({
            anchor: "natural",
            why: "Natural body.",
            recommendation: "Fix it.",
            body: "**Blocking | Contracts** — Natural body.\n\n**Recommendation:** Fix it.",
          }),
          sourceFinding({
            line: 8,
            anchor: "missing-file",
            why: "Missing file body.",
            recommendation: "Anchor to fallback.",
            body: "**Blocking | Contracts** — Missing file body.\n\n**Recommendation:** Anchor to fallback.",
          }),
          sourceFinding({
            line: 9,
            anchor: "out-of-diff",
            why: "Out of diff body.",
            recommendation: "Put in body.",
            body: "**Blocking | Contracts** — Out of diff body.\n\n**Recommendation:** Put in body.",
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
            why: "Range body.",
            recommendation: "Keep range.",
            body: "**Nit | Tests** — Range body.\n\n**Recommendation:** Keep range.",
          }),
          sourceFinding({
            line: 7,
            anchor: "out-of-diff",
            why: "Carry forward out of diff.",
            recommendation: "Put in body too.",
            body: "**Blocking | Contracts** — Carry forward out of diff.\n\n**Recommendation:** Put in body too.",
          }),
        ],
        incomplete_review_routes: [],
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
      expect(payload.comments).toHaveLength(2);
      expect(payload.comments[0]).toEqual({
        path: "src/review-target.ts",
        line: 4,
        side: "RIGHT",
        body: "**Blocking | Contracts** — Natural body.\n\n**Recommendation:** Fix it.",
      });
      expect(payload.comments[1].body).toContain(
        "Missing-file finding (no natural anchor — see body):",
      );
      expect(payload.comments[1]).not.toHaveProperty("start_line");
      expect(payload.comments[1]).not.toHaveProperty("start_side");
      expect(JSON.stringify(payload.comments)).not.toContain("Range body");
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
        schema: "play-review/findings/v3",
        findings: [sourceFinding({ anchor: "out-of-diff" })],
        carry_forward: [],
        incomplete_review_routes: [],
      });
      const outOfDiffOnly = await runHelper(
        cwd,
        "build-github-review-payload",
        {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: findingsFile,
          REVIEW_SURFACE: "pr-review",
          REVIEW_BODY_FILE: reviewBodyFile,
          REVIEW_EVENT: "COMMENT",
        },
      );
      expect(JSON.parse(outOfDiffOnly.stdout).comments).toEqual([]);

      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [],
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
        schema: "play-review/findings/v3",
        findings: [sourceFinding({ path: "src/missing.ts" })],
        carry_forward: [],
        incomplete_review_routes: [],
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
          schema: "play-review/findings/v3",
          findings: [sourceFinding()],
          carry_forward: [],
          incomplete_review_routes: [],
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
        schema: "play-review/findings/v3",
        findings: [
          finding(),
          finding({
            line: 43,
            critic: null,
            why: "The ordinary blocker does not require separate verification.",
            recommendation: "Preserve the unverified blocking finding.",
            body: "**Blocking | Contracts** — The ordinary blocker does not require separate verification.\n\n**Recommendation:** Preserve the unverified blocking finding.",
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
            body: "**Nit | Tests** — The coverage should prove non-empty carry-forward entries.\n\n**Recommendation:** Keep this positive fixture.",
          }),
        ],
        incomplete_review_routes: [],
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

  it("rejects findings whose body uses a plain hyphen separator", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            body: "**Blocking | Contracts** - The contract would otherwise be ambiguous.\n\n**Recommendation:** Keep the helper contract explicit.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      });

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope shape mismatch"),
      });
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

  it("writes selected judgment-required nits in caller index order and normalizes downgraded findings", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            severity: "Nit",
            category: "Documentation",
            critic: null,
            why: "The wording has a single clear improvement.",
            recommendation: "Tighten the wording.",
            body: "**Nit | Documentation** — The wording has a single clear improvement.\n\n**Recommendation:** Tighten the wording.",
          }),
          finding({
            line: 43,
            critic: "DOWNGRADE",
            why: "The feedback is valid but not blocking.",
            recommendation: "Mention it as non-blocking review feedback.",
            body: "**Blocking | Contracts** — The feedback is valid but not blocking.\n\n**Recommendation:** Mention it as non-blocking review feedback.",
          }),
          finding({
            line: 44,
            critic: "INVALID",
            why: "The critic rejected this finding.",
            recommendation: "Do not carry it forward.",
            body: "**Blocking | Contracts** — The critic rejected this finding.\n\n**Recommendation:** Do not carry it forward.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [
          { route: "D7", disposition: "NEEDS_CONTEXT" },
        ],
      });

      const { stdout } = await runHelper(cwd, "prepare-judgment-nits", {
        FINDINGS_FILE: findingsFile,
        JUDGMENT_REQUIRED_FINDING_INDEXES: "1,0",
      });

      expect(stdout).toBe(`${nitsFile}\n`);
      const written = JSON.parse(
        await readFile(path.join(cwd, nitsFile), "utf-8"),
      );
      expect(written).toMatchObject({
        schema: "play-review/findings/v3",
        carry_forward: [],
        incomplete_review_routes: [
          { route: "D7", disposition: "NEEDS_CONTEXT" },
        ],
      });
      expect(written.findings).toHaveLength(2);
      expect(written.findings[0]).toMatchObject({
        line: 43,
        severity: "Blocking",
        critic: "DOWNGRADE",
        body: "**Blocking | Contracts** — The feedback is valid but not blocking.\n\n**Recommendation:** Mention it as non-blocking review feedback.",
      });
      expect(written.findings[1]).toMatchObject({
        line: 42,
        severity: "Nit",
        critic: null,
        body: "**Nit | Documentation** — The wording has a single clear improvement.\n\n**Recommendation:** Tighten the wording.",
      });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: nitsFile }),
      ).resolves.toMatchObject({ stdout: "" });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("hands off carried-only nits with unchanged provenance and deduplicates mirrors", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const nit = finding({
        severity: "Nit",
        critic: null,
        body: `**Nit | Contracts** — ${finding().why}\n\n**Recommendation:** ${finding().recommendation}`,
      });
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [nit],
        carry_forward: [nit, { ...nit, line: 43 }],
        incomplete_review_routes: [],
      });
      const original = JSON.parse(
        await readFile(path.join(cwd, findingsFile), "utf-8"),
      );
      const carried = original.carry_forward[1];
      carried.origin_head_sha = "b".repeat(40);
      carried.assessment.state = "reused";
      carried.assessment.assessed_head_sha = "b".repeat(40);
      carried.assessment.reuse_checked_head_sha = original.review_head_sha;
      await writeFile(path.join(cwd, findingsFile), JSON.stringify(original));
      await runHelper(cwd, "prepare-judgment-nits", {
        FINDINGS_FILE: findingsFile,
        JUDGMENT_REQUIRED_FINDING_INDEXES: "1,0",
      });
      const written = JSON.parse(
        await readFile(path.join(cwd, nitsFile), "utf-8"),
      );
      expect(written.findings).toEqual([carried, original.findings[0]]);
      expect(written.carry_forward).toEqual([]);
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: nitsFile }),
      ).resolves.toMatchObject({ stdout: "" });
      expect(
        JSON.parse(await readFile(path.join(cwd, findingsFile), "utf-8")),
      ).toEqual(original);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects current envelopes that omit incomplete-route evidence", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            severity: "Nit",
            category: "Documentation",
            critic: null,
            why: "The wording has a single clear improvement.",
            recommendation: "Tighten the wording.",
            body: "**Nit | Documentation** — The wording has a single clear improvement.\n\n**Recommendation:** Tighten the wording.",
          }),
        ],
        carry_forward: [],
      });

      await expect(
        runHelper(cwd, "validate-findings", { FINDINGS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope shape mismatch"),
      });
      await expect(
        runHelper(cwd, "validate-nits-file", { NITS_FILE: findingsFile }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope shape mismatch"),
      });
      await expect(
        runHelper(cwd, "prepare-judgment-nits", {
          FINDINGS_FILE: findingsFile,
          JUDGMENT_REQUIRED_FINDING_INDEXES: "0",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope schema mismatch"),
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unsafe judgment-nits selections before writing", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            severity: "Nit",
            category: "Contracts",
            critic: null,
            why: "Carry this forward.",
            recommendation: "Keep it.",
            body: "**Nit | Contracts** — Carry this forward.\n\n**Recommendation:** Keep it.",
          }),
          finding({
            line: 43,
            critic: "INVALID",
            why: "The critic rejected this finding.",
            recommendation: "Do not select it.",
            body: "**Blocking | Contracts** — The critic rejected this finding.\n\n**Recommendation:** Do not select it.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      });

      for (const selectedIndexes of ["", "0,0", "2", "a", "0, 1"]) {
        await expect(
          runHelper(cwd, "prepare-judgment-nits", {
            FINDINGS_FILE: findingsFile,
            JUDGMENT_REQUIRED_FINDING_INDEXES: selectedIndexes,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining("JUDGMENT_REQUIRED_FINDING_INDEXES"),
        });
      }

      await expect(
        runHelper(cwd, "prepare-judgment-nits", {
          FINDINGS_FILE: findingsFile,
          JUDGMENT_REQUIRED_FINDING_INDEXES: "1",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("judgment nits validation failed"),
      });
      await expect(lstat(path.join(cwd, nitsFile))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unresolved true blocking findings even when they are not selected", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            severity: "Nit",
            category: "Contracts",
            critic: null,
            why: "Carry this forward.",
            recommendation: "Keep it.",
            body: "**Nit | Contracts** — Carry this forward.\n\n**Recommendation:** Keep it.",
          }),
          finding({
            line: 43,
            critic: "VALID",
            why: "This is still blocking.",
            recommendation: "Stop before Phase 8.",
            body: "**Blocking | Contracts** — This is still blocking.\n\n**Recommendation:** Stop before Phase 8.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      });

      await expect(
        runHelper(cwd, "prepare-judgment-nits", {
          FINDINGS_FILE: findingsFile,
          JUDGMENT_REQUIRED_FINDING_INDEXES: "0",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("judgment nits validation failed"),
      });
      await expect(lstat(path.join(cwd, nitsFile))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("rejects unresolved true blocking carry-forward findings before writing", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      await writeRawEnvelope(cwd, findingsFile, {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            severity: "Nit",
            category: "Contracts",
            critic: null,
            why: "Carry this forward.",
            recommendation: "Keep it.",
            body: "**Nit | Contracts** — Carry this forward.\n\n**Recommendation:** Keep it.",
          }),
        ],
        carry_forward: [
          finding({
            line: 43,
            critic: "VALID",
            why: "This carry-forward finding is still blocking.",
            recommendation: "Stop before Phase 8.",
            body: "**Blocking | Contracts** — This carry-forward finding is still blocking.\n\n**Recommendation:** Stop before Phase 8.",
          }),
        ],
        incomplete_review_routes: [],
      });

      await expect(
        runHelper(cwd, "prepare-judgment-nits", {
          FINDINGS_FILE: findingsFile,
          JUDGMENT_REQUIRED_FINDING_INDEXES: "0",
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("judgment nits validation failed"),
      });
      await expect(lstat(path.join(cwd, nitsFile))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("publishes a complete current-head envelope by atomically replacing only the canonical findings file", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const reviewHeadSha = await currentHeadSha(cwd);
      const canonicalFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const priorEnvelope = {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [],
      };
      const replacementEnvelope = {
        ...priorEnvelope,
        findings: [finding()],
      };
      await writeRawEnvelope(cwd, canonicalFile, priorEnvelope);

      await expect(
        runHelperWithStdin(
          cwd,
          "publish-findings",
          JSON.stringify(
            createReviewEnvelope(replacementEnvelope, reviewHeadSha),
          ),
          { HEAD_SHA: reviewHeadSha, FINDINGS_FILE: canonicalFile },
        ),
      ).resolves.toMatchObject({ stdout: `${canonicalFile}\n` });

      expect(
        JSON.parse(await readFile(path.join(cwd, canonicalFile), "utf-8")),
      ).toEqual(createReviewEnvelope(replacementEnvelope, reviewHeadSha));
      expect((await lstat(path.join(cwd, canonicalFile))).isFile()).toBe(true);
      await expectNoPublishStaging(cwd);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("preserves the prior canonical envelope and cleans staging for malformed or trailing findings input", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const reviewHeadSha = await currentHeadSha(cwd);
      const canonicalFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const priorEnvelope = {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [],
      };
      const priorContents = `${JSON.stringify(priorEnvelope)}\n`;
      await writeFile(path.join(cwd, canonicalFile), priorContents);

      for (const input of [
        '{"schema":"play-review/findings/v3"',
        `${JSON.stringify(priorEnvelope)} trailing`,
      ]) {
        await expect(
          runHelperWithStdin(cwd, "publish-findings", input, {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: canonicalFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings input must contain exactly one complete JSON envelope",
          ),
        });
        expect(await readFile(path.join(cwd, canonicalFile), "utf-8")).toBe(
          priorContents,
        );
        await expectNoPublishStaging(cwd);
      }

      await expect(
        runHelperWithStdin(
          cwd,
          "publish-findings",
          JSON.stringify({ ...priorEnvelope, schema: "wrong/v1" }),
          { HEAD_SHA: reviewHeadSha, FINDINGS_FILE: canonicalFile },
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("envelope schema mismatch"),
      });
      expect(await readFile(path.join(cwd, canonicalFile), "utf-8")).toBe(
        priorContents,
      );
      await expectNoPublishStaging(cwd);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("refuses invalid UTF-8 before publishing findings and cleans staging", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const reviewHeadSha = await currentHeadSha(cwd);
      const canonicalFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const priorEnvelope = {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [],
      };
      const priorContents = `${JSON.stringify(priorEnvelope)}\n`;
      const input = Buffer.from(
        JSON.stringify({ ...priorEnvelope, findings: [finding()] }),
        "utf8",
      );
      const markerOffset = input.indexOf("skills/play-review/SKILL.md");
      expect(markerOffset).toBeGreaterThanOrEqual(0);
      input[markerOffset] = 0x80;
      await writeFile(path.join(cwd, canonicalFile), priorContents);

      await expect(
        runHelperWithStdin(cwd, "publish-findings", input, {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: canonicalFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings input must be valid UTF-8"),
      });
      expect(await readFile(path.join(cwd, canonicalFile), "utf8")).toBe(
        priorContents,
      );
      await expectNoPublishStaging(cwd);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("requires one document and preserves valid bytes without ambient Node", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const fakeBin = path.join(cwd, "test-bin");
      const nodeShim = path.join(fakeBin, "node");
      await mkdir(fakeBin);
      await writeFile(nodeShim, "#!/usr/bin/env sh\nexit 97\n");
      await chmod(nodeShim, 0o755);
      const reviewHeadSha = await currentHeadSha(cwd);
      const canonicalFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const priorEnvelope = {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [],
      };
      const replacementEnvelope = {
        ...priorEnvelope,
        findings: [finding()],
      };
      const priorContents = JSON.stringify(priorEnvelope);
      await writeFile(path.join(cwd, canonicalFile), priorContents);

      for (const input of ["", `${priorContents}\n${priorContents}`]) {
        await expect(
          runHelperWithStdin(cwd, "publish-findings", input, {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: canonicalFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings input must contain exactly one complete JSON envelope",
          ),
        });
        expect(await readFile(path.join(cwd, canonicalFile), "utf-8")).toBe(
          priorContents,
        );
        await expectNoPublishStaging(cwd);
      }

      await expect(
        runHelperWithStdin(
          cwd,
          "publish-findings",
          `${JSON.stringify(createReviewEnvelope(replacementEnvelope, reviewHeadSha))}\n \t\n`,
          {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: canonicalFile,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          },
        ),
      ).resolves.toMatchObject({ stdout: `${canonicalFile}\n` });
      expect(await readFile(path.join(cwd, canonicalFile), "utf-8")).toBe(
        `${JSON.stringify(createReviewEnvelope(replacementEnvelope, reviewHeadSha))}\n \t\n`,
      );
      await expectNoPublishStaging(cwd);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("refuses stale or noncanonical publication inputs before replacing the existing findings file", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const reviewHeadSha = await currentHeadSha(cwd);
      const canonicalFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const priorEnvelope = {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [],
      };
      const priorContents = JSON.stringify(priorEnvelope);
      await writeFile(path.join(cwd, canonicalFile), priorContents);

      await expect(
        runHelperWithStdin(cwd, "publish-findings", priorContents, {
          HEAD_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          FINDINGS_FILE: canonicalFile,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          "HEAD_SHA is stale or does not match current HEAD",
        ),
      });
      await expect(
        runHelperWithStdin(cwd, "publish-findings", priorContents, {
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: `.ephemeral/wrong-${reviewHeadSha}-findings.json`,
        }),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("findings path mismatch"),
      });

      expect(await readFile(path.join(cwd, canonicalFile), "utf-8")).toBe(
        priorContents,
      );
      await expect(
        lstat(
          path.join(cwd, `.ephemeral/wrong-${reviewHeadSha}-findings.json`),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expectNoPublishStaging(cwd);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it("refuses identity drift while findings input is still being staged", async () => {
    const cwd = await makeTopicGitWorkspace();
    try {
      const reviewHeadSha = await currentHeadSha(cwd);
      const canonicalFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
      const priorContents = JSON.stringify({
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [],
      });
      const replacement = JSON.stringify(
        createReviewEnvelope(
          {
            schema: "play-review/findings/v3",
            findings: [finding()],
            carry_forward: [],
            incomplete_review_routes: [],
          },
          reviewHeadSha,
        ),
      );
      await writeFile(path.join(cwd, canonicalFile), priorContents);

      const child = spawn("bash", [helperScript, "publish-findings"], {
        cwd,
        env: {
          ...process.env,
          HEAD_SHA: reviewHeadSha,
          FINDINGS_FILE: canonicalFile,
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        stderr += chunk;
      });
      const outcome = new Promise<{ code: number | null }>(
        (resolve, reject) => {
          child.on("error", reject);
          child.on("close", (code) => resolve({ code }));
        },
      );
      const midpoint = Math.floor(replacement.length / 2);
      child.stdin.write(replacement.slice(0, midpoint));
      await waitForPublishStaging(cwd);
      await writeFile(path.join(cwd, "README.md"), "changed identity\n");
      await execFileAsync("git", ["add", "README.md"], { cwd });
      await execFileAsync("git", ["commit", "-m", "test: drift head"], {
        cwd,
      });
      child.stdin.end(replacement.slice(midpoint));

      await expect(outcome).resolves.toEqual({ code: 1 });
      expect(stdout).toBe("");
      expect(stderr).toContain(
        "HEAD_SHA is stale or does not match current HEAD",
      );
      expect(await readFile(path.join(cwd, canonicalFile), "utf8")).toBe(
        priorContents,
      );
      await expectNoPublishStaging(cwd);
    } finally {
      await cleanupTempDir(cwd);
    }
  });

  it.skipIf(!symlinkAvailable)(
    "refuses a symlinked canonical publication target without touching its referent",
    async () => {
      const cwd = await makeTopicGitWorkspace();
      const outside = path.join(cwd, "outside-findings.json");
      try {
        const reviewHeadSha = await currentHeadSha(cwd);
        const canonicalFile = `.ephemeral/topic-${reviewHeadSha}-findings.json`;
        const envelope = {
          schema: "play-review/findings/v3",
          findings: [],
          carry_forward: [],
          incomplete_review_routes: [],
        };
        const input = JSON.stringify(envelope);
        await writeFile(outside, "do not overwrite\n");
        await symlink(outside, path.join(cwd, canonicalFile));

        await expect(
          runHelperWithStdin(cwd, "publish-findings", input, {
            HEAD_SHA: reviewHeadSha,
            FINDINGS_FILE: canonicalFile,
          }),
        ).rejects.toMatchObject({
          stderr: expect.stringContaining(
            "findings path must not be a symlink",
          ),
        });
        expect(await readFile(outside, "utf-8")).toBe("do not overwrite\n");
        await expectNoPublishStaging(cwd);
      } finally {
        await cleanupTempDir(cwd);
      }
    },
  );

  it("computes and prepares the findings write path from the checked-out git branch", async () => {
    const cwd = await makeGitWorkspace();
    try {
      const branchSlugCases = [
        ["topic", "topic"],
        ["Feature/ABC.1_2", "Feature-ABC.1_2"],
        ["feat/café-1", "feat-caf-1"],
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
          incomplete_review_routes: [],
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
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
      },
      {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: "missing",
      },
      {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: [],
        incomplete_review_routes: [
          { route: "D7", disposition: "FAILED" },
          { route: "D7", disposition: "NEEDS_CONTEXT" },
        ],
      },
      {
        schema: "play-review/findings/v3",
        findings: "not-array",
        carry_forward: [],
        incomplete_review_routes: [],
      },
      {
        schema: "play-review/findings/v3",
        findings: [],
        carry_forward: {},
      },
      {
        schema: "play-review/findings/v3",
        findings: [
          {
            ...finding(),
            body: undefined,
          },
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      },
      {
        schema: "play-review/findings/v3",
        findings: [finding({ body: 42 })],
        carry_forward: [],
        incomplete_review_routes: [],
      },
      {
        schema: "play-review/findings/v3",
        findings: [
          finding({
            body: "**Blocking | Contracts** — Missing the recommendation label.",
          }),
        ],
        carry_forward: [],
        incomplete_review_routes: [],
      },
      {
        schema: "play-review/findings/v3",
        findings: [finding({ path: "../../outside" })],
        carry_forward: [],
        incomplete_review_routes: [],
      },
      {
        schema: "play-review/findings/v3",
        findings: [finding({ severity: "Nit", critic: "VALID" })],
        carry_forward: [],
        incomplete_review_routes: [],
      },
      {
        schema: "play-review/findings/v3",
        findings: [finding({ path: "/absolute/path" })],
        carry_forward: [],
        incomplete_review_routes: [],
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
        await expect(
          runHelper(cwd, "validate-nits-file", { NITS_FILE: findingsFile }),
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
