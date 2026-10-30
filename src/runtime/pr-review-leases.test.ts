import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm as removePath,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createPrReviewLeaseFixtures } from "../__test-helpers__/pr-review-lease-fixtures.js";
import * as artifacts from "./artifacts.js";
import { type PrReviewLease, reducePrReviewLease } from "./pr-review-leases.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: vi.fn(actual.link),
    open: vi.fn(actual.open),
    rm: vi.fn(actual.rm),
    writeFile: vi.fn(actual.writeFile),
  };
});

const {
  resolveGitForWindowsBash,
  execFileAsync,
  rm,
  runPrReviewLeasesCommand,
  discoverPrReviewSession,
  setLeaseCommandEnv,
  unsetEnv,
  writeLeaseCommandState,
  readLease,
  sha256File,
  makeGatedStatusWorkspace,
  setReadStatusEnv,
  setAuditFailureEnv,
  setHelperAuthorityEnv,
  mutateLease,
  mutateNestedFindingsWithoutUpdatingResult,
  makeLeaseWorkspace,
  makeResultAuthorityWorkspace,
  makeRegisteredWorkspace,
  identityFromLeaseFile,
  discoveryWorktreeDigest,
  abortedCommandLease,
  postedCommandLease,
  writeCountingReviewHelperScripts,
  writeResultArtifact,
  writeApprovedReviewArtifact,
  writeValidatedPayloadArtifact,
  reviewPayload,
  omitKey,
  reviewedCommandLease,
  gatedCommandLease,
  commandHarness,
  originalCwd,
} = createPrReviewLeaseFixtures();

const identity = {
  repository: "owner/repo",
  prNumber: 432,
  worktreePath: "/tmp/review-worktree",
  worktreeDigest:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  leaseFile:
    ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-lease.json",
};
const resultDigest =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const refreshedResultDigest =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const windowsLaneCollectionDeadlineMs = 4_800;

type GatedStatusWorkspace = Awaited<
  ReturnType<typeof makeGatedStatusWorkspace>
>;

it("refuses terminal recreation that would erase preparation failure custody", () => {
  const created = reducePrReviewLease(null, identity, {
    state: "created",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:00:00Z",
  });
  const terminal: PrReviewLease = {
    ...created,
    state: "aborted",
    terminal: { finished_at: "2026-06-11T00:01:00Z", reason: "user abandoned" },
    preparation_failures: [
      {
        directory: ".ephemeral/provider-scope-capture.retained",
        scope_sha256: "a".repeat(64),
        diagnostics_sha256: "b".repeat(64),
      },
    ],
  };
  expect(() =>
    reducePrReviewLease(terminal, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:02:00Z",
      updatedAt: "2026-06-11T00:02:00Z",
    }),
  ).toThrow("preparation failure history");
});

it("selects the exact issue-578 Windows PR-review lane", async () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const laneFiles = [
    "src/__test-helpers__/pr-review-command-harness.test.ts",
    "src/__test-helpers__/pr-review-process-protocol.test.ts",
    "src/__test-helpers__/pr-review-root-identity.test.ts",
    "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
    "src/runtime/pr-review-leases.test.ts",
    "src/runtime/pr-review-manifests.test.ts",
    "src/runtime/source-immutability.test.ts",
  ];
  const selector =
    "PR-review command harness|pr-review process protocol|pr-review root identity|pr-review process lifecycle|(?:rejects stale or mismatched gated result evidence: (?:stale-timestamp|presentation-mismatch)|requires explicit provider evidence input for adapter scope validation|rejects noncanonical retained fingerprint path (?:\\.\\./outside|/absolute) before verify or cleanup deletion)$";

  expect(packageJson.scripts?.["test:ci:windows:pr-review"]).toBe(
    [
      "vitest run --project unit --testTimeout 12000 --no-file-parallelism",
      ...laneFiles,
      `--testNamePattern "${selector}"`,
    ].join(" "),
  );
  const rootIdentitySource = await readFile(
    path.join(
      repositoryRoot,
      "src/__test-helpers__/pr-review-root-identity.test.ts",
    ),
    "utf8",
  );
  const rootIdentitySourceFile = ts.createSourceFile(
    "pr-review-root-identity.test.ts",
    rootIdentitySource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const windowsExecutableTitle =
    "enrolls a real Windows executable and rejects a wrong extension";
  let rootSuiteCount = 0;
  const windowsRegistrations: Array<{
    insideRootSuite: boolean;
    title: string;
  }> = [];
  const isWindowsRunIf = (node: ts.CallExpression): boolean => {
    if (!ts.isCallExpression(node.expression)) return false;
    const runIf = node.expression;
    if (
      !ts.isPropertyAccessExpression(runIf.expression) ||
      !ts.isIdentifier(runIf.expression.expression) ||
      runIf.expression.expression.text !== "test" ||
      runIf.expression.name.text !== "runIf"
    ) {
      return false;
    }
    const condition = runIf.arguments[0];
    return (
      condition !== undefined &&
      ts.isBinaryExpression(condition) &&
      condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isPropertyAccessExpression(condition.left) &&
      ts.isIdentifier(condition.left.expression) &&
      condition.left.expression.text === "process" &&
      condition.left.name.text === "platform" &&
      ts.isStringLiteral(condition.right) &&
      condition.right.text === "win32"
    );
  };
  const visitRootIdentity = (node: ts.Node, insideRootSuite = false): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "describe" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "pr-review root identity" &&
      node.arguments[1] !== undefined &&
      (ts.isArrowFunction(node.arguments[1]) ||
        ts.isFunctionExpression(node.arguments[1]))
    ) {
      rootSuiteCount += 1;
      ts.forEachChild(node.arguments[1].body, (child) =>
        visitRootIdentity(child, true),
      );
      return;
    }
    if (ts.isCallExpression(node) && isWindowsRunIf(node)) {
      const title = node.arguments[0];
      windowsRegistrations.push({
        insideRootSuite,
        title:
          title !== undefined && ts.isStringLiteral(title)
            ? title.text
            : "<nonliteral>",
      });
    }
    ts.forEachChild(node, (child) => visitRootIdentity(child, insideRootSuite));
  };
  visitRootIdentity(rootIdentitySourceFile);
  expect(rootSuiteCount).toBe(1);
  expect(windowsRegistrations).toEqual([
    { insideRootSuite: true, title: windowsExecutableTitle },
  ]);

  type LaneTestInventory = {
    file: string;
    name: string;
    projectName: string;
  };
  const compareInventory = (
    left: LaneTestInventory,
    right: LaneTestInventory,
  ): number => {
    const leftKey = `${left.file}\0${left.name}\0${left.projectName}`;
    const rightKey = `${right.file}\0${right.name}\0${right.projectName}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  };
  const sortInventory = (inventory: LaneTestInventory[]) =>
    [...inventory].sort(compareInventory);
  // Collect the exact lane union once so each file shares Vitest startup and
  // module transforms. This remains tooling work under the same child deadline.
  const collection = await commandHarness.run(
    process.execPath,
    [
      path.join(repositoryRoot, "node_modules/vitest/vitest.mjs"),
      "list",
      "--project",
      "unit",
      "--json",
      "--no-file-parallelism",
      ...laneFiles,
      "--testNamePattern",
      selector,
    ],
    { cwd: repositoryRoot, deadlineMs: windowsLaneCollectionDeadlineMs },
  );
  expect(collection.exitCode, collection.stderr).toBe(0);
  expect(collection.stderr).toBe("");
  const inventory = JSON.parse(collection.stdout) as LaneTestInventory[];
  const collectedInventory = sortInventory(
    inventory.map(({ file, name, projectName }) => ({
      file: path.relative(repositoryRoot, file).split(path.sep).join("/"),
      name,
      projectName,
    })),
  );
  const expectedCollectedInventory: LaneTestInventory[] = [
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > does not report an outer rejection already delivered before its deadline",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > preserves child deadline comparison guards before child start",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > preserves constructor deadline comparison guards",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > preserves output overflow when delayed Windows cleanup crosses the deadline",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > preserves output overflow when simulated Windows cleanup also fails",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > reports a failed Windows fallback before a non-closing child is released",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > reports bounded taskkill diagnostics after a simulated Windows direct-child fallback",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > retains a late outer-operation rejection until drain",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > terminates a child whose output exceeds the bounded buffer",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > terminates an over-deadline child and drains it through close",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness process ownership > uses the 4500ms normal deadline for outer operations",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > copies immutable history into independent short registered worktrees",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > fails fast when a generated suffix exceeds the path budget",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > prunes a registered worktree whose .git marker is missing",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > prunes a registered worktree whose directory is missing",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > removes a healthy registered worktree before its case root",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > skips Git removal for an already-unregistered worktree",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > skips Git removal for an unregistered worktree with a stale regular .git marker",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > surfaces Git cleanup failures after removing the case root",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness seeded workspaces > tracks outer work and restores exact cwd and environment state",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-command-harness.test.ts",
      name: "PR-review command harness source seeds > provides committed, unborn, and no-ephemeral independent copies",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > attempts root termination after the shared deadline phase",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > caps and redacts incremental output overflow evidence",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > enforces every finite request boundary with exact and plus-one cases",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > observes a normal root-process exit",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > preserves a changed, aliased, or unsafe generated root",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > records a real spawn failure without claiming the root process spawned",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > records cooperative cancellation acknowledgement",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > records protocol failure and a false root kill without overstating cleanup",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > redacts across chunks before the retained-byte boundary",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > rejects a forged generated-root object even when its path is helper-created",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > removes a safe helper-created generated root after root close",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > reports an incomplete root observation without claiming descendant absence",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > restores controller cwd before generated-root disposition",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > restores harness-owned global state",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-lifecycle.test.ts",
      name: "pr-review process lifecycle > uses a synchronous request snapshot after launch begins",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-protocol.test.ts",
      name: "pr-review process protocol > enforces the exact byte boundary before copying sender payload bytes",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-protocol.test.ts",
      name: "pr-review process protocol > fails closed at EOF and checks terminal state before inspecting later input",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-protocol.test.ts",
      name: "pr-review process protocol > is invariant to coalescing and commits an accepted prefix exactly once",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-protocol.test.ts",
      name: "pr-review process protocol > keeps exact-limit and malformed-suffix outcomes invariant across frame partitions",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-protocol.test.ts",
      name: "pr-review process protocol > rejects malformed JSON messages before framing them as lifecycle evidence",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-protocol.test.ts",
      name: "pr-review process protocol > round trips each checked-in closed V1 message through raw-byte framing",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-process-protocol.test.ts",
      name: "pr-review process protocol > uses intrinsic byte-view metadata and rejects non-ArrayBuffer and Proxy views",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-root-identity.test.ts",
      name: "pr-review root identity > accepts only a component-contained generated-root working directory and detects replacement",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-root-identity.test.ts",
      name: "pr-review root identity > enrolls distinct logical, normalized, physical, and stable directory identity",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-root-identity.test.ts",
      name:
        process.platform === "win32"
          ? "pr-review root identity > enrolls a real Windows executable and rejects a wrong extension"
          : "pr-review root identity > enrolls only a POSIX executable regular file and rejects a non-executable alias",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-root-identity.test.ts",
      name: "pr-review root identity > fails closed for raw symlink-plus-dot-dot components before normalization",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-root-identity.test.ts",
      name: "pr-review root identity > preserves exact three-way redaction variants for a physical parent alias",
      projectName: "unit",
    },
    {
      file: "src/__test-helpers__/pr-review-root-identity.test.ts",
      name: "pr-review root identity > uses only Windows-equivalent volume comparison and preserves original spellings",
      projectName: "unit",
    },
    {
      file: "src/runtime/pr-review-leases.test.ts",
      name: "pr-review lease read-status > rejects stale or mismatched gated result evidence: presentation-mismatch",
      projectName: "unit",
    },
    {
      file: "src/runtime/pr-review-leases.test.ts",
      name: "pr-review lease read-status > rejects stale or mismatched gated result evidence: stale-timestamp",
      projectName: "unit",
    },
    {
      file: "src/runtime/pr-review-manifests.test.ts",
      name: "pr-review Phase 5 audit summary renderer > requires explicit provider evidence input for adapter scope validation",
      projectName: "unit",
    },
    {
      file: "src/runtime/source-immutability.test.ts",
      name: "source-immutability runtime > rejects noncanonical retained fingerprint path ../outside before verify or cleanup deletion",
      projectName: "unit",
    },
    {
      file: "src/runtime/source-immutability.test.ts",
      name: "source-immutability runtime > rejects noncanonical retained fingerprint path /absolute before verify or cleanup deletion",
      projectName: "unit",
    },
  ];

  expect(collectedInventory).toHaveLength(54);
  expect(collectedInventory).toEqual(sortInventory(expectedCollectedInventory));
}, 45_000);

function createLease(): PrReviewLease {
  return reducePrReviewLease(null, identity, {
    state: "created",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:00:00Z",
  });
}

function reviewedLease(): PrReviewLease {
  return reducePrReviewLease(createLease(), identity, {
    state: "reviewed",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:01:00Z",
    resultFile: ".ephemeral/pr-432-result.json",
    resultSha256: resultDigest,
  });
}

function gatedLease(): PrReviewLease {
  return reducePrReviewLease(reviewedLease(), identity, {
    state: "gated",
    baseRef: "main",
    headRef: "topic",
    createdAt: "2026-06-11T00:00:00Z",
    updatedAt: "2026-06-11T00:02:00Z",
    presentedAt: "2026-06-11T00:02:00Z",
    presentationStatus: "preview-current",
    resultSha256: resultDigest,
  });
}

describe("pr-review lease reducer", () => {
  it("creates and advances created, reviewed, and gated leases", () => {
    expect(createLease()).toMatchObject({
      state: "created",
      artifacts: {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
      },
      github: { github_post_result: "not-attempted" },
    });

    expect(reviewedLease()).toMatchObject({
      state: "reviewed",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:01:00Z",
          sha256: resultDigest,
        },
      },
    });

    expect(gatedLease()).toMatchObject({
      state: "gated",
      presentation: {
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:02:00Z",
          sha256: resultDigest,
        },
      },
    });
  });

  it("requires digest inputs for result-manifest reducer states", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "reviewed",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:01:00Z",
        resultFile: ".ephemeral/pr-432-result.json",
      }),
    ).toThrow("RESULT_SHA256 is required");

    expect(() =>
      reducePrReviewLease(reviewedLease(), identity, {
        state: "gated",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:02:00Z",
        presentedAt: "2026-06-11T00:02:00Z",
        presentationStatus: "preview-current",
      }),
    ).toThrow("RESULT_SHA256 is required");
  });

  it("records post success and derives GitHub metadata", () => {
    const posted = reducePrReviewLease(gatedLease(), identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:03:00Z",
      githubPostedAt: "2026-06-11T00:03:00Z",
    });

    expect(posted).toMatchObject({
      state: "posted",
      artifacts: {
        approved_review_file: ".ephemeral/topic-approved-review.json",
        validated_payload_file:
          ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      },
      github: {
        github_post_attempted: true,
        github_post_result: "succeeded",
        github_posted_at: "2026-06-11T00:03:00Z",
      },
      failure: { phase: null },
    });
  });

  it("rejects posted leases without a validated payload pointer", () => {
    expect(() =>
      reducePrReviewLease(gatedLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:03:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:03:00Z",
        githubPostedAt: "2026-06-11T00:03:00Z",
      }),
    ).toThrow("VALIDATED_REVIEW_PAYLOAD_FILE is required");
  });

  it("preserves gated recovery evidence for GitHub post failures", () => {
    const failed = reducePrReviewLease(gatedLease(), identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });

    expect(failed).toMatchObject({
      state: "failed",
      artifacts: {
        result_file: ".ephemeral/pr-432-result.json",
        approved_review_file: ".ephemeral/topic-approved-review.json",
      },
      presentation: { status: "preview-current" },
      github: {
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      },
    });
  });

  it("covers documented lifecycle transition rows", () => {
    const created = createLease();
    const attached = reducePrReviewLease(created, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:00:30Z",
      handoffFile: ".ephemeral/pr-432-handoff.json",
    });
    expect(attached.artifacts.handoff_file).toBe(
      ".ephemeral/pr-432-handoff.json",
    );

    const reviewed = reviewedLease();
    const abortedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      finishedAt: "2026-06-11T00:02:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromReviewed).toMatchObject({
      state: "aborted",
      artifacts: { result_file: ".ephemeral/pr-432-result.json" },
    });

    const gated = gatedLease();
    const refreshedGate = reducePrReviewLease(gated, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:02:30Z",
      presentedAt: "2026-06-11T00:02:30Z",
      presentationStatus: "edited",
      resultSha256: refreshedResultDigest,
    });
    expect(refreshedGate.presentation.status).toBe("edited");
    expect(refreshedGate.validation.result_manifest.sha256).toBe(
      refreshedResultDigest,
    );

    const abortedFromGated = reducePrReviewLease(gated, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:03:30Z",
      finishedAt: "2026-06-11T00:03:30Z",
      terminalReason: "user-aborted",
    });
    expect(abortedFromGated.presentation.status).toBe("preview-current");

    const failedFromCreated = reducePrReviewLease(created, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:04:00Z",
      finishedAt: "2026-06-11T00:04:00Z",
      failurePhase: "handoff-validation",
      failureReason: "handoff rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedFromCreated.artifacts.result_file).toBeNull();

    const failedFromReviewed = reducePrReviewLease(reviewed, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:05:00Z",
      finishedAt: "2026-06-11T00:05:00Z",
      failurePhase: "preview-render",
      failureReason: "preview failed",
      failureRecoverability: "recoverable",
    });
    expect(failedFromReviewed.artifacts.result_file).toBe(
      ".ephemeral/pr-432-result.json",
    );

    const failedPreApproval = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:06:00Z",
      finishedAt: "2026-06-11T00:06:00Z",
      failurePhase: "stale-head",
      failureReason: "head moved",
      failureRecoverability: "recoverable",
    });
    expect(failedPreApproval.presentation.status).toBe("preview-current");

    const failedApprovalFreeze = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:07:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      finishedAt: "2026-06-11T00:07:00Z",
      failurePhase: "approval-freeze",
      failureReason: "approval artifact rejected",
      failureRecoverability: "recoverable",
    });
    expect(failedApprovalFreeze.artifacts.approved_review_file).toBe(
      ".ephemeral/topic-approved-review.json",
    );

    const recoveredGate = reducePrReviewLease(failedPreApproval, identity, {
      state: "gated",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:08:00Z",
      presentedAt: "2026-06-11T00:08:00Z",
      presentationStatus: "preview-current",
      resultSha256: resultDigest,
    });
    expect(recoveredGate.state).toBe("gated");

    const abortedFromFailed = reducePrReviewLease(failedPreApproval, identity, {
      state: "aborted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:09:00Z",
      finishedAt: "2026-06-11T00:09:00Z",
      terminalReason: "not posting",
    });
    expect(abortedFromFailed.state).toBe("aborted");

    const repeatedFailure = reducePrReviewLease(failedPreApproval, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:10:00Z",
      finishedAt: "2026-06-11T00:10:00Z",
      failurePhase: "preview-render",
      failureReason: "preview still failed",
      failureRecoverability: "recoverable",
    });
    expect(repeatedFailure.failure.reason).toBe("preview still failed");

    const githubFailure = reducePrReviewLease(gated, identity, {
      state: "failed",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:11:00Z",
      approvedReviewFile: ".ephemeral/topic-approved-review.json",
      validatedPayloadFile:
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-validated-review-payload.json",
      finishedAt: "2026-06-11T00:11:00Z",
      failurePhase: "github-post",
      failureReason: "GitHub API rejected review",
      failureRecoverability: "recoverable",
      githubPostAttempted: true,
      githubPostResult: "failed",
    });
    const retryPosted = reducePrReviewLease(githubFailure, identity, {
      state: "posted",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:00:00Z",
      updatedAt: "2026-06-11T00:12:00Z",
      finishedAt: "2026-06-11T00:12:00Z",
      githubPostedAt: "2026-06-11T00:12:00Z",
    });
    expect(retryPosted.github.github_post_result).toBe("succeeded");

    const recreated = reducePrReviewLease(abortedFromFailed, identity, {
      state: "created",
      baseRef: "main",
      headRef: "topic",
      createdAt: "2026-06-11T00:13:00Z",
      updatedAt: "2026-06-11T00:13:00Z",
    });
    expect(recreated).toMatchObject({
      state: "created",
      artifacts: { result_file: null },
      validation: {
        result_manifest: { status: null, validated_at: null, sha256: null },
      },
    });
  });

  it("rejects invalid cross-state transitions", () => {
    expect(() =>
      reducePrReviewLease(createLease(), identity, {
        state: "posted",
        baseRef: "main",
        headRef: "topic",
        createdAt: "2026-06-11T00:00:00Z",
        updatedAt: "2026-06-11T00:05:00Z",
        approvedReviewFile: ".ephemeral/topic-approved-review.json",
        finishedAt: "2026-06-11T00:05:00Z",
        githubPostedAt: "2026-06-11T00:05:00Z",
      }),
    ).toThrow("invalid lease transition: created -> posted");
  });
});

describe("pr-review lease command validation", () => {
  // Usage owns omission-only timestamp defaults; command tests cover construction
  // and explicit invalidity absent from the reducer's already-built inputs.
  it("constructs one operation timestamp for omitted creation and terminal inputs", async () => {
    const workspace = await makeRegisteredWorkspace("lease-default-time-");
    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      const derived = await runPrReviewLeasesCommand(["derive-path"]);
      process.env.LEASE_FILE = derived.stdout.trim();
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      for (const key of ["UPDATED_AT", "CREATED_AT"] as const) {
        for (const invalid of [
          "",
          "2026-02-30T00:00:00Z",
          "2026-10-06T00:00:00.Z",
          "2026-10-06T00:00:00+00:00",
          "2026-10-06T00:00:60Z",
          " 2026-10-06T00:00:00Z",
        ]) {
          process.env[key] = invalid;
          const refused = await runPrReviewLeasesCommand(["write"]);
          expect(refused.exitCode, `${key}: ${invalid}`).toBe(1);
          await expect(
            lstat(path.join(workspace.primary, derived.stdout.trim())),
          ).rejects.toMatchObject({ code: "ENOENT" });
        }
        delete process.env[key];
      }
      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const created = await readLease(workspace.primary, derived.stdout.trim());
      expect(created.created_at).toBe(created.updated_at);
      expect(created.updated_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u,
      );
      process.env.STATE = "failed";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review interrupted";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      const failedResult = await runPrReviewLeasesCommand(["write"]);
      expect(failedResult.exitCode, failedResult.stderr).toBe(0);
      const failed = await readLease(workspace.primary, derived.stdout.trim());
      expect(failed.terminal.finished_at).toBe(failed.updated_at);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("defaults omitted gated timestamps but refuses explicitly empty applicable timestamps", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "lease-gate-default-time-",
    );
    try {
      setReadStatusEnv(workspace);
      process.env.STATE = "gated";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.PRESENTATION_STATUS = "preview-current";
      for (const key of [
        "UPDATED_AT",
        "PRESENTED_AT",
        "FINISHED_AT",
      ] as const) {
        process.env.STATE = key === "FINISHED_AT" ? "aborted" : "gated";
        process.env.TERMINAL_REASON = "not posting";
        process.env[key] = "";
        const before = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, key).toBe(1);
        expect(
          await readFile(
            path.join(workspace.primary, workspace.leaseFile),
            "utf8",
          ),
        ).toBe(before);
        delete process.env[key];
      }
      process.env.STATE = "gated";
      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const gated = await readLease(workspace.primary, workspace.leaseFile);
      expect(gated.presentation.presented_at).toBe(gated.updated_at);
      expect(gated.validation.result_manifest.validated_at).toBe(
        gated.updated_at,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a linked worktree presented as the primary repository root", async () => {
    const workspace = await makeRegisteredWorkspace("linked-primary");
    const { stdout } = await execFileAsync("git", [
      "-C",
      workspace.physicalWorktree,
      "rev-parse",
      "HEAD",
    ]);
    process.chdir(workspace.physicalWorktree);
    process.env.REPOSITORY = "owner/repo";
    process.env.PR_NUMBER = "432";
    process.env.PRIMARY_REPOSITORY_ROOT = workspace.physicalWorktree;
    process.env.HEAD_SHA = stdout.trim();
    process.env.BASE_REF = "main";
    process.env.HEAD_REF = "topic";
    process.env.UPDATED_AT = "2026-07-31T00:00:00Z";

    const result = await runPrReviewLeasesCommand(["session-create"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "PRIMARY_REPOSITORY_ROOT must be the primary Git worktree\n",
    });
  });

  it("rejects whitespace-only frozen refs before creating a reservation", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    process.chdir(repository.physicalRepository);
    process.env.REPOSITORY = "owner/repo";
    process.env.PR_NUMBER = "432";
    process.env.PRIMARY_REPOSITORY_ROOT = repository.physicalRepository;
    process.env.HEAD_SHA = stdout.trim();
    process.env.BASE_REF = " \t";
    process.env.HEAD_REF = "topic";
    process.env.UPDATED_AT = "2026-07-31T00:00:00Z";

    const result = await runPrReviewLeasesCommand(["session-create"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "BASE_REF and HEAD_REF must be nonblank\n",
    });
    await expect(
      lstat(
        path.join(
          repository.physicalRepository,
          ".ephemeral/pr-432-session-create-reservation.json",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([undefined, "2026-07-31T00:00:00Z", "2026-10-06T00:00:00.1234567Z"])(
    "creates one verified detached canonical session with timestamp %s",
    async (updatedAt) => {
      const repository = await commandHarness.createReviewRepository();
      const { stdout: headOutput } = await execFileAsync("git", [
        "-C",
        repository.physicalRepository,
        "rev-parse",
        "HEAD",
      ]);
      const head = headOutput.trim();
      process.chdir(repository.physicalRepository);
      process.env.REPOSITORY = "owner/repo";
      process.env.PR_NUMBER = "432";
      process.env.PRIMARY_REPOSITORY_ROOT = repository.physicalRepository;
      process.env.HEAD_SHA = head;
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      if (updatedAt !== undefined) process.env.UPDATED_AT = updatedAt;

      const result = await runPrReviewLeasesCommand(["session-create"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        schema: "pr-review/session-create/v1",
        outcome: "success",
        repository: "owner/repo",
        pr_number: 432,
        primary_repository_root: repository.physicalRepository,
        common_git_directory: path.join(repository.physicalRepository, ".git"),
        canonical_worktree_path: path.join(
          repository.physicalRepository,
          ".worktrees",
          "pr-432-review",
        ),
        immutable_head: head,
        lease_file: expect.stringMatching(
          /^\.ephemeral\/pr-432-[0-9a-f]{64}-lease\.json$/u,
        ),
        lease_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
      const session = JSON.parse(result.stdout) as {
        lease_file: string;
        lease_sha256: string;
      };
      const leaseBytes = await readFile(
        path.join(repository.physicalRepository, session.lease_file),
        "utf8",
      );
      const stored = JSON.parse(leaseBytes) as PrReviewLease;
      expect(stored.created_at).toBe(stored.updated_at);
      if (updatedAt !== undefined) expect(stored.updated_at).toBe(updatedAt);
      expect(leaseBytes).toBe(
        `${JSON.stringify(
          reducePrReviewLease(
            null,
            {
              repository: "owner/repo",
              prNumber: 432,
              worktreePath: path.join(
                repository.physicalRepository,
                ".worktrees",
                "pr-432-review",
              ),
              worktreeDigest: discoveryWorktreeDigest(
                path.join(
                  repository.physicalRepository,
                  ".worktrees",
                  "pr-432-review",
                ),
              ),
              leaseFile: session.lease_file,
            },
            {
              state: "created",
              baseRef: "main",
              headRef: "topic",
              createdAt: stored.created_at,
              updatedAt: stored.updated_at,
            },
          ),
          null,
          2,
        )}\n`,
      );
      expect(
        await sha256File(
          path.join(repository.physicalRepository, session.lease_file),
        ),
      ).toBe(session.lease_sha256);
    },
  );

  it("preserves a closed competing reservation without creating a worktree", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout: headOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const head = headOutput.trim();
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    const leaseFile = `.ephemeral/pr-432-${discoveryWorktreeDigest(canonical)}-lease.json`;
    const reservationFile = path.join(
      repository.physicalRepository,
      ".ephemeral/pr-432-session-create-reservation.json",
    );
    const reservation = {
      schema: "pr-review/session-create-reservation/v1",
      invocation_token: "foreign-creator-token",
      repository: "owner/repo",
      pr_number: 432,
      primary_repository_root: repository.physicalRepository,
      common_git_directory: path.join(repository.physicalRepository, ".git"),
      canonical_worktree_path: canonical,
      immutable_head: head,
      lease_file: leaseFile,
      expected_lease_sha256: "a".repeat(64),
    };
    const reservationBytes = `${JSON.stringify(reservation)}\n`;
    await writeFile(reservationFile, reservationBytes);
    process.chdir(repository.physicalRepository);
    process.env.REPOSITORY = "owner/repo";
    process.env.PR_NUMBER = "432";
    process.env.PRIMARY_REPOSITORY_ROOT = repository.physicalRepository;
    process.env.HEAD_SHA = head;
    process.env.BASE_REF = "main";
    process.env.HEAD_REF = "topic";
    process.env.UPDATED_AT = "2026-07-31T00:00:00Z";

    const result = await runPrReviewLeasesCommand(["session-create"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: `${JSON.stringify({ schema: "pr-review/session-create/v1", outcome: "conflict", reason: "reservation-contended", observed_artifacts: ["reservation"] })}\n`,
      stderr: "",
    });
    expect(await readFile(reservationFile, "utf8")).toBe(reservationBytes);
    await expect(lstat(canonical)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the closed conflict envelope ordered for reservation contention", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const canonical = path.join(
      repository.physicalRepository,
      ".worktrees",
      "pr-432-review",
    );
    await writeFile(
      path.join(
        repository.physicalRepository,
        ".ephemeral/pr-432-session-create-reservation.json",
      ),
      `${JSON.stringify({ schema: "pr-review/session-create-reservation/v1", invocation_token: "other", repository: "owner/repo", pr_number: 432, primary_repository_root: repository.physicalRepository, common_git_directory: path.join(repository.physicalRepository, ".git"), canonical_worktree_path: canonical, immutable_head: stdout.trim(), lease_file: `.ephemeral/pr-432-${discoveryWorktreeDigest(canonical)}-lease.json`, expected_lease_sha256: "b".repeat(64) })}\n`,
    );
    process.chdir(repository.physicalRepository);
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: repository.physicalRepository,
      HEAD_SHA: stdout.trim(),
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
    });
    const result = await runPrReviewLeasesCommand(["session-create"]);
    expect(Object.keys(JSON.parse(result.stdout))).toEqual([
      "schema",
      "outcome",
      "reason",
      "observed_artifacts",
    ]);
  });

  it("retains malformed reservation evidence for manual cleanup", async () => {
    const repository = await commandHarness.createReviewRepository();
    const { stdout: headOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const head = headOutput.trim();
    const reservationFile = path.join(
      repository.physicalRepository,
      ".ephemeral/pr-432-session-create-reservation.json",
    );
    await writeFile(reservationFile, "{\n");
    process.chdir(repository.physicalRepository);
    process.env.REPOSITORY = "owner/repo";
    process.env.PR_NUMBER = "432";
    process.env.PRIMARY_REPOSITORY_ROOT = repository.physicalRepository;
    process.env.HEAD_SHA = head;
    process.env.BASE_REF = "main";
    process.env.HEAD_REF = "topic";
    process.env.UPDATED_AT = "2026-07-31T00:00:00Z";

    const result = await runPrReviewLeasesCommand(["session-create"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "pr-review/session-create/v1",
      outcome: "manual-cleanup",
      canonical_worktree_path: path.join(
        repository.physicalRepository,
        ".worktrees",
        "pr-432-review",
      ),
      registration_identity: null,
      lease_sha256: null,
      observed_artifacts: ["reservation"],
      reason: "reservation-unverifiable",
    });
    expect(await readFile(reservationFile, "utf8")).toBe("{\n");
  });

  it("plans create, resume, and unleased-canonical cleanup without mutation", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const create = await discoverPrReviewSession();
      expect(Object.keys(create)).toEqual([
        "schema",
        "repository",
        "pr_number",
        "primary_repository_root",
        "canonical_worktree_path",
        "canonical_worktree_present",
        "active",
        "archived_lease_files",
        "disposition",
        "resume",
      ]);
      expect(create).toMatchObject({
        disposition: "create",
        active: [],
        resume: null,
      });

      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      process.env.LEASE_FILE = pathResult.stdout.trim();
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-07-30T00:00:00Z",
      });
      const archivedLeaseFile =
        ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-posted-archived-lease.json";
      await writeFile(
        path.join(workspace.physicalPrimary, archivedLeaseFile),
        "{}\n",
      );

      const leaseBeforeDiscovery = await readFile(
        path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
        "utf8",
      );
      const resume = await discoverPrReviewSession();
      expect(resume).toMatchObject({
        disposition: "resume",
        archived_lease_files: [archivedLeaseFile],
        active: [
          {
            lease_file: process.env.LEASE_FILE,
            worktree_path: workspace.physicalWorktree,
            state: "created",
            classification: "resumable",
            worktree_dirty: false,
            unmanaged_ephemeral_artifacts: false,
          },
        ],
        resume: {
          lease_file: process.env.LEASE_FILE,
          worktree_path: workspace.physicalWorktree,
        },
      });
      await expect(
        readFile(
          path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
          "utf8",
        ),
      ).resolves.toBe(leaseBeforeDiscovery);

      await removePath(
        path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
      );
      await mkdir(
        path.join(workspace.physicalPrimary, ".worktrees", "pr-432-review"),
        { recursive: true },
      );

      const cleanup = await discoverPrReviewSession();
      expect(cleanup).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree_present: true,
        active: [],
        resume: null,
      });

      const canonicalWorktree = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );
      await removePath(canonicalWorktree, { recursive: true, force: true });
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "add",
        "-b",
        "canonical-missing",
        canonicalWorktree,
        "HEAD",
      ]);
      await removePath(canonicalWorktree, { recursive: true, force: true });

      const registeredMissingCanonical = await discoverPrReviewSession();
      expect(registeredMissingCanonical).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree_present: false,
        active: [],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks dirty and unmanaged registered candidates without mutating leases", async () => {
    for (const observation of ["dirty", "unmanaged"] as const) {
      const workspace = await makeRegisteredWorkspace(
        `pr-review-discovery-${observation}-`,
      );
      try {
        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
        expect(pathResult.exitCode, pathResult.stderr).toBe(0);
        process.env.LEASE_FILE = pathResult.stdout.trim();
        await writeLeaseCommandState({
          state: "created",
          updatedAt: "2026-07-30T00:00:00Z",
        });
        if (observation === "dirty") {
          await writeFile(
            path.join(workspace.physicalWorktree, "uncommitted.txt"),
            "dirty\n",
          );
        } else {
          await writeFile(
            path.join(workspace.physicalPrimary, ".git", "info", "exclude"),
            ".ephemeral/\n",
          );
          await writeFile(
            path.join(workspace.physicalWorktree, ".ephemeral", "extra.json"),
            "{}\n",
          );
        }
        const leaseBeforeDiscovery = await readFile(
          path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
          "utf8",
        );

        const discovery = await discoverPrReviewSession();
        expect(discovery).toMatchObject({
          disposition: "cleanup-required",
          resume: null,
          active: [
            {
              classification: "resumable",
              worktree_dirty: observation === "dirty",
              unmanaged_ephemeral_artifacts: observation === "unmanaged",
            },
          ],
        });
        await expect(
          readFile(
            path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
            "utf8",
          ),
        ).resolves.toBe(leaseBeforeDiscovery);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("reports null observations for missing candidates without mutating leases", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-missing-",
    );
    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      process.env.LEASE_FILE = pathResult.stdout.trim();
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-07-30T00:00:00Z",
      });
      const leaseBeforeDiscovery = await readFile(
        path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
        "utf8",
      );
      await removePath(workspace.physicalWorktree, {
        recursive: true,
        force: true,
      });

      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({
        disposition: "cleanup-required",
        resume: null,
        active: [
          {
            classification: "missing",
            worktree_dirty: null,
            unmanaged_ephemeral_artifacts: null,
          },
        ],
      });
      await expect(
        readFile(
          path.join(workspace.physicalPrimary, process.env.LEASE_FILE ?? ""),
          "utf8",
        ),
      ).resolves.toBe(leaseBeforeDiscovery);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when a lease worktree path cannot be resolved", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-loop-",
    );
    try {
      const loopPath = path.join(workspace.tempRoot, "worktree-loop");
      await symlink(loopPath, loopPath, "dir");
      const worktreeDigest = createHash("sha256")
        .update(loopPath)
        .digest("hex");
      const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
      const lease = abortedCommandLease(leaseFile, loopPath, worktreeDigest);
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        `${JSON.stringify(lease)}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = leaseFile;

      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "invalid",
        resume: null,
        active: [
          {
            lease_file: leaseFile,
            classification: "invalid",
            worktree_path: null,
          },
        ],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("invalidates relative and physical-alias stored worktree paths", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-alias-",
    );
    try {
      const aliasPath = path.join(workspace.tempRoot, "worktree-alias");
      await symlink(workspace.physicalWorktree, aliasPath, "dir");
      const storedPaths = [
        path.relative(workspace.physicalPrimary, workspace.physicalWorktree),
        aliasPath,
      ];
      for (const storedPath of storedPaths) {
        const worktreeDigest = discoveryWorktreeDigest(storedPath);
        const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
        await writeFile(
          path.join(workspace.physicalPrimary, leaseFile),
          `${JSON.stringify(
            abortedCommandLease(leaseFile, storedPath, worktreeDigest),
          )}\n`,
        );
      }
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({
        disposition: "invalid",
        resume: null,
      });
      expect(discovery.active).toHaveLength(2);
      expect(discovery.active.map((entry) => entry.classification)).toEqual([
        "invalid",
        "invalid",
      ]);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("physicalizes missing paths and rejects lexical or symlink-parent aliases", async () => {
    const workspace = await makeRegisteredWorkspace(
      "pr-review-discovery-missing-identity-",
    );
    try {
      const physicalRoot = await realpath(workspace.tempRoot);
      const linkedParent = path.join(physicalRoot, "linked-parent");
      await symlink(physicalRoot, linkedParent, "dir");
      const danglingParent = path.join(physicalRoot, "dangling-parent");
      await symlink(
        path.join(physicalRoot, "missing-target"),
        danglingParent,
        "dir",
      );
      const regularParent = path.join(physicalRoot, "not-a-directory");
      await writeFile(regularParent, "not a directory\n");
      const storedPaths = [
        path.join(physicalRoot, "physical-missing"),
        `${path.join(physicalRoot, "lexical-parent")}${path.sep}..${path.sep}lexical-missing`,
        path.join(linkedParent, "symlink-parent-missing"),
        path.join(danglingParent, "missing"),
        path.join(regularParent, "missing"),
      ];
      for (const storedPath of storedPaths) {
        const worktreeDigest = discoveryWorktreeDigest(storedPath);
        const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
        await writeFile(
          path.join(workspace.physicalPrimary, leaseFile),
          `${JSON.stringify(
            abortedCommandLease(leaseFile, storedPath, worktreeDigest),
          )}\n`,
        );
      }
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({ disposition: "invalid", resume: null });
      expect(
        discovery.active.map((entry) => entry.classification).sort(),
      ).toEqual(["invalid", "invalid", "invalid", "invalid", "missing"]);
      expect(
        discovery.active.find((entry) => entry.classification === "missing"),
      ).toMatchObject({
        worktree_path: path.join(physicalRoot, "physical-missing"),
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("stops as ambiguous when canonical and noncanonical leases are resumable", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    const secondWorktree = path.join(workspace.tempRoot, "review-second");

    try {
      const canonicalWorktree = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );
      await mkdir(path.dirname(canonicalWorktree), { recursive: true });
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "move",
        workspace.physicalWorktree,
        canonicalWorktree,
      ]);
      const physicalCanonicalWorktree = await realpath(canonicalWorktree);
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "add",
        "-b",
        "review-second",
        secondWorktree,
      ]);
      const physicalSecondWorktree = await realpath(secondWorktree);
      process.chdir(workspace.physicalPrimary);

      for (const worktreePath of [
        physicalCanonicalWorktree,
        physicalSecondWorktree,
      ]) {
        setLeaseCommandEnv(workspace.physicalPrimary, worktreePath);
        const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
        expect(pathResult.exitCode, pathResult.stderr).toBe(0);
        process.env.LEASE_FILE = pathResult.stdout.trim();
        await writeLeaseCommandState({
          state: "created",
          updatedAt: "2026-07-30T00:00:00Z",
        });
      }

      setLeaseCommandEnv(workspace.physicalPrimary, physicalCanonicalWorktree);
      const discovery = await discoverPrReviewSession();
      expect(discovery).toMatchObject({
        disposition: "ambiguous",
        resume: null,
      });
      expect(discovery.active).toHaveLength(2);
      expect(discovery.active.map((entry) => entry.classification)).toEqual([
        "resumable",
        "resumable",
      ]);

      await writeFile(
        path.join(physicalCanonicalWorktree, "uncommitted.txt"),
        "dirty\n",
      );
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        resume: null,
      });
      await removePath(path.join(physicalCanonicalWorktree, "uncommitted.txt"));
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "ambiguous",
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("allows a canonical helper-recorded removed terminal lease to reenter through LC-18", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    try {
      const physicalCanonicalParent = path.join(
        workspace.tempRoot,
        "canonical-parent",
      );
      const linkedCanonicalParent = path.join(
        workspace.physicalPrimary,
        ".worktrees",
      );
      await mkdir(physicalCanonicalParent, { recursive: true });
      await symlink(physicalCanonicalParent, linkedCanonicalParent, "dir");
      const canonicalWorktree = path.join(
        linkedCanonicalParent,
        "pr-432-review",
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "move",
        workspace.physicalWorktree,
        canonicalWorktree,
      ]);
      const physicalCanonicalWorktree = await realpath(canonicalWorktree);
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, physicalCanonicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamic = identityFromLeaseFile(
        leaseFile,
        physicalCanonicalWorktree,
      );
      const terminal = abortedCommandLease(
        leaseFile,
        physicalCanonicalWorktree,
        dynamic.worktreeDigest,
      );
      terminal.cleanup = {
        last_outcome: "skipped",
        last_checked_at: "2026-07-30T00:01:00Z",
        removed_at: "2026-07-30T00:01:00Z",
      };
      const terminalContent = `${JSON.stringify(terminal)}\n`;
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        terminalContent,
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "remove",
        "-f",
        physicalCanonicalWorktree,
      ]);
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "create",
        canonical_worktree_path: physicalCanonicalWorktree,
        active: [
          {
            lease_file: leaseFile,
            worktree_path: physicalCanonicalWorktree,
            state: "aborted",
            classification: "reentry",
          },
        ],
        resume: null,
      });

      const archiveFile = `.ephemeral/pr-432-${dynamic.worktreeDigest}-20260611T000100-aborted-archived-lease.json`;
      const archivePath = path.join(workspace.physicalPrimary, archiveFile);
      await writeFile(archivePath, terminalContent);
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "create",
        active: [
          {
            lease_file: leaseFile,
            classification: "reentry",
          },
        ],
        resume: null,
      });
      await writeFile(archivePath, '{"divergent":true}\n');
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        active: [
          {
            lease_file: leaseFile,
            classification: "missing",
          },
        ],
        resume: null,
      });
      await removePath(archivePath);
      await symlink(
        path.join(workspace.tempRoot, "missing-archive"),
        archivePath,
      );
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "invalid",
        active: [
          {
            lease_file: leaseFile,
            classification: "invalid",
          },
        ],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks a registered missing canonical terminal lease before LC-18 reentry", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    try {
      const canonicalWorktree = path.join(
        workspace.physicalPrimary,
        ".worktrees",
        "pr-432-review",
      );
      await mkdir(path.dirname(canonicalWorktree), { recursive: true });
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "move",
        workspace.physicalWorktree,
        canonicalWorktree,
      ]);
      const physicalCanonicalWorktree = await realpath(canonicalWorktree);
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, physicalCanonicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamic = identityFromLeaseFile(
        leaseFile,
        physicalCanonicalWorktree,
      );
      const terminal = abortedCommandLease(
        leaseFile,
        physicalCanonicalWorktree,
        dynamic.worktreeDigest,
      );
      terminal.cleanup = {
        last_outcome: "removed",
        last_checked_at: "2026-07-30T00:01:00Z",
        removed_at: "2026-07-30T00:01:00Z",
      };
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        `${JSON.stringify(terminal)}\n`,
      );
      await removePath(physicalCanonicalWorktree, {
        recursive: true,
        force: true,
      });

      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        canonical_worktree_path: physicalCanonicalWorktree,
        canonical_worktree_present: false,
        active: [
          {
            lease_file: leaseFile,
            classification: "reentry",
          },
        ],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks a noncanonical helper-recorded removed terminal lease", async () => {
    const workspace = await makeRegisteredWorkspace("pr-review-discovery-");
    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode, pathResult.stderr).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamic = identityFromLeaseFile(
        leaseFile,
        workspace.physicalWorktree,
      );
      const terminal = abortedCommandLease(
        leaseFile,
        workspace.physicalWorktree,
        dynamic.worktreeDigest,
      );
      terminal.cleanup = {
        last_outcome: "removed",
        last_checked_at: "2026-07-30T00:01:00Z",
        removed_at: "2026-07-30T00:01:00Z",
      };
      await writeFile(
        path.join(workspace.physicalPrimary, leaseFile),
        `${JSON.stringify(terminal)}\n`,
      );
      await execFileAsync("git", [
        "-C",
        workspace.physicalPrimary,
        "worktree",
        "remove",
        "-f",
        workspace.physicalWorktree,
      ]);
      expect(await discoverPrReviewSession()).toMatchObject({
        disposition: "cleanup-required",
        active: [
          {
            lease_file: leaseFile,
            worktree_path: workspace.physicalWorktree,
            state: "aborted",
            classification: "missing",
          },
        ],
        resume: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("writes result sha256 and same-cycle validation timestamps for every preview presentation", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const firstDigest = await sha256File(path.join(worktree, resultFile));

      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const firstGate = await readLease(primary, leaseFile);
      expect(firstGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: firstDigest,
      });
      expect(firstGate.validation.result_manifest.validated_at).toBe(
        firstGate.updated_at,
      );

      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "edited",
      );
      const secondDigest = await sha256File(path.join(worktree, resultFile));
      expect(secondDigest).not.toBe(firstDigest);
      process.env.PRESENTED_AT = "2026-06-11T00:03:00Z";
      process.env.PRESENTATION_STATUS = "edited";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:03:00Z",
      });
      const secondGate = await readLease(primary, leaseFile);
      expect(secondGate.artifacts.result_file).toBe(resultFile);
      expect(secondGate.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:03:00Z",
        sha256: secondDigest,
      });
      expect(secondGate.validation.result_manifest.validated_at).toBe(
        secondGate.updated_at,
      );
      expect(secondGate.presentation.status).toBe("edited");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy validation shapes without rewriting or migrating them", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-legacy-validation-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const validLease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      const cases: Array<{
        name: string;
        lease: unknown;
        stderr: string;
      }> = [
        {
          name: "missing-validation",
          lease: omitKey(validLease, "validation"),
          stderr: "lease validation metadata missing",
        },
        {
          name: "missing-result-manifest",
          lease: {
            ...validLease,
            validation: {},
          },
          stderr: "lease result_manifest metadata missing",
        },
        {
          name: "missing-digest",
          lease: {
            ...validLease,
            validation: {
              result_manifest: {
                status: "valid",
                validated_at: "2026-06-11T00:01:00Z",
              },
            },
          },
          stderr: "result manifest digest missing",
        },
      ];

      for (const testCase of cases) {
        await writeFile(
          path.join(primary, leaseFile),
          `${JSON.stringify(testCase.lease, null, 2)}\n`,
        );
        const before = await readFile(path.join(primary, leaseFile), "utf8");

        process.env.LEASE_FILE = leaseFile;
        let result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        result = await runPrReviewLeasesCommand(["inspect-worktree"]);
        expect(result.exitCode, testCase.name).toBe(0);
        expect(result.stdout, testCase.name).toContain(
          "REFUSAL_REASON=invalid-lease",
        );
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);

        process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
        process.env.PRESENTATION_STATUS = "preview-current";
        process.env.RESULT_FILE = resultFile;
        process.env.STATE = "gated";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
        result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
        await expect(
          readFile(path.join(primary, leaseFile), "utf8"),
        ).resolves.toBe(before);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid result paths before hashing lifecycle write inputs", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-result-path-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const before = await readFile(path.join(primary, leaseFile), "utf8");
      await writeFile(
        path.join(tempRoot, "outside-result.json"),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );

      process.env.RESULT_FILE = "../outside-result.json";
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("path traversal: ../outside-result.json");
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes a digest when advancing valid reviewed leases to gated", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-valid-digest-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
            resultFile,
            await sha256File(path.join(worktree, resultFile)),
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const lease = await readLease(primary, leaseFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        await sha256File(path.join(worktree, resultFile)),
      );
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts initial not-presented results for reviewed leases without making them live status", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-not-presented-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      const { findingsFile } = await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      const resultSha256 = await sha256File(path.join(worktree, resultFile));
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });

      process.env.RESULT_FILE = resultFile;
      // Usage partitions presentation inputs; lifecycle allows operation-only
      // retry without rerunning semantic review or rewriting its evidence.
      process.env.STATE = "reviewed";
      process.env.PRESENTATION_STATUS = "not-presented";
      process.env.PRESENTED_AT = "unrelated result input";
      process.env.UPDATED_AT = "2026-02-30T00:01:00Z";
      const resultBefore = await readFile(
        path.join(worktree, resultFile),
        "utf8",
      );
      const findingsBefore = await readFile(
        path.join(worktree, findingsFile),
        "utf8",
      );
      const leaseBefore = await readFile(path.join(primary, leaseFile), "utf8");
      const refused = await runPrReviewLeasesCommand(["write"]);
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("UTC RFC3339");
      expect(await readFile(path.join(primary, leaseFile), "utf8")).toBe(
        leaseBefore,
      );
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      expect(await readFile(path.join(worktree, resultFile), "utf8")).toBe(
        resultBefore,
      );
      expect(await readFile(path.join(worktree, findingsFile), "utf8")).toBe(
        findingsBefore,
      );
      process.env.STATE = "gated";
      const gatedRefusal = await runPrReviewLeasesCommand(["write"]);
      expect(gatedRefusal.exitCode).toBe(1);
      expect(gatedRefusal.stderr).toContain("presentation status");

      const reviewed = await readLease(primary, leaseFile);
      expect(reviewed).toMatchObject({
        state: "reviewed",
        artifacts: { result_file: resultFile },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:01:00Z",
            sha256: resultSha256,
          },
        },
        presentation: { presented_at: null, status: null },
      });

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);

      process.env.HEAD_SHA = reviewHead;
      result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("read-status requires gated lease");

      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.TERMINAL_REASON = "not posting";
      await writeLeaseCommandState({
        state: "aborted",
        updatedAt: "2026-06-11T00:02:00Z",
      });

      const aborted = await readLease(primary, leaseFile);
      expect(aborted).toMatchObject({
        state: "aborted",
        artifacts: { result_file: resultFile },
        presentation: { presented_at: null, status: null },
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode, result.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift before fresh reviewed and gated writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-fresh-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);

      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await rm(path.join(workspace.primary, leaseFile), { force: true });
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      const createdBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );

      await mutateNestedFindingsWithoutUpdatingResult(workspace);
      process.env.RESULT_FILE = workspace.resultFile;
      process.env.STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:01:00Z";
      process.env.PR_REVIEW_DIR = workspace.prReviewDir;
      process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
        workspace.prReviewManifestHelperScript;
      process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
        workspace.prReviewLeaseHelperScript;
      process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(createdBefore);

      await writeFile(
        path.join(workspace.primary, leaseFile),
        `${JSON.stringify(
          reviewedCommandLease(
            leaseFile,
            workspace.physicalWorktree,
            identityFromLeaseFile(leaseFile, workspace.physicalWorktree)
              .worktreeDigest,
            workspace.resultFile,
            workspace.resultSha256,
          ),
          null,
          2,
        )}\n`,
      );
      const reviewedBefore = await readFile(
        path.join(workspace.primary, leaseFile),
        "utf8",
      );
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      process.env.STATE = "gated";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, leaseFile), "utf8"),
      ).resolves.toBe(reviewedBefore);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed closed cleanup metadata", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-shape-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      for (const cleanup of [
        {
          last_outcome: "unknown",
          last_checked_at: null,
          removed_at: null,
        },
        {
          last_outcome: "removed",
          last_checked_at: "not-a-timestamp",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-02-30T00:00:00Z",
          removed_at: "2026-06-11T00:03:00Z",
        },
        {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:03:00Z",
          removed_at: "2026-06-11T00:03:00Z",
          unexpected: true,
        },
      ]) {
        const lease = await readLease(workspace.primary, workspace.leaseFile);
        lease.cleanup = cleanup as PrReviewLease["cleanup"];
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(lease, null, 2)}\n`,
        );
        const result = await runPrReviewLeasesCommand(["validate"]);
        expect(result.exitCode).toBe(1);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid strict failure evidence instead of rejecting failed writes", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        workspace.reviewHead,
      );
      await writeValidatedPayloadArtifact(
        workspace.worktree,
        workspace.reviewHead,
      );
      const beforeFailure = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failedAfterDrift = await readLease(
        workspace.primary,
        workspace.leaseFile,
      );
      expect(failedAfterDrift.state).toBe("failed");
      expect(failedAfterDrift.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failedAfterDrift.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failedAfterDrift.failure).toEqual({
        phase: "github-post",
        reason: "GitHub API rejected review",
        recoverability: "recoverable",
      });
      expect(failedAfterDrift.github).toEqual({
        github_post_attempted: true,
        github_post_result: "failed",
        github_posted_at: null,
      });

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(
          {
            ...JSON.parse(beforeFailure),
            state: "failed",
            updated_at: "2026-06-11T00:03:00Z",
            artifacts: {
              ...JSON.parse(beforeFailure).artifacts,
              approved_review_file: process.env.APPROVED_REVIEW_FILE,
              validated_payload_file: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
            },
            terminal: {
              finished_at: "2026-06-11T00:03:00Z",
              reason: null,
            },
            failure: {
              phase: "github-post",
              reason: "GitHub API rejected review",
              recoverability: "recoverable",
            },
            github: {
              github_post_attempted: true,
              github_post_result: "failed",
              github_posted_at: null,
            },
          },
          null,
          2,
        )}\n`,
      );
      const beforePosted = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:04:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("findings digest mismatch");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(beforePosted);

      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failedAfterDrift, null, 2)}\n`,
      );
      process.env.STATE = "posted";
      process.env.EXPECTED_STATE = "failed";
      process.env.UPDATED_AT = "2026-06-11T00:05:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:05:00Z";
      process.env.GITHUB_POSTED_AT = "2026-06-11T00:05:00Z";
      unsetEnv("FAILURE_PHASE");
      unsetEnv("FAILURE_REASON");
      unsetEnv("FAILURE_RECOVERABILITY");
      unsetEnv("GITHUB_POST_ATTEMPTED");
      unsetEnv("GITHUB_POST_RESULT");

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "APPROVED_REVIEW_FILE must match existing failed approved-review",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid approval-freeze evidence while recording failed", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-approval-freeze-invalid-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "approval-freeze";
      process.env.FAILURE_REASON = "approved review validation failed";
      process.env.APPROVED_REVIEW_FILE = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        process.env.APPROVED_REVIEW_FILE,
        "2222222222222222222222222222222222222222",
      );

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.state).toBe("failed");
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: workspace.resultFile,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
      expect(failed.failure).toEqual({
        phase: "approval-freeze",
        reason: "approved review validation failed",
        recoverability: "recoverable",
      });
      expect(failed.github).toEqual({
        github_post_attempted: false,
        github_post_result: "not-attempted",
        github_posted_at: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace("pr-review-handoff-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: handoffFile,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("clears invalid handoff-only evidence when a created lease records failure", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
    } = await makeResultAuthorityWorkspace(
      "pr-review-invalid-handoff-failure-",
    );
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "not-presented",
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      process.env.HANDOFF_FILE = handoffFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      const handoffPath = path.join(worktree, handoffFile);
      const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
      await writeFile(
        handoffPath,
        `${JSON.stringify({ ...handoff, repository: "other/repo" }, null, 2)}\n`,
      );

      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:02:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:02:00Z";
      process.env.FAILURE_PHASE = "review";
      process.env.FAILURE_REASON = "review failed before result";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      unsetEnv("RESULT_FILE");

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects stale or missing result digests during validate and cleanup classification", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-digest-",
    );

    try {
      setReadStatusEnv(workspace);
      await writeFile(
        path.join(workspace.worktree, workspace.resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: workspace.reviewHead,
          presentation: { status: "preview-current" },
          stale: true,
        })}\n`,
      );

      let result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");

      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });

      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result manifest digest missing");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects terminal stored presentation evidence that mismatches the result", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-terminal-presentation-mismatch-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      await mutateLease(workspace, (lease) => {
        expect(lease.state).toBe("failed");
        lease.presentation.status = "edited";
      });

      setReadStatusEnv(workspace);
      result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("presentation status mismatch");

      result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects lease ref mismatch against result handoff evidence during validate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-validate-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.base_ref = "release";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff base ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed instead of overwriting malformed existing leases", async () => {
    const tempRoot = await commandHarness.createScratchRoot();
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      await writeFile(path.join(primary, leaseFile), "{not json\n");

      process.env.LEASE_FILE = leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:00:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:00:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      await expect(
        readFile(path.join(primary, leaseFile), "utf8"),
      ).resolves.toBe("{not json\n");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects legacy reviewed lease/v1 result pointers without validation metadata", async () => {
    const tempRoot = await commandHarness.createScratchRoot();
    const primary = path.join(tempRoot, "primary");
    const worktree = path.join(tempRoot, "worktree");
    await mkdir(path.join(primary, ".ephemeral"), { recursive: true });
    await mkdir(path.join(worktree, ".ephemeral"), { recursive: true });
    const physicalPrimary = await realpath(primary);
    const physicalWorktree = await realpath(worktree);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const resultFile = ".ephemeral/pr-432-result.json";
      await writeFile(
        path.join(worktree, resultFile),
        `${JSON.stringify({
          repository: "owner/repo",
          pr_number: 432,
          review_head_sha: "1111111111111111111111111111111111111111",
        })}\n`,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "reviewed",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: physicalWorktree,
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: resultFile,
            approved_review_file: null,
            validated_payload_file: null,
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("lease validation metadata missing");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unknown JSON lease states before state-invariant checks", async () => {
    const { tempRoot, primary, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-unknown-state-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify({
          schema: "pr-review/lease/v1",
          repository: "owner/repo",
          pr_number: 432,
          state: "postd",
          base_ref: "main",
          head_ref: "topic",
          worktree_path: physicalWorktree,
          worktree_digest: dynamicIdentity.worktreeDigest,
          lease_file: leaseFile,
          created_at: "2026-06-11T00:00:00Z",
          updated_at: "2026-06-11T00:01:00Z",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
          validation: {
            result_manifest: { status: null, validated_at: null, sha256: null },
          },
          presentation: { presented_at: null, status: null },
          terminal: { finished_at: null, reason: null },
          failure: { phase: null, reason: null, recoverability: null },
          github: {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
        })}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown lease state: postd");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects approved reviews from a different result manifest head", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-approved-head-");
    const resultHead = "1111111111111111111111111111111111111111";
    const approvedHead = "2222222222222222222222222222222222222222";
    const resultFile = `.ephemeral/pr-432-${resultHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${approvedHead}-approved-review.json`;

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        resultHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        approvedHead,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile: `.ephemeral/pr-432-${approvedHead}-validated-review-payload.json`,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("approved review result head mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects non-deterministic validated payload paths", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeLeaseWorkspace("pr-review-payload-path-");
    const reviewHead = "1111111111111111111111111111111111111111";
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const approvedReviewFile = `.ephemeral/topic-${reviewHead}-approved-review.json`;
    const validatedPayloadFile =
      ".ephemeral/copied-validated-review-payload.json";

    try {
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
      );
      await writeApprovedReviewArtifact(
        worktree,
        approvedReviewFile,
        reviewHead,
      );
      await writeFile(
        path.join(worktree, validatedPayloadFile),
        `${JSON.stringify(reviewPayload(reviewHead))}\n`,
      );
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          postedCommandLease({
            leaseFile,
            worktreePath: physicalWorktree,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(worktree, resultFile)),
            approvedReviewFile,
            validatedPayloadFile,
          }),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["validate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("validated payload path mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses posted leases missing the validated payload before cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-posted-missing-payload-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("CAN_REMOVE=yes");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts a complete validated posted chain for cleanup ownership", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-complete-posted-chain-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
    const validatedPayloadFile = await writeValidatedPayloadArtifact(
      workspace.worktree,
      workspace.reviewHead,
    );

    try {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile,
        validatedPayloadFile,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );

      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["validate"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  // Lifecycle chronology owns this observation: truncating the runtime clock
  // falsely places cleanup before an earlier fractional terminal in one second.
  it("records cleanup observation after a fractional terminal in the same second", async () => {
    const workspace = await makeRegisteredWorkspace("cleanup-fraction-clock-");
    try {
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      const derived = await runPrReviewLeasesCommand(["derive-path"]);
      const leaseFile = derived.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      const dynamic = identityFromLeaseFile(
        leaseFile,
        workspace.physicalWorktree,
      );
      const terminal = abortedCommandLease(
        leaseFile,
        workspace.physicalWorktree,
        dynamic.worktreeDigest,
      );
      terminal.terminal.finished_at = "2026-10-06T00:00:00.1234567Z";
      await writeFile(
        path.join(workspace.primary, leaseFile),
        `${JSON.stringify(terminal)}\n`,
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-06T00:00:00.456Z"));
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      const observed = await readLease(workspace.primary, leaseFile);
      expect(observed.cleanup?.last_checked_at).toBe(
        "2026-10-06T00:00:00.456Z",
      );
    } finally {
      vi.useRealTimers();
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts inclusive terminal cleanup chronology for posted and aborted leases", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-cleanup-chronology-equality-`,
      );

      try {
        const terminal =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : abortedCommandLease(
                workspace.leaseFile,
                workspace.physicalWorktree,
                workspace.worktreeDigest,
              );
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            terminal.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        for (const [finishedAt, checkedAt, removedAt] of [
          [
            "2026-10-06T00:00:00.1234567Z",
            "2026-10-06T00:00:00.1234568Z",
            "2026-10-06T00:00:00.1234567Z",
          ],
          [
            "2026-10-06T00:00:00.1234567Z",
            "2026-10-06T00:00:00.1234567Z",
            "2026-10-06T00:00:00.1234567Z",
          ],
          [
            "2026-10-06T00:00:00Z",
            "2026-10-06T00:00:00.0000Z",
            "2026-10-06T00:00:00.0Z",
          ],
        ]) {
          terminal.terminal.finished_at = finishedAt;
          terminal.cleanup = {
            last_outcome: "removed",
            last_checked_at: checkedAt,
            removed_at: removedAt,
          };
          await writeFile(
            path.join(workspace.primary, workspace.leaseFile),
            `${JSON.stringify(terminal, null, 2)}\n`,
          );
          const result = await runPrReviewLeasesCommand(["validate"]);
          expect(result.exitCode, `${state}: ${result.stderr}`).toBe(0);
          expect(
            (await readLease(workspace.primary, workspace.leaseFile)).terminal
              .finished_at,
          ).toBe(finishedAt);
        }
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("rejects each contradictory terminal cleanup timestamp without rewriting the lease", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-cleanup-chronology-invalid-`,
      );

      try {
        const terminal =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : abortedCommandLease(
                workspace.leaseFile,
                workspace.physicalWorktree,
                workspace.worktreeDigest,
              );
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            terminal.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        const finishedAt = "2026-10-06T00:00:00.1234567Z";
        terminal.terminal.finished_at = finishedAt;
        const invalidCleanup = [
          {
            cleanup: {
              last_outcome: "removed" as const,
              last_checked_at: finishedAt,
              removed_at: "2026-10-06T00:00:00.1234566Z",
            },
            error: "cleanup.removed_at cannot precede terminal.finished_at",
          },
          {
            cleanup: {
              last_outcome: "retained" as const,
              last_checked_at: "2026-10-06T00:00:00.1234566Z",
              removed_at: null,
            },
            error:
              "cleanup.last_checked_at cannot precede terminal.finished_at",
          },
          {
            cleanup: {
              last_outcome: "removed" as const,
              last_checked_at: finishedAt,
              removed_at: "2026-10-06T00:00:00.1234568Z",
            },
            error: "cleanup.removed_at cannot follow cleanup.last_checked_at",
          },
          {
            cleanup: {
              last_outcome: "retained" as const,
              last_checked_at: "2026-06-11T00:00:00Z",
              removed_at: null,
            },
            error:
              "cleanup.last_checked_at cannot precede terminal.finished_at",
          },
          {
            cleanup: {
              last_outcome: "removed" as const,
              last_checked_at: null,
              removed_at: finishedAt,
            },
            error: "cleanup.removed_at requires cleanup.last_checked_at",
          },
          {
            cleanup: {
              last_outcome: "removed" as const,
              last_checked_at: "2026-10-06T00:04:00Z",
              removed_at: "2026-06-11T00:00:00Z",
            },
            error: "cleanup.removed_at cannot precede terminal.finished_at",
          },
          {
            cleanup: {
              last_outcome: "removed" as const,
              last_checked_at: "2026-10-06T00:04:00Z",
              removed_at: "2026-10-06T00:05:00Z",
            },
            error: "cleanup.removed_at cannot follow cleanup.last_checked_at",
          },
        ];

        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        for (const { cleanup, error } of invalidCleanup) {
          terminal.cleanup = cleanup;
          await writeFile(
            path.join(workspace.primary, workspace.leaseFile),
            `${JSON.stringify(terminal, null, 2)}\n`,
          );
          const before = await readFile(
            path.join(workspace.primary, workspace.leaseFile),
            "utf8",
          );

          const result = await runPrReviewLeasesCommand(["validate"]);
          expect(result.exitCode, `${state}: ${error}`).toBe(1);
          expect(result.stderr, `${state}: ${error}`).toContain(error);
          await expect(
            readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
          ).resolves.toBe(before);
        }
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });
});

describe("pr-review lease read-status", () => {
  it("emits the exact status envelope without cleanup fields or lease mutation", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      const result = await runPrReviewLeasesCommand(["read-status"]);
      const after = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      expect(result.exitCode).toBe(0);
      expect(after).toBe(before);
      const status = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(Object.keys(status)).toEqual([
        "lease_state",
        "worktree_path",
        "worktree_digest",
        "worktree_exists",
        "worktree_registered",
        "worktree_dirty",
        "identity_match",
        "result_file",
        "result_sha256",
        "result_validated_at",
        "lease_updated_at",
        "presentation_status",
        "presented_at",
      ]);
      expect(status).toMatchObject({
        lease_state: "gated",
        worktree_path: workspace.physicalWorktree,
        worktree_digest: workspace.worktreeDigest,
        worktree_exists: true,
        worktree_registered: true,
        identity_match: true,
        result_file: workspace.resultFile,
        result_sha256: workspace.resultSha256,
        result_validated_at: "2026-06-11T00:02:00Z",
        lease_updated_at: "2026-06-11T00:02:00Z",
        presentation_status: "preview-current",
        presented_at: "2026-06-11T00:02:00Z",
      });
      expect(typeof status.worktree_dirty).toBe("boolean");
      for (const forbidden of [
        "can_remove",
        "force_remove_allowed",
        "refusal_reason",
        "requires_confirmation",
        "metadata_outcome",
      ]) {
        expect(status).not.toHaveProperty(forbidden);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("uses a fresh root-bound authority context for each Phase 6 status gate", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-validation-reuse-",
    );
    const scopeValidationLog = path.join(
      workspace.tempRoot,
      "scope-validation.log",
    );
    const helpers = await writeCountingReviewHelperScripts(
      workspace.tempRoot,
      scopeValidationLog,
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      setHelperAuthorityEnv(helpers);

      await expect(
        runPrReviewLeasesCommand(["read-status"]),
      ).resolves.toMatchObject({
        exitCode: 0,
      });
      await expect(readFile(scopeValidationLog, "utf8")).resolves.toBe(
        "validate-scope-decision\n",
      );

      await expect(
        runPrReviewLeasesCommand(["read-status"]),
      ).resolves.toMatchObject({
        exitCode: 0,
      });
      await expect(readFile(scopeValidationLog, "utf8")).resolves.toBe(
        "validate-scope-decision\nvalidate-scope-decision\n",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("inspects worktree dirtiness with optional git locks disabled", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-locks-");

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const traceFile = path.join(workspace.tempRoot, "git-trace2.jsonl");
      const originalTrace = process.env.GIT_TRACE2_EVENT;
      process.env.GIT_TRACE2_EVENT = traceFile;
      try {
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, result.stderr).toBe(0);
      } finally {
        if (originalTrace === undefined) {
          unsetEnv("GIT_TRACE2_EVENT");
        } else {
          process.env.GIT_TRACE2_EVENT = originalTrace;
        }
      }

      const statusArgs = (await readFile(traceFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { event?: unknown; argv?: unknown })
        .filter(
          (event): event is { event: "start"; argv: string[] } =>
            event.event === "start" &&
            Array.isArray(event.argv) &&
            event.argv.every((value) => typeof value === "string"),
        )
        .map((event) => event.argv)
        .find((argv) => argv.includes("status"));
      expect(statusArgs).toBeDefined();
      if (statusArgs === undefined) {
        throw new Error("missing git status trace2 start event");
      }
      expect(statusArgs).toEqual(
        expect.arrayContaining([
          "--no-optional-locks",
          "-C",
          workspace.physicalWorktree,
          "status",
          "--porcelain",
        ]),
      );
      expect(statusArgs.indexOf("--no-optional-locks")).toBeLessThan(
        statusArgs.indexOf("status"),
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts dirty but valid registered worktrees as status", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-status-dirty-");

    try {
      await writeFile(path.join(workspace.worktree, "dirty.txt"), "dirty\n");
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        worktree_dirty: true,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when git status cannot inspect the worktree", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-git-failure-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const originalGitIndexFile = process.env.GIT_INDEX_FILE;
      process.env.GIT_INDEX_FILE = workspace.tempRoot;
      const result = await runPrReviewLeasesCommand(["read-status"]);
      if (originalGitIndexFile === undefined) {
        unsetEnv("GIT_INDEX_FILE");
      } else {
        process.env.GIT_INDEX_FILE = originalGitIndexFile;
      }
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("git status inspection failed");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for missing worktrees", async () => {
    const missing = await makeGatedStatusWorkspace("pr-review-status-missing-");
    try {
      process.chdir(missing.physicalPrimary);
      setReadStatusEnv(missing);
      await rm(missing.worktree, { recursive: true, force: true });
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
    } finally {
      process.chdir(originalCwd);
      await rm(missing.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for unregistered worktrees", async () => {
    const unregisteredBase = await makeRegisteredWorkspace(
      "pr-review-status-unregistered-",
    );
    try {
      const separate = path.join(unregisteredBase.tempRoot, "separate");
      await mkdir(path.join(separate, ".ephemeral"), { recursive: true });
      const physicalSeparate = await realpath(separate);
      process.chdir(unregisteredBase.physicalPrimary);
      setLeaseCommandEnv(unregisteredBase.physicalPrimary, physicalSeparate);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparate,
      );
      const resultFile =
        ".ephemeral/pr-432-1111111111111111111111111111111111111111-result.json";
      await writeResultArtifact(
        separate,
        physicalSeparate,
        resultFile,
        "1111111111111111111111111111111111111111",
        "preview-current",
      );
      await writeFile(
        path.join(unregisteredBase.primary, leaseFile),
        `${JSON.stringify(
          gatedCommandLease({
            leaseFile,
            worktreePath: physicalSeparate,
            worktreeDigest: dynamicIdentity.worktreeDigest,
            resultFile,
            resultSha256: await sha256File(path.join(separate, resultFile)),
          }),
          null,
          2,
        )}\n`,
      );
      process.env.LEASE_FILE = leaseFile;
      process.env.RESULT_FILE = resultFile;
      process.env.HEAD_SHA = "1111111111111111111111111111111111111111";
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("not registered");
    } finally {
      process.chdir(originalCwd);
      await rm(unregisteredBase.tempRoot, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "fails closed for unreadable worktrees where chmod permissions are enforced",
    async () => {
      const unreadable = await makeGatedStatusWorkspace(
        "pr-review-status-unreadable-",
      );
      try {
        process.chdir(unreadable.physicalPrimary);
        setReadStatusEnv(unreadable);
        await chmod(unreadable.worktree, 0);
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      } finally {
        await chmod(unreadable.worktree, 0o755).catch(() => undefined);
        process.chdir(originalCwd);
        await rm(unreadable.tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("fails closed for identity-mismatched worktrees", async () => {
    const mismatch = await makeGatedStatusWorkspace(
      "pr-review-status-mismatch-",
    );
    try {
      const lease = await readLease(mismatch.primary, mismatch.leaseFile);
      await writeFile(
        path.join(mismatch.primary, mismatch.leaseFile),
        `${JSON.stringify({ ...lease, repository: "other/repo" }, null, 2)}\n`,
      );
      process.chdir(mismatch.physicalPrimary);
      setReadStatusEnv(mismatch);
      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result).toMatchObject({ exitCode: 1, stdout: "" });
      expect(result.stderr).toContain("lease repository mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(mismatch.tempRoot, { recursive: true, force: true });
    }
  });

  for (const testCase of [
    {
      name: "wrong-result-file",
      env: () => {
        process.env.RESULT_FILE = ".ephemeral/pr-432-other-result.json";
      },
      stderr: "RESULT_FILE must match",
    },
    {
      name: "stale-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = "0".repeat(64);
        }),
      stderr: "digest mismatch",
    },
    {
      name: "stale-timestamp",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.validated_at =
            "2026-06-11T00:01:00Z";
        }),
      stderr: "validation is stale",
    },
    {
      name: "presentation-mismatch",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.status = "edited";
        }),
      stderr: "presentation status mismatch",
    },
    {
      name: "null-presented-at",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.presentation.presented_at = null;
        }),
      stderr: "lease schema mismatch",
    },
    {
      name: "missing-digest",
      mutate: (workspace: GatedStatusWorkspace) =>
        mutateLease(workspace, (lease) => {
          lease.validation.result_manifest.sha256 = null;
        }),
      stderr: "digest missing",
    },
    {
      name: "wrong-review-head",
      env: () => {
        process.env.HEAD_SHA = "2222222222222222222222222222222222222222";
      },
      stderr: "result review head mismatch",
    },
  ] as const) {
    it(`rejects stale or mismatched gated result evidence: ${testCase.name}`, async () => {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-status-${testCase.name}-`,
      );
      try {
        await testCase.mutate?.(workspace);
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        testCase.env?.();
        const result = await runPrReviewLeasesCommand(["read-status"]);
        expect(result.exitCode, testCase.name).toBe(1);
        expect(result.stdout, testCase.name).toBe("");
        expect(result.stderr, testCase.name).toContain(testCase.stderr);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    });
  }

  it("fails closed for nested result artifact drift before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("findings digest mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("fails closed for lease base/head mismatch before status success", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-status-ref-mismatch-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.head_ref = "other-topic";
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["read-status"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("handoff head ref mismatch");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records post-gated preview-render failure without invalid recovery artifacts", async () => {
    const {
      tempRoot,
      primary,
      worktree,
      physicalPrimary,
      physicalWorktree,
      reviewHead,
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    } = await makeResultAuthorityWorkspace("pr-review-preview-failure-");
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir,
        prReviewManifestHelperScript,
        prReviewLeaseHelperScript,
        playReviewHelper,
      });
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      process.env.LEASE_FILE = leaseFile;
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      await writeResultArtifact(
        worktree,
        physicalWorktree,
        resultFile,
        reviewHead,
        "preview-current",
      );
      process.env.RESULT_FILE = resultFile;
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      process.env.PRESENTED_AT = "2026-06-11T00:02:00Z";
      process.env.PRESENTATION_STATUS = "preview-current";
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      const gated = await readLease(primary, leaseFile);
      await rm(path.join(worktree, resultFile), { force: true });

      unsetEnv("RESULT_FILE");
      unsetEnv("PRESENTED_AT");
      unsetEnv("PRESENTATION_STATUS");
      process.env.EXPECTED_STATE = "gated";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "audit summary render failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      await writeLeaseCommandState({
        state: "failed",
        updatedAt: "2026-06-11T00:03:00Z",
      });

      const failed = await readLease(primary, leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
      const validateResult = await runPrReviewLeasesCommand(["validate"]);
      expect(validateResult.exitCode, validateResult.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records reviewed failure after nested result drift by clearing invalid recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-reviewed-failure-nested-drift-",
    );

    try {
      const reviewed = reviewedCommandLease(
        workspace.leaseFile,
        workspace.physicalWorktree,
        workspace.worktreeDigest,
        workspace.resultFile,
        workspace.resultSha256,
      );
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(reviewed, null, 2)}\n`,
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "reviewed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:03:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:03:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects failed-to-failed writes that replace the result pointer", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-result-replacement-",
    );

    try {
      const failed: PrReviewLease = {
        ...(await readLease(workspace.primary, workspace.leaseFile)),
        state: "failed",
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: null,
        },
        failure: {
          phase: "preview-render",
          reason: "preview failed",
          recoverability: "recoverable",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(failed, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.RESULT_FILE = `.ephemeral/pr-432-${workspace.reviewHead}-replacement-result.json`;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "preview-render";
      process.env.FAILURE_REASON = "preview still failed";
      process.env.FAILURE_RECOVERABILITY = "recoverable";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "RESULT_FILE must match existing failed result",
      );
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves valid failed recovery evidence without requiring failure timestamp freshness", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-repeated-failure-preserve-",
    );
    const approvedReviewFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected review";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";
      process.env.APPROVED_REVIEW_FILE = approvedReviewFile;
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedReviewFile,
        workspace.reviewHead,
      );

      let result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      let failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.updated_at).toBe("2026-06-11T00:03:00Z");
      expect(failed.validation.result_manifest.validated_at).toBe(
        "2026-06-11T00:02:00Z",
      );
      expect(failed.artifacts).toMatchObject({
        result_file: workspace.resultFile,
        approved_review_file: approvedReviewFile,
      });

      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      setHelperAuthorityEnv({
        prReviewDir: workspace.prReviewDir,
        prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
        prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
        playReviewHelper: workspace.playReviewHelper,
      });
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "failed";
      process.env.EXPECTED_STATE = "failed";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.FAILURE_PHASE = "github-post";
      process.env.FAILURE_REASON = "GitHub API rejected retry";
      process.env.FAILURE_RECOVERABILITY = "recoverable";
      process.env.GITHUB_POST_ATTEMPTED = "true";
      process.env.GITHUB_POST_RESULT = "failed";

      result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode, result.stderr).toBe(0);
      failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        updated_at: "2026-06-11T00:04:00Z",
        artifacts: {
          result_file: workspace.resultFile,
          approved_review_file: approvedReviewFile,
        },
        validation: {
          result_manifest: {
            status: "valid",
            validated_at: "2026-06-11T00:02:00Z",
            sha256: workspace.resultSha256,
          },
        },
        presentation: {
          presented_at: "2026-06-11T00:02:00Z",
          status: "preview-current",
        },
        failure: {
          phase: "github-post",
          reason: "GitHub API rejected retry",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure when the worktree is missing", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-audit-worktree-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspace.worktree],
        {
          cwd: workspace.primary,
        },
      );

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation timestamp after strict status rejection", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.presented_at = null;
      });
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const validateBefore = await runPrReviewLeasesCommand(["validate"]);
      expect(validateBefore.exitCode).toBe(1);
      expect(validateBefore.stderr).toContain("lease schema mismatch");

      const statusBefore = await runPrReviewLeasesCommand(["read-status"]);
      expect(statusBefore).toMatchObject({ exitCode: 1, stdout: "" });
      expect(statusBefore.stderr).toContain("lease schema mismatch");

      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });

      process.env.WORKTREE_PATH = workspace.physicalWorktree;
      const validateAfter = await runPrReviewLeasesCommand(["validate"]);
      expect(validateAfter.exitCode, validateAfter.stderr).toBe(0);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("records Phase 5 audit failure with missing presentation status by clearing recovery artifacts", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-presentation-status-audit-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed).toMatchObject({
        state: "failed",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        failure: {
          phase: "preview-render",
          reason: "audit summary render failed",
          recoverability: "recoverable",
        },
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts for Phase 5 audit failure when worktree directory is unregistered", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-audit-worktree-",
    );

    try {
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspace.worktree],
        {
          cwd: workspace.primary,
        },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });
      await writeResultArtifact(
        workspace.worktree,
        workspace.physicalWorktree,
        workspace.resultFile,
        workspace.reviewHead,
        "preview-current",
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts).toEqual({
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
      });
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves current recovery artifacts for registered Phase 5 audit failures", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-current-audit-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBe(workspace.resultFile);
      expect(failed.validation.result_manifest).toEqual({
        status: "valid",
        validated_at: "2026-06-11T00:02:00Z",
        sha256: workspace.resultSha256,
      });
      expect(failed.presentation).toEqual({
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears recovery artifacts when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-nested-digest-audit-evidence-",
    );

    try {
      await writeFile(
        path.join(workspace.worktree, workspace.findingsFile),
        `${JSON.stringify({ findings: [{ stale: true }], carry_forward: [] })}\n`,
      );
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears stale recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-stale-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.validated_at = "2026-06-11T00:01:00Z";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears missing-digest recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-digest-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.validation.result_manifest.sha256 = null;
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("clears presentation-mismatched recovery artifacts when recording Phase 5 audit failure", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-presentation-mismatch-audit-evidence-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.presentation.status = "edited";
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode, result.stderr).toBe(0);

      const failed = await readLease(workspace.primary, workspace.leaseFile);
      expect(failed.artifacts.result_file).toBeNull();
      expect(failed.validation.result_manifest).toEqual({
        status: null,
        validated_at: null,
        sha256: null,
      });
      expect(failed.presentation).toEqual({
        presented_at: null,
        status: null,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects audit failure recovery when the prior lease is not gated", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-audit-not-gated-",
    );

    try {
      await mutateLease(workspace, (lease) => {
        lease.state = "reviewed";
        lease.presentation = { presented_at: null, status: null };
      });
      process.chdir(workspace.physicalPrimary);
      setAuditFailureEnv(workspace, "2026-06-11T00:03:00Z");
      unsetEnv("WORKTREE_PATH");

      const result = await runPrReviewLeasesCommand(["record-audit-failure"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "record-audit-failure requires gated preview-render failure",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease Git cleanup safety", () => {
  it("reports missing worktrees as skipped cleanup when lease identity matches", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-missing-worktree-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(worktree, { recursive: true, force: true });

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("classifies ENOTDIR worktree paths as skipped non-worktrees", async () => {
    const { tempRoot, primary, physicalPrimary } =
      await makeRegisteredWorkspace("pr-review-enotdir-worktree-");

    try {
      const fileAncestor = path.join(tempRoot, "not-a-directory");
      const nonWorktreePath = path.join(fileAncestor, "child");
      await writeFile(fileAncestor, "not a directory\n");
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, nonWorktreePath);
      const worktreeDigest = discoveryWorktreeDigest(nonWorktreePath);
      const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(leaseFile, nonWorktreePath, worktreeDigest),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const inspection = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(inspection.exitCode).toBe(0);
      expect(inspection.stdout).toContain("OUTCOME=inspect");
      expect(inspection.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(inspection.stdout).toContain("METADATA_OUTCOME=skipped");

      const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(cleanup.exitCode).toBe(0);
      expect(cleanup.stdout).toContain("OUTCOME=skipped");
      expect(cleanup.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(cleanup.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for missing terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-missing-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await rm(workspace.worktree, { recursive: true, force: true });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=missing-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested result artifact drift before archive-on-recreate writes", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-nested-drift-`,
      );

      try {
        process.chdir(workspace.physicalPrimary);
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...(await readLease(workspace.primary, workspace.leaseFile)),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        const before = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        await mutateNestedFindingsWithoutUpdatingResult(workspace);

        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
        process.env.PR_REVIEW_DIR = workspace.prReviewDir;
        process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
          workspace.prReviewManifestHelperScript;
        process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
          workspace.prReviewLeaseHelperScript;
        process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(1);
        expect(result.stderr, state).toContain("findings digest mismatch");
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        const archived = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          archived.some((entry) => entry.includes("-archived-lease.json")),
        ).toBe(false);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("rejects invalid cleanup chronology before discovery reentry or terminal archive writes", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-cleanup-chronology-`,
        true,
      );

      try {
        const terminal =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : abortedCommandLease(
                workspace.leaseFile,
                workspace.physicalWorktree,
                workspace.worktreeDigest,
              );
        const finishedAt = terminal.terminal.finished_at ?? "";
        terminal.cleanup = {
          last_outcome: "removed",
          last_checked_at: "2026-06-11T00:00:00Z",
          removed_at: finishedAt,
        };
        const terminalBytes = `${JSON.stringify(terminal, null, 2)}\n`;
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          terminalBytes,
        );
        const archiveFile = `.ephemeral/pr-432-${workspace.worktreeDigest}-${finishedAt.replace(/[-:Z]/gu, "")}-${state}-archived-lease.json`;
        const archivePath = path.join(workspace.primary, archiveFile);
        await writeFile(archivePath, terminalBytes);
        await execFileAsync(
          "git",
          ["worktree", "remove", "-f", workspace.worktree],
          { cwd: workspace.primary },
        );

        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        expect(await discoverPrReviewSession()).toMatchObject({
          disposition: "invalid",
          active: [
            {
              lease_file: workspace.leaseFile,
              classification: "invalid",
            },
          ],
        });
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(terminalBytes);
        await expect(readFile(archivePath, "utf8")).resolves.toBe(
          terminalBytes,
        );

        await execFileAsync(
          "git",
          ["worktree", "add", workspace.worktree, "review-topic"],
          { cwd: workspace.primary },
        );
        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
        const write = await runPrReviewLeasesCommand(["write"]);
        expect(write.exitCode, state).toBe(1);
        expect(write.stderr, state).toContain(
          "cleanup.last_checked_at cannot precede terminal.finished_at",
        );
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(terminalBytes);
        await expect(readFile(archivePath, "utf8")).resolves.toBe(
          terminalBytes,
        );
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("retries helper-recorded terminal archival after fresh creation is interrupted", async () => {
    for (const state of ["posted", "aborted"] as const) {
      const workspace = await makeGatedStatusWorkspace(
        `pr-review-${state}-archive-after-cleanup-`,
        true,
      );

      try {
        const prior =
          state === "posted"
            ? postedCommandLease({
                leaseFile: workspace.leaseFile,
                worktreePath: workspace.physicalWorktree,
                worktreeDigest: workspace.worktreeDigest,
                resultFile: workspace.resultFile,
                resultSha256: workspace.resultSha256,
                approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
                validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
              })
            : {
                ...(await readLease(workspace.primary, workspace.leaseFile)),
                state: "aborted" as const,
                updated_at: "2026-06-11T00:03:00Z",
                terminal: {
                  finished_at: "2026-06-11T00:03:00Z",
                  reason: "user-aborted",
                },
              };
        if (state === "posted") {
          await writeApprovedReviewArtifact(
            workspace.worktree,
            prior.artifacts.approved_review_file ?? "",
            workspace.reviewHead,
          );
          await writeValidatedPayloadArtifact(
            workspace.worktree,
            workspace.reviewHead,
          );
        }
        await writeFile(
          path.join(workspace.primary, workspace.leaseFile),
          `${JSON.stringify(prior, null, 2)}\n`,
        );
        await writeFile(
          path.join(workspace.primary, ".git", "info", "exclude"),
          ".ephemeral/\n",
        );
        const diagnosticsDirectory = path.join(
          workspace.physicalPrimary,
          ".ephemeral",
          `pr-432-controller-diagnostics-${state}-cleanup-run`,
        );
        await mkdir(diagnosticsDirectory);
        const diagnosticsFile = path.join(
          diagnosticsDirectory,
          "terminal-report.txt",
        );
        const diagnosticBytes = `terminal report before ${state} cleanup\n`;
        await writeFile(diagnosticsFile, diagnosticBytes);
        process.chdir(workspace.physicalPrimary);
        setReadStatusEnv(workspace);
        const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(cleanup.exitCode, state).toBe(0);
        expect(cleanup.stdout, state).toContain("OUTCOME=removed");
        await expect(readFile(diagnosticsFile, "utf8")).resolves.toBe(
          diagnosticBytes,
        );
        const removedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(removedLease.cleanup).toMatchObject({ last_outcome: "removed" });
        expect(removedLease.cleanup?.removed_at).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u,
        );
        const removedAt = removedLease.cleanup?.removed_at;
        const retry = await runPrReviewLeasesCommand(["cleanup-worktree"]);
        expect(retry.exitCode, state).toBe(0);
        expect(retry.stdout, state).toContain("OUTCOME=skipped");
        const retriedLease = await readLease(
          workspace.primary,
          workspace.leaseFile,
        );
        expect(retriedLease.cleanup).toMatchObject({
          last_outcome: "skipped",
          removed_at: removedAt,
        });
        await execFileAsync(
          "git",
          ["worktree", "add", workspace.worktree, "review-topic"],
          { cwd: workspace.primary },
        );

        process.chdir(workspace.physicalPrimary);
        setLeaseCommandEnv(
          workspace.physicalPrimary,
          workspace.physicalWorktree,
        );
        process.env.LEASE_FILE = workspace.leaseFile;
        process.env.STATE = "created";
        process.env.BASE_REF = "main";
        process.env.HEAD_REF = "topic";
        process.env.CREATED_AT = "2026-06-11T00:04:00Z";
        process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

        const before = await readFile(
          path.join(workspace.primary, workspace.leaseFile),
          "utf8",
        );
        const writeSpy = vi
          .spyOn(artifacts, "writeTextAtomically")
          .mockRejectedValueOnce(new Error("interrupted fresh lease write"));
        const interrupted = await runPrReviewLeasesCommand(["write"]);
        expect(interrupted.exitCode).toBe(1);
        expect(interrupted.stderr).toContain("interrupted fresh lease write");
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        const interruptedEntries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        const interruptedArchive = interruptedEntries.find((entry) =>
          entry.includes(`-${state}-archived-lease.json`),
        );
        expect(interruptedArchive).toBeDefined();
        await expect(
          readFile(
            path.join(
              workspace.primary,
              ".ephemeral",
              interruptedArchive ?? "",
            ),
            "utf8",
          ),
        ).resolves.toBe(before);
        writeSpy.mockRestore();

        expect(await discoverPrReviewSession()).toMatchObject({
          disposition: "create",
          canonical_worktree_present: true,
          active: [
            {
              lease_file: workspace.leaseFile,
              state,
              classification: "reentry",
              worktree_dirty: false,
              unmanaged_ephemeral_artifacts: false,
            },
          ],
          resume: null,
        });

        const archivePath = path.join(
          workspace.primary,
          ".ephemeral",
          interruptedArchive ?? "",
        );
        await writeFile(archivePath, '{"collision":true}\n');
        const collision = await runPrReviewLeasesCommand(["write"]);
        expect(collision.exitCode, state).toBe(1);
        expect(collision.stderr, state).toContain("archived lease collision");
        await expect(
          readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
        ).resolves.toBe(before);
        await expect(readFile(archivePath, "utf8")).resolves.toBe(
          '{"collision":true}\n',
        );
        await writeFile(archivePath, before);

        const result = await runPrReviewLeasesCommand(["write"]);
        expect(result.exitCode, state).toBe(0);
        const fresh = await readLease(workspace.primary, workspace.leaseFile);
        expect(fresh).toMatchObject({
          state: "created",
          artifacts: {
            handoff_file: null,
            result_file: null,
            approved_review_file: null,
            validated_payload_file: null,
          },
        });
        expect("cleanup" in fresh).toBe(false);
        const entries = await readdir(
          path.join(workspace.primary, ".ephemeral"),
        );
        expect(
          entries.some((entry) =>
            entry.includes(`-${state}-archived-lease.json`),
          ),
        ).toBe(true);
      } finally {
        process.chdir(originalCwd);
        await rm(workspace.tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("keeps noncanonical helper-recorded removed terminal leases under strict archive validation", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-noncanonical-archive-after-cleanup-",
    );

    try {
      const prior = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeApprovedReviewArtifact(
        workspace.worktree,
        prior.artifacts.approved_review_file ?? "",
        workspace.reviewHead,
      );
      await writeValidatedPayloadArtifact(
        workspace.worktree,
        workspace.reviewHead,
      );
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(prior, null, 2)}\n`,
      );
      await writeFile(
        path.join(workspace.primary, ".git", "info", "exclude"),
        ".ephemeral/\n",
      );
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(cleanup.exitCode, cleanup.stderr).toBe(0);
      expect(cleanup.stdout).toContain("OUTCOME=removed");

      await execFileAsync(
        "git",
        ["worktree", "add", workspace.worktree, "review-topic"],
        { cwd: workspace.primary },
      );
      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:04:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "result file missing or not a regular file",
      );
      expect(
        await readdir(path.join(workspace.primary, ".ephemeral")),
      ).not.toContain(expect.stringContaining("-posted-archived-lease.json"));
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps legacy removed cleanup observations under strict archive validation", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-legacy-cleanup-authority-",
    );

    try {
      const lease = await readLease(workspace.primary, workspace.leaseFile);
      const legacy = {
        ...lease,
        state: "aborted" as const,
        updated_at: "2026-06-11T00:03:00Z",
        terminal: {
          finished_at: "2026-06-11T00:03:00Z",
          reason: "user-aborted",
        },
        cleanup: {
          last_outcome: "removed" as const,
          last_checked_at: "2026-06-11T00:03:00Z",
        },
      };
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(legacy, null, 2)}\n`,
      );
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const validation = await runPrReviewLeasesCommand(["validate"]);
      expect(validation.exitCode, validation.stderr).toBe(0);
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
      expect(
        (await readLease(workspace.primary, workspace.leaseFile)).cleanup,
      ).toEqual(legacy.cleanup);
      await execFileAsync(
        "git",
        ["worktree", "remove", "-f", workspace.worktree],
        { cwd: workspace.primary },
      );
      await execFileAsync(
        "git",
        ["worktree", "add", workspace.worktree, "review-topic"],
        { cwd: workspace.primary },
      );

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      process.env.STATE = "created";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.CREATED_AT = "2026-06-11T00:04:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";

      const result = await runPrReviewLeasesCommand(["write"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("result file missing");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
      const entries = await readdir(path.join(workspace.primary, ".ephemeral"));
      expect(
        entries.some((entry) => entry.includes("-archived-lease.json")),
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps post-removal metadata writes outside git-removal failure handling", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/runtime/pr-review-leases.ts"),
      "utf8",
    );
    const cleanupStart = source.indexOf("async function cleanupWorktree()");
    const cleanupEnd = source.indexOf(
      "\nfunction shouldRecordCleanupMetadata",
      cleanupStart,
    );
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);
    const removalCall = cleanupSource.indexOf(
      'await execFileAsync("git", args);',
    );
    const removalCatch = cleanupSource.indexOf("  } catch {", removalCall);
    const postRemovalSuccessPath = cleanupSource.indexOf(
      "\n\n  if (shouldRecordCleanupMetadata(decision)) {",
      removalCatch,
    );
    const removedMetadata = cleanupSource.indexOf(
      '"removed",\n      false,',
      postRemovalSuccessPath,
    );

    expect(cleanupStart).toBeGreaterThan(-1);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);
    expect(removalCall).toBeGreaterThan(-1);
    expect(removalCatch).toBeGreaterThan(removalCall);
    expect(postRemovalSuccessPath).toBeGreaterThan(removalCatch);
    expect(removedMetadata).toBeGreaterThan(postRemovalSuccessPath);
  });

  it("skips cleanup targets that are clean separate clones, not registered worktrees", async () => {
    const { tempRoot, primary, physicalPrimary } =
      await makeRegisteredWorkspace("pr-review-separate-clone-");
    const separateClone = path.join(tempRoot, "separate-clone");

    try {
      await execFileAsync("git", ["clone", primary, separateClone]);
      const physicalSeparateClone = await realpath(separateClone);
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalSeparateClone);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalSeparateClone,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalSeparateClone,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records skipped cleanup metadata for unregistered terminal worktrees with historical result pointers", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-unregistered-terminal-result-cleanup-",
    );

    try {
      const posted = postedCommandLease({
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: workspace.resultSha256,
        approvedReviewFile: `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`,
        validatedPayloadFile: `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`,
      });
      await writeFile(
        path.join(workspace.primary, workspace.leaseFile),
        `${JSON.stringify(posted, null, 2)}\n`,
      );
      await execFileAsync(
        "git",
        ["worktree", "remove", "--force", workspace.worktree],
        { cwd: workspace.primary },
      );
      await mkdir(path.join(workspace.worktree, ".ephemeral"), {
        recursive: true,
      });

      process.chdir(workspace.physicalPrimary);
      setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
      process.env.LEASE_FILE = workspace.leaseFile;
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=skipped");
      expect(result.stdout).toContain("REFUSAL_REASON=not-registered-worktree");
      expect(result.stdout).toContain("METADATA_OUTCOME=skipped");

      const lease = await readLease(workspace.primary, workspace.leaseFile);
      expect(lease.artifacts.result_file).toBe(workspace.resultFile);
      expect(lease.validation.result_manifest.sha256).toBe(
        workspace.resultSha256,
      );
      expect(lease.cleanup?.last_outcome).toBe("skipped");
      expect(lease.cleanup?.last_checked_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u,
      );
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("retains cleanup targets when git status inspection fails", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-status-cleanup-failure-");

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(
          abortedCommandLease(
            leaseFile,
            physicalWorktree,
            dynamicIdentity.worktreeDigest,
          ),
          null,
          2,
        )}\n`,
      );
      await rm(path.join(worktree, ".git"), {
        recursive: true,
        force: true,
      });

      process.env.LEASE_FILE = leaseFile;
      let result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("OUTCOME=inspect");

      result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OUTCOME=retained");
      expect(result.stdout).toContain(
        "REFUSAL_REASON=status-inspection-failed",
      );
      expect(result.stdout).toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup metadata rewrites when nested result artifact digests drift", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-cleanup-nested-drift-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      const before = await readFile(
        path.join(workspace.primary, workspace.leaseFile),
        "utf8",
      );
      await mutateNestedFindingsWithoutUpdatingResult(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      await expect(
        readFile(path.join(workspace.primary, workspace.leaseFile), "utf8"),
      ).resolves.toBe(before);
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("treats provider scope evidence referenced by valid result chains as owned", async () => {
    const workspace = await makeGatedStatusWorkspace(
      "pr-review-owned-provider-evidence-",
    );

    try {
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);

      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).not.toContain("provider-scope-evidence.json");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("cleans up a retained Phase 5 audit owned by the validated result", async () => {
    const workspace = await makeGatedStatusWorkspace("pr-review-owned-audit-");

    try {
      await writeFile(
        path.join(workspace.primary, ".git", "info", "exclude"),
        ".ephemeral/\n",
      );
      await writeFile(
        path.join(
          workspace.worktree,
          `.ephemeral/pr-432-${workspace.reviewHead}-phase5-audit.md`,
        ),
        "# Full audit\n",
      );
      process.chdir(workspace.physicalPrimary);
      setReadStatusEnv(workspace);
      process.env.STATE = "aborted";
      process.env.EXPECTED_STATE = "gated";
      process.env.TERMINAL_REASON = "user-aborted";
      process.env.BASE_REF = "main";
      process.env.HEAD_REF = "topic";
      process.env.FINISHED_AT = "2026-06-11T00:04:00Z";
      process.env.UPDATED_AT = "2026-06-11T00:04:00Z";
      const aborted = await runPrReviewLeasesCommand(["write"]);
      expect(aborted.exitCode, aborted.stderr).toBe(0);
      const unrelatedAudit = path.join(
        workspace.worktree,
        `.ephemeral/pr-432-${"f".repeat(40)}-phase5-audit.md`,
      );
      await writeFile(unrelatedAudit, "# Other review audit\n");
      const refused = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(refused.stdout).toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      await rm(unrelatedAudit);
      const result = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("OUTCOME=removed");
    } finally {
      process.chdir(originalCwd);
      await rm(workspace.tempRoot, { recursive: true, force: true });
    }
  });

  it("refuses cleanup when ignored worktree ephemeral artifacts are unmanaged", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-cleanup-");
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");
    const diagnosticsDirectory = path.join(
      physicalPrimary,
      ".ephemeral",
      "pr-432-controller-diagnostics-unmanaged-run",
    );
    await mkdir(diagnosticsDirectory);
    const diagnosticsFile = path.join(
      diagnosticsDirectory,
      "terminal-report.txt",
    );
    const diagnosticBytes = "terminal report beside unmanaged checkout file\n";
    await writeFile(diagnosticsFile, diagnosticBytes);

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease: PrReviewLease = {
        schema: "pr-review/lease/v1",
        repository: "owner/repo",
        pr_number: 432,
        state: "aborted",
        base_ref: "main",
        head_ref: "topic",
        worktree_path: physicalWorktree,
        worktree_digest: dynamicIdentity.worktreeDigest,
        lease_file: leaseFile,
        created_at: "2026-06-11T00:00:00Z",
        updated_at: "2026-06-11T00:01:00Z",
        artifacts: {
          handoff_file: null,
          result_file: null,
          approved_review_file: null,
          validated_payload_file: null,
        },
        validation: {
          result_manifest: { status: null, validated_at: null, sha256: null },
        },
        presentation: { presented_at: null, status: null },
        terminal: {
          finished_at: "2026-06-11T00:01:00Z",
          reason: "user-aborted",
        },
        failure: { phase: null, reason: null, recoverability: null },
        github: {
          github_post_attempted: false,
          github_post_result: "not-attempted",
          github_posted_at: null,
        },
      };
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      expect(result.stdout).toContain(
        "MESSAGE=unmanaged .ephemeral artifacts: .ephemeral/unmanaged.txt",
      );
      const cleanup = await runPrReviewLeasesCommand(["cleanup-worktree"]);
      expect(cleanup.exitCode).toBe(0);
      expect(cleanup.stdout).toContain("OUTCOME=retained");
      expect(cleanup.stdout).toContain(
        "REFUSAL_REASON=unmanaged-ephemeral-artifacts",
      );
      await expect(readFile(diagnosticsFile, "utf8")).resolves.toBe(
        diagnosticBytes,
      );
      await expect(
        readFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "utf8"),
      ).resolves.toBe("keep\n");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("treats malformed result metadata as invalid before cleanup ownership", async () => {
    const { tempRoot, primary, worktree, physicalPrimary, physicalWorktree } =
      await makeRegisteredWorkspace("pr-review-owned-");
    const resultFile = ".ephemeral/pr-432-result.json";
    const findingsFile = ".ephemeral/topic-findings.json";
    await writeFile(path.join(worktree, ".ephemeral/unmanaged.txt"), "keep\n");
    await writeFile(path.join(worktree, findingsFile), "{}\n");
    await writeFile(
      path.join(worktree, resultFile),
      `${JSON.stringify({
        repository: "owner/repo",
        pr_number: 432,
        review_head_sha: "1111111111111111111111111111111111111111",
        findings_file: findingsFile,
        review_body_file: null,
        context_file: null,
        artifacts: {
          handoff_file: ".ephemeral/pr-432-handoff.json",
          scope_decision_file: ".ephemeral/pr-432-scope-decision.json",
          prior_threads_file: null,
          rendered_preview_file: null,
          extra: ".ephemeral/unmanaged.txt",
        },
      })}\n`,
    );

    try {
      process.chdir(physicalPrimary);
      setLeaseCommandEnv(physicalPrimary, physicalWorktree);
      const pathResult = await runPrReviewLeasesCommand(["derive-path"]);
      expect(pathResult.exitCode).toBe(0);
      const leaseFile = pathResult.stdout.trim();
      const dynamicIdentity = identityFromLeaseFile(
        leaseFile,
        physicalWorktree,
      );
      const lease = reviewedCommandLease(
        leaseFile,
        physicalWorktree,
        dynamicIdentity.worktreeDigest,
        resultFile,
        await sha256File(path.join(worktree, resultFile)),
      );
      await writeFile(
        path.join(primary, leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );

      process.env.LEASE_FILE = leaseFile;
      const result = await runPrReviewLeasesCommand(["inspect-worktree"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("REFUSAL_REASON=invalid-lease");
      expect(result.stdout).not.toContain("METADATA_OUTCOME=retained");
    } finally {
      process.chdir(originalCwd);
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("pr-review lease wrapper trusted runtime bootstrap", () => {
  const wrapper = path.resolve("skills/pr-review/scripts/review-leases.sh");

  async function writeRuntime(
    root: string,
    directoryName: string,
  ): Promise<{
    runtimeDir: string;
    resolverSentinel: string;
    typedSentinel: string;
  }> {
    const runtimeDir = path.join(root, directoryName);
    const scriptsDir = path.join(runtimeDir, "scripts");
    const typedRuntimeDir = path.join(scriptsDir, "runtime");
    const resolverSentinel = path.join(
      root,
      `${directoryName.length}-resolver-executed`,
    );
    const typedSentinel = path.join(
      root,
      `${directoryName.length}-typed-executed`,
    );
    await mkdir(typedRuntimeDir, { recursive: true });
    const resolver = path.join(scriptsDir, "devcanon-runtime.sh");
    await writeFile(
      resolver,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'case "${1:-}" in',
        "  runtime)",
        "    printf 'executed\\n' >\"$DEVCANON_TEST_RESOLVER_SENTINEL\"",
        "    printf 'runtime-ok\\n'",
        "    ;;",
        "  *) exit 64 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(resolver, 0o755);
    const typedRuntime = path.join(typedRuntimeDir, "devcanon-runtime.mjs");
    await writeFile(
      typedRuntime,
      [
        'import { writeFileSync } from "node:fs";',
        "const [group, helper] = process.argv.slice(2);",
        'if (group !== "runtime" || helper !== "pr-review-leases") process.exit(64);',
        'writeFileSync(process.env.DEVCANON_TEST_TYPED_SENTINEL, "executed\\n");',
        'process.stdout.write("runtime-ok\\n");',
        "",
      ].join("\n"),
    );
    await chmod(typedRuntime, 0o755);
    return { runtimeDir, resolverSentinel, typedSentinel };
  }

  async function runWrapper(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    bashExecutable = "bash",
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const { exitCode, stdout, stderr } = await commandHarness.run(
      bashExecutable,
      [wrapper, "derive-path"],
      {
        env: {
          ...process.env,
          DEVCANON_RUNTIME_DIR: runtimeDir,
          DEVCANON_TEST_RESOLVER_SENTINEL: resolverSentinel,
          DEVCANON_TEST_TYPED_SENTINEL: typedSentinel,
        },
        acceptedExitCodes: [0, 1],
      },
    );
    return { exitCode, stdout, stderr };
  }

  async function expectAccepted(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    bashExecutable = "bash",
  ): Promise<void> {
    const result = await runWrapper(
      runtimeDir,
      resolverSentinel,
      typedSentinel,
      bashExecutable,
    );
    expect(result).toEqual({
      exitCode: 0,
      stdout: "runtime-ok\n",
      stderr: "",
    });
    expect(await readFile(typedSentinel, "utf8")).toBe("executed\n");
    await expect(readFile(resolverSentinel, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await rm(typedSentinel);
  }

  async function expectRejected(
    runtimeDir: string,
    resolverSentinel: string,
    typedSentinel: string,
    expectedStderr: string,
    bashExecutable = "bash",
  ): Promise<void> {
    const result = await runWrapper(
      runtimeDir,
      resolverSentinel,
      typedSentinel,
      bashExecutable,
    );
    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: `${expectedStderr}\n`,
    });
    for (const sentinel of [resolverSentinel, typedSentinel]) {
      await expect(readFile(sentinel, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
  }

  it("forwards session-create to the trusted runtime", async () => {
    const root = await commandHarness.createScratchRoot();
    const runtime = await writeRuntime(root, "session-create-runtime");
    const result = await commandHarness.run(
      "bash",
      [wrapper, "session-create"],
      {
        env: {
          ...process.env,
          DEVCANON_RUNTIME_DIR: runtime.runtimeDir,
          DEVCANON_TEST_RESOLVER_SENTINEL: runtime.resolverSentinel,
          DEVCANON_TEST_TYPED_SENTINEL: runtime.typedSentinel,
        },
        acceptedExitCodes: [0, 1],
      },
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "runtime-ok\n",
      stderr: "",
    });
    expect(await readFile(runtime.typedSentinel, "utf8")).toBe("executed\n");
    await expect(
      readFile(runtime.resolverSentinel, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.runIf(process.platform !== "win32")(
    "preserves POSIX line feeds and valid dot aliases despite a poisoned OSTYPE",
    async () => {
      const root = await commandHarness.createScratchRoot();
      try {
        const ordinary = await writeRuntime(root, "ordinary-runtime");
        await expectAccepted(
          ordinary.runtimeDir,
          ordinary.resolverSentinel,
          ordinary.typedSentinel,
        );
        await expectAccepted(
          `${ordinary.runtimeDir}/.`,
          ordinary.resolverSentinel,
          ordinary.typedSentinel,
        );

        const lineFeed = await writeRuntime(root, "line-feed-runtime\n");
        await expectAccepted(
          lineFeed.runtimeDir,
          lineFeed.resolverSentinel,
          lineFeed.typedSentinel,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects POSIX traversal and final symlink aliases before resolver execution",
    async () => {
      const root = await commandHarness.createScratchRoot();
      try {
        const target = await writeRuntime(root, "target-runtime");
        const linkedRuntime = path.join(root, "linked-runtime");
        await symlink(target.runtimeDir, linkedRuntime);
        const containmentError =
          "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory";
        for (const spelling of [
          linkedRuntime,
          `${linkedRuntime}/`,
          `${linkedRuntime}/.`,
        ]) {
          await expectRejected(
            spelling,
            target.resolverSentinel,
            target.typedSentinel,
            containmentError,
          );
        }
        await expectRejected(
          `${linkedRuntime}/scripts/..`,
          target.resolverSentinel,
          target.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "darwin")(
    "preserves the logical macOS /var ancestor alias",
    async () => {
      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const logicalRoot = root.startsWith("/private/var/")
          ? root.replace(/^\/private\/var\//u, "/var/")
          : root;
        const logicalRuntime = path.join(logicalRoot, "runtime");
        await expectAccepted(
          logicalRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "uses Git-for-Windows Bash capability for native and mixed-separator containment",
    async () => {
      const bashExecutable = await resolveGitForWindowsBash();
      const { stdout: windowsPwd } = await execFileAsync(bashExecutable, [
        "-lc",
        "builtin pwd -W",
      ]);
      expect(Buffer.byteLength(windowsPwd, "utf8")).toBeLessThanOrEqual(65_536);
      const windowsPwdRecord = /^([^\r\n]+)\r?\n$/u.exec(windowsPwd);
      expect(windowsPwdRecord).not.toBeNull();
      const reportedWindowsCwd = windowsPwdRecord?.[1] ?? "";
      expect(path.win32.isAbsolute(reportedWindowsCwd)).toBe(true);
      expect(path.win32.normalize(reportedWindowsCwd).toLowerCase()).toBe(
        path.win32.normalize(process.cwd()).toLowerCase(),
      );

      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        await expectAccepted(
          native,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );
        await expectAccepted(
          `${native}\\.`,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );

        const linkedRuntime = path.join(root, "linked-runtime");
        await symlink(fixture.runtimeDir, linkedRuntime, "junction");
        const { stdout: nativeLinkOutput } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: linkedRuntime,
            },
          },
        );
        const nativeLink = nativeLinkOutput.trim();
        const containmentError =
          "DEVCANON_RUNTIME_DIR must name a non-symlink packaged runtime directory";
        for (const spelling of [
          nativeLink,
          `${nativeLink}\\`,
          `${nativeLink}\\.`,
          `${nativeLink.replace(/\\/gu, "/")}\\`,
        ]) {
          await expectRejected(
            spelling,
            fixture.resolverSentinel,
            fixture.typedSentinel,
            containmentError,
            bashExecutable,
          );
        }
        await expectRejected(
          `${nativeLink}\\scripts/..`,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
          bashExecutable,
        );
        await expectRejected(
          "\\\\?\\UNC\\localhost\\unavailable\\linked\\scripts\\..",
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component",
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "runs URL-representable real UNC runtime containment or reports the unavailable capability",
    async ({ skip }) => {
      const bashExecutable = await resolveGitForWindowsBash();
      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        const drive = native.slice(0, 1);
        const computerName = process.env.COMPUTERNAME?.trim() ?? "";
        if (
          computerName.length === 0 ||
          computerName.toLowerCase() === "localhost"
        ) {
          skip(
            "UNC runtime integration unavailable: COMPUTERNAME does not provide a non-special host",
          );
        }
        const uncRuntime = `\\\\${computerName}\\${drive}$${native.slice(2)}`;
        try {
          await realpath(uncRuntime);
        } catch {
          skip(
            "UNC runtime integration unavailable: machine-name administrative drive share is not accessible",
          );
        }
        const physicalTypedEntrypoint = await realpath(
          path.win32.join(
            uncRuntime,
            "scripts",
            "runtime",
            "devcanon-runtime.mjs",
          ),
        );
        const typedEntrypointUrl = pathToFileURL(physicalTypedEntrypoint);
        expect(typedEntrypointUrl.hostname.toLowerCase()).toBe(
          computerName.toLowerCase(),
        );
        expect(
          path.win32.normalize(fileURLToPath(typedEntrypointUrl)).toLowerCase(),
        ).toBe(path.win32.normalize(physicalTypedEntrypoint).toLowerCase());
        await expectAccepted(
          uncRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects an accessible localhost UNC runtime before resolver or typed entrypoint execution",
    async ({ skip }) => {
      const bashExecutable = await resolveGitForWindowsBash();
      const root = await commandHarness.createScratchRoot();
      try {
        const fixture = await writeRuntime(root, "runtime");
        const { stdout: nativeRuntime } = await execFileAsync(
          bashExecutable as string,
          ["-lc", 'cygpath -w "$DEVCANON_TEST_PATH"'],
          {
            env: {
              ...process.env,
              DEVCANON_TEST_PATH: fixture.runtimeDir,
            },
          },
        );
        const native = nativeRuntime.trim();
        const drive = native.slice(0, 1);
        const localhostUncRuntime = `\\\\localhost\\${drive}$${native.slice(2)}`;
        try {
          await realpath(localhostUncRuntime);
        } catch {
          skip(
            "localhost UNC rejection unavailable: localhost administrative drive share is not accessible",
          );
        }
        await expectRejected(
          localhostUncRuntime,
          fixture.resolverSentinel,
          fixture.typedSentinel,
          "devcanon-runtime typed entrypoint is not representable as a Windows file URL",
          bashExecutable,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
