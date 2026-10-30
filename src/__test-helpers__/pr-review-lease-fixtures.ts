import { createHash } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm as removePath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { runPlayReviewSharedContextCommand as runPlayReviewSharedContextRuntimeCommand } from "../runtime/play-review-shared-context.js";
import {
  type PrReviewLease,
  runPrReviewLeasesCommand as runPrReviewLeasesRuntimeCommand,
} from "../runtime/pr-review-leases.js";
import { runPrReviewProviderScopeEvidenceCommand } from "../runtime/review-artifacts.js";
import { PrReviewCommandHarness } from "./pr-review-command-harness.js";

interface DiscoveryResult {
  disposition: string;
  canonical_worktree_present: boolean;
  active: Array<{
    lease_file: string;
    worktree_path: string | null;
    state: string | null;
    classification: string;
    worktree_dirty: boolean | null;
    unmanaged_ephemeral_artifacts: boolean | null;
  }>;
  resume: { lease_file: string; worktree_path: string } | null;
}

interface TerminalAdvanceRefusalFixture {
  repository: Awaited<
    ReturnType<PrReviewCommandHarness["createReviewRepository"]>
  >;
  worktree: string;
  oldHead: string;
  newHead: string;
  leasePath: string;
  leaseBytes: string;
  archiveName: string;
  handoffFile: string;
  handoffBytes: string;
}

/** Each suite owns its processes, cwd/environment snapshots, and case cleanup. */
export function createPrReviewLeaseFixtures() {
  const identity = {
    repository: "owner/repo",
    prNumber: 432,
    worktreePath: "/tmp/review-worktree",
    worktreeDigest:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    leaseFile:
      ".ephemeral/pr-432-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-lease.json",
  };

  const originalCwd = process.cwd();

  const managedEnvKeys = [
    "REPOSITORY",
    "PR_NUMBER",
    "PRIMARY_REPOSITORY_ROOT",
    "WORKTREE_PATH",
    "LEASE_FILE",
    "HANDOFF_FILE",
    "PREPARATION_FAILURE_DIRS",
    "RESULT_FILE",
    "FINDINGS_FILE",
    "HEAD_SHA",
    "REVIEW_CONTEXT_INPUT_FILE",
    "REVIEW_CONTEXT_OUTPUT_FILE",
    "REVIEW_CONTEXT_FAMILY_JSON",
    "REVIEW_CONTEXT_INPUT_JSON",
    "STATE",
    "BASE_REF",
    "HEAD_REF",
    "CREATED_AT",
    "UPDATED_AT",
    "PRESENTED_AT",
    "PRESENTATION_STATUS",
    "FINISHED_AT",
    "TERMINAL_REASON",
    "FAILURE_PHASE",
    "FAILURE_REASON",
    "FAILURE_RECOVERABILITY",
    "GITHUB_POST_ATTEMPTED",
    "GITHUB_POST_RESULT",
    "GITHUB_POSTED_AT",
    "APPROVED_REVIEW_FILE",
    "VALIDATED_REVIEW_PAYLOAD_FILE",
    "VALIDATED_PAYLOAD_FILE",
    "EXPECTED_STATE",
    "ALLOW_POLICY_OVERRIDE",
    "ALLOW_TERMINAL_ADVANCE",
    "ATTEMPT_REQUEST_FILE",
    "CONTINUATION_REQUEST_FILE",
    "PR_REVIEW_DIR",
    "PR_REVIEW_MANIFEST_HELPER_SCRIPT",
    "PR_REVIEW_LEASE_HELPER_SCRIPT",
    "PLAY_REVIEW_HELPER",
    "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
    "DEVCANON_RUNTIME_DIR",
    "GIT_TRACE2_EVENT",
    "GIT_INDEX_FILE",
  ] as const;

  const commandHarness = new PrReviewCommandHarness({
    envKeys: managedEnvKeys,
    seed: "review",
  });

  let sharedReviewHelpers: Awaited<
    ReturnType<typeof writeReviewHelperScripts>
  > | null = null;

  beforeAll(async () => {
    await commandHarness.setup();
    sharedReviewHelpers = await writeReviewHelperScripts(
      path.join(commandHarness.suiteRoot, "h"),
    );
  });

  beforeEach(() => {
    commandHarness.beginTest();
  });

  afterEach(async () => {
    await commandHarness.endTest();
  });

  afterAll(async () => {
    await commandHarness.dispose();
  });

  async function resolveGitForWindowsBash(): Promise<string> {
    const { stdout } = await execFileAsync("where.exe", ["git.exe"]);
    const candidates = new Set<string>();
    for (const gitExecutable of stdout
      .split(/\r?\n/gu)
      .filter((entry) => path.win32.isAbsolute(entry))) {
      const gitDirectory = path.win32.dirname(gitExecutable);
      candidates.add(path.win32.resolve(gitDirectory, "..", "bin", "bash.exe"));
      candidates.add(
        path.win32.resolve(gitDirectory, "..", "usr", "bin", "bash.exe"),
      );
    }
    for (const candidate of candidates) {
      try {
        if (!(await lstat(candidate)).isFile()) continue;
        await execFileAsync(candidate, [
          "-lc",
          "builtin pwd -W >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1",
        ]);
        return await realpath(candidate);
      } catch {}
    }
    throw new Error("Git-for-Windows Bash is unavailable");
  }

  async function execFileAsync(
    command: string,
    args: readonly string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  ) {
    return commandHarness.run(command, args, options);
  }

  function rm(
    ...args: Parameters<typeof removePath>
  ): ReturnType<typeof removePath> {
    const [target] = args;
    if (
      typeof target === "string" &&
      commandHarness.ownsCaseRoot(path.resolve(target))
    ) {
      return Promise.resolve();
    }
    return removePath(...args);
  }

  function runPrReviewLeasesCommand(
    args: readonly string[],
  ): ReturnType<typeof runPrReviewLeasesRuntimeCommand> {
    return commandHarness.trackOuter(
      runPrReviewLeasesRuntimeCommand(args),
      `pr-review-leases ${args.join(" ")}`,
    );
  }

  function runPlayReviewSharedContextCommand(
    args: readonly string[],
  ): ReturnType<typeof runPlayReviewSharedContextRuntimeCommand> {
    return commandHarness.trackOuter(
      runPlayReviewSharedContextRuntimeCommand(args),
      `play-review-shared-context ${args.join(" ")}`,
    );
  }

  async function discoverPrReviewSession(): Promise<DiscoveryResult> {
    const result = await runPrReviewLeasesCommand(["discover"]);
    expect(result.exitCode, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as DiscoveryResult;
  }

  function setLeaseCommandEnv(primary: string, worktree: string): void {
    process.env.REPOSITORY = "owner/repo";
    process.env.PR_NUMBER = "432";
    process.env.PRIMARY_REPOSITORY_ROOT = primary;
    process.env.WORKTREE_PATH = worktree;
    unsetEnv("LEASE_FILE");
    unsetEnv("RESULT_FILE");
    unsetEnv("HEAD_SHA");
  }

  function unsetEnv(key: (typeof managedEnvKeys)[number]): void {
    delete process.env[key];
  }

  async function writeLeaseCommandState({
    state,
    updatedAt,
  }: {
    state: PrReviewLease["state"];
    updatedAt: string;
  }): Promise<void> {
    process.env.STATE = state;
    process.env.BASE_REF = "main";
    process.env.HEAD_REF = "topic";
    process.env.UPDATED_AT = updatedAt;
    const result = await runPrReviewLeasesCommand(["write"]);
    expect(result.exitCode, result.stderr).toBe(0);
  }

  async function readLease(
    primary: string,
    leaseFile: string,
  ): Promise<PrReviewLease> {
    return JSON.parse(await readFile(path.join(primary, leaseFile), "utf8"));
  }

  async function sha256File(file: string): Promise<string> {
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  }

  type GatedStatusWorkspace = Awaited<
    ReturnType<typeof makeRegisteredWorkspace>
  > & {
    leaseFile: string;
    worktreeDigest: string;
    resultFile: string;
    resultSha256: string;
    reviewHead: string;
    findingsFile: string;
    prReviewDir: string;
    prReviewManifestHelperScript: string;
    prReviewLeaseHelperScript: string;
    playReviewHelper: string;
  };

  async function makeGatedStatusWorkspace(
    prefix: string,
    canonicalWorktree = false,
  ): Promise<GatedStatusWorkspace> {
    const registeredWorkspace = await makeRegisteredWorkspace(prefix);
    const workspace = canonicalWorktree
      ? await moveWorkspaceToCanonicalPath(registeredWorkspace)
      : registeredWorkspace;
    const { stdout: reviewHeadOutput } = await execFileAsync("git", [
      "-C",
      workspace.worktree,
      "rev-parse",
      "HEAD",
    ]);
    const reviewHead = reviewHeadOutput.trim();
    const helpers = requireSharedReviewHelpers();
    const resultFile = `.ephemeral/pr-432-${reviewHead}-result.json`;
    const { findingsFile } = await writeResultArtifact(
      workspace.worktree,
      workspace.physicalWorktree,
      resultFile,
      reviewHead,
      "preview-current",
      true,
    );
    const resultSha256 = await sha256File(
      path.join(workspace.worktree, resultFile),
    );
    process.chdir(workspace.physicalPrimary);
    setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
    // Command derivation has dedicated cases; status fixtures only need its
    // deterministic physical-path identity before the operation under test.
    const worktreeDigest = discoveryWorktreeDigest(workspace.physicalWorktree);
    const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
    await writeFile(
      path.join(workspace.primary, leaseFile),
      `${JSON.stringify(
        gatedCommandLease({
          leaseFile,
          worktreePath: workspace.physicalWorktree,
          worktreeDigest,
          resultFile,
          resultSha256,
        }),
        null,
        2,
      )}\n`,
    );
    return {
      ...workspace,
      leaseFile,
      worktreeDigest,
      resultFile,
      resultSha256,
      reviewHead,
      findingsFile,
      ...helpers,
    };
  }

  async function moveWorkspaceToCanonicalPath<
    T extends {
      physicalPrimary: string;
      physicalWorktree: string;
      worktree: string;
    },
  >(workspace: T): Promise<T> {
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
    return {
      ...workspace,
      worktree: canonicalWorktree,
      physicalWorktree: await realpath(canonicalWorktree),
    };
  }

  function setReadStatusEnv(workspace: GatedStatusWorkspace): void {
    setLeaseCommandEnv(workspace.physicalPrimary, workspace.physicalWorktree);
    setHelperAuthorityEnv({
      prReviewDir: workspace.prReviewDir,
      prReviewManifestHelperScript: workspace.prReviewManifestHelperScript,
      prReviewLeaseHelperScript: workspace.prReviewLeaseHelperScript,
      playReviewHelper: workspace.playReviewHelper,
    });
    process.env.LEASE_FILE = workspace.leaseFile;
    process.env.RESULT_FILE = workspace.resultFile;
    process.env.HEAD_SHA = workspace.reviewHead;
  }

  function setAuditFailureEnv(
    workspace: GatedStatusWorkspace,
    updatedAt: string,
  ): void {
    process.env.REPOSITORY = "owner/repo";
    process.env.PR_NUMBER = "432";
    process.env.PRIMARY_REPOSITORY_ROOT = workspace.physicalPrimary;
    process.env.LEASE_FILE = workspace.leaseFile;
    process.env.STATE = "failed";
    process.env.EXPECTED_STATE = "gated";
    process.env.BASE_REF = "main";
    process.env.HEAD_REF = "topic";
    process.env.UPDATED_AT = updatedAt;
    process.env.RESULT_FILE = workspace.resultFile;
    process.env.FINISHED_AT = updatedAt;
    process.env.FAILURE_PHASE = "preview-render";
    process.env.FAILURE_REASON = "audit summary render failed";
    process.env.FAILURE_RECOVERABILITY = "recoverable";
    process.env.PR_REVIEW_DIR = workspace.prReviewDir;
    process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT =
      workspace.prReviewManifestHelperScript;
    process.env.PR_REVIEW_LEASE_HELPER_SCRIPT =
      workspace.prReviewLeaseHelperScript;
    process.env.PLAY_REVIEW_HELPER = workspace.playReviewHelper;
  }

  function setHelperAuthorityEnv({
    prReviewDir,
    prReviewManifestHelperScript,
    prReviewLeaseHelperScript,
    playReviewHelper,
  }: {
    prReviewDir: string;
    prReviewManifestHelperScript: string;
    prReviewLeaseHelperScript: string;
    playReviewHelper: string;
  }): void {
    process.env.PR_REVIEW_DIR = prReviewDir;
    process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT = prReviewManifestHelperScript;
    process.env.PR_REVIEW_LEASE_HELPER_SCRIPT = prReviewLeaseHelperScript;
    process.env.PLAY_REVIEW_HELPER = playReviewHelper;
  }

  async function mutateLease(
    workspace: GatedStatusWorkspace,
    mutate: (lease: PrReviewLease) => void,
  ): Promise<void> {
    const lease = await readLease(workspace.primary, workspace.leaseFile);
    mutate(lease);
    await writeFile(
      path.join(workspace.primary, workspace.leaseFile),
      `${JSON.stringify(lease, null, 2)}\n`,
    );
  }

  async function mutateNestedFindingsWithoutUpdatingResult(
    workspace: GatedStatusWorkspace,
  ): Promise<void> {
    await writeFile(
      path.join(workspace.worktree, workspace.findingsFile),
      `${JSON.stringify(
        {
          schema: "play-review/findings/v3",
          findings: [{ stale: true }],
          carry_forward: [],
        },
        null,
        2,
      )}\n`,
    );
  }

  async function makeLeaseWorkspace(_prefix: string): Promise<{
    tempRoot: string;
    primary: string;
    worktree: string;
    physicalPrimary: string;
    physicalWorktree: string;
  }> {
    return commandHarness.createPlainReviewWorkspace();
  }

  async function makeResultAuthorityWorkspace(prefix: string): Promise<
    Awaited<ReturnType<typeof makeRegisteredWorkspace>> & {
      reviewHead: string;
      prReviewDir: string;
      prReviewManifestHelperScript: string;
      prReviewLeaseHelperScript: string;
      playReviewHelper: string;
    }
  > {
    const workspace = await makeRegisteredWorkspace(prefix);
    const { stdout } = await execFileAsync("git", [
      "-C",
      workspace.worktree,
      "rev-parse",
      "HEAD",
    ]);
    return {
      ...workspace,
      reviewHead: stdout.trim(),
      ...requireSharedReviewHelpers(),
    };
  }

  async function makeRegisteredWorkspace(prefix: string): Promise<{
    tempRoot: string;
    primary: string;
    worktree: string;
    physicalPrimary: string;
    physicalWorktree: string;
  }> {
    void prefix;
    return commandHarness.createRegisteredReviewWorkspace("review-topic");
  }

  function requireSharedReviewHelpers(): NonNullable<
    typeof sharedReviewHelpers
  > {
    if (sharedReviewHelpers === null) {
      throw new Error("shared PR-review helpers are not initialized");
    }
    return sharedReviewHelpers;
  }

  function identityFromLeaseFile(
    leaseFile: string,
    worktreePath: string,
  ): typeof identity {
    const match = /^\.ephemeral\/pr-432-([0-9a-f]{64})-lease\.json$/u.exec(
      leaseFile,
    );
    if (match === null) {
      throw new Error(`unexpected lease path: ${leaseFile}`);
    }
    return {
      ...identity,
      worktreePath,
      worktreeDigest: match[1],
      leaseFile,
    };
  }

  function discoveryWorktreeDigest(worktreePath: string): string {
    const normalized = worktreePath.replace(/\\/gu, "/");
    const comparable = /^[A-Za-z]:\//u.test(normalized)
      ? normalized.toLowerCase()
      : normalized;
    return createHash("sha256").update(comparable).digest("hex");
  }

  function abortedCommandLease(
    leaseFile: string,
    worktreePath: string,
    worktreeDigest: string,
  ): PrReviewLease {
    return {
      schema: "pr-review/lease/v1",
      repository: "owner/repo",
      pr_number: 432,
      state: "aborted",
      base_ref: "main",
      head_ref: "topic",
      worktree_path: worktreePath,
      worktree_digest: worktreeDigest,
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
  }

  async function makeTerminalAdvanceRefusalFixture({
    canonical,
  }: {
    canonical: boolean;
  }): Promise<TerminalAdvanceRefusalFixture> {
    const repository = await commandHarness.createReviewRepository();
    const worktree = canonical
      ? path.join(repository.physicalRepository, ".worktrees", "pr-432-review")
      : path.join(repository.tempRoot, "noncanonical-review");
    await mkdir(path.dirname(worktree), { recursive: true });
    const { stdout: oldHeadOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    const oldHead = oldHeadOutput.trim();
    await writeFile(
      path.join(repository.physicalRepository, ".git", "info", "exclude"),
      ".ephemeral/\n",
    );
    await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "worktree",
      "add",
      "--detach",
      worktree,
      oldHead,
    ]);
    const physicalWorktree = await realpath(worktree);
    await mkdir(path.join(physicalWorktree, ".ephemeral"), { recursive: true });
    const worktreeDigest = discoveryWorktreeDigest(physicalWorktree);
    const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
    const handoffFile = ".ephemeral/pr-432-retained-handoff.json";
    const lease = abortedCommandLease(
      leaseFile,
      physicalWorktree,
      worktreeDigest,
    );
    lease.artifacts.handoff_file = handoffFile;
    const leaseBytes = `${JSON.stringify(lease, null, 2)}\n`;
    const handoffBytes = `${JSON.stringify({ repository: "owner/repo", pr_number: 432, base_ref: "main", head_ref: "topic" })}\n`;
    await writeFile(
      path.join(repository.physicalRepository, leaseFile),
      leaseBytes,
    );
    await writeFile(path.join(physicalWorktree, handoffFile), handoffBytes);
    await writeFile(
      path.join(repository.physicalRepository, "next.txt"),
      "next\n",
    );
    await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "add",
      "next.txt",
    ]);
    await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "commit",
      "-m",
      "next head",
    ]);
    const { stdout: newHeadOutput } = await execFileAsync("git", [
      "-C",
      repository.physicalRepository,
      "rev-parse",
      "HEAD",
    ]);
    return {
      repository,
      worktree: physicalWorktree,
      oldHead,
      newHead: newHeadOutput.trim(),
      leasePath: path.join(repository.physicalRepository, leaseFile),
      leaseBytes,
      archiveName: `pr-432-${worktreeDigest}-20260611T000100-aborted-archived-lease.json`,
      handoffFile,
      handoffBytes,
    };
  }

  async function addAmbiguousTerminalCandidate(
    fixture: TerminalAdvanceRefusalFixture,
  ): Promise<void> {
    const worktree = path.join(fixture.repository.tempRoot, "second-review");
    await execFileAsync("git", [
      "-C",
      fixture.repository.physicalRepository,
      "worktree",
      "add",
      "--detach",
      worktree,
      fixture.oldHead,
    ]);
    const worktreeDigest = discoveryWorktreeDigest(worktree);
    const leaseFile = `.ephemeral/pr-432-${worktreeDigest}-lease.json`;
    await writeFile(
      path.join(fixture.repository.physicalRepository, leaseFile),
      `${JSON.stringify(
        abortedCommandLease(leaseFile, worktree, worktreeDigest),
        null,
        2,
      )}\n`,
    );
  }

  function setTerminalAdvanceEnv(primaryRoot: string, headSha: string): void {
    Object.assign(process.env, {
      REPOSITORY: "owner/repo",
      PR_NUMBER: "432",
      PRIMARY_REPOSITORY_ROOT: primaryRoot,
      HEAD_SHA: headSha,
      BASE_REF: "main",
      HEAD_REF: "topic",
      UPDATED_AT: "2026-07-31T00:00:00Z",
      ALLOW_TERMINAL_ADVANCE: "yes",
    });
  }

  async function expectTerminalAdvanceUnchanged(
    fixture: TerminalAdvanceRefusalFixture,
    result: Awaited<ReturnType<typeof runPrReviewLeasesCommand>>,
    error?: string,
    expectedLeaseBytes = fixture.leaseBytes,
    registered = true,
  ): Promise<void> {
    if (error !== undefined) {
      expect(result).toEqual({ exitCode: 1, stdout: "", stderr: `${error}\n` });
    } else {
      expect(JSON.parse(result.stdout)).toMatchObject({
        outcome: "conflict",
        reason: "discovery-not-create",
      });
    }
    await expect(readFile(fixture.leasePath, "utf8")).resolves.toBe(
      expectedLeaseBytes,
    );
    await expect(
      readdir(path.join(fixture.repository.physicalRepository, ".ephemeral")),
    ).resolves.not.toContain(fixture.archiveName);
    await expect(
      lstat(
        path.join(
          fixture.repository.physicalRepository,
          ".ephemeral/pr-432-session-create-reservation.json",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    if (!registered) return;
    const [{ stdout: head }, { stdout: registrations }] = await Promise.all([
      execFileAsync("git", ["-C", fixture.worktree, "rev-parse", "HEAD"]),
      execFileAsync("git", [
        "-C",
        fixture.repository.physicalRepository,
        "worktree",
        "list",
        "--porcelain",
      ]),
    ]);
    expect(head.trim()).toBe(fixture.oldHead);
    expect(registrations).toContain(`worktree ${fixture.worktree}\n`);
    await expect(
      readFile(path.join(fixture.worktree, fixture.handoffFile), "utf8"),
    ).resolves.toBe(fixture.handoffBytes);
  }

  function postedCommandLease({
    leaseFile,
    worktreePath,
    worktreeDigest,
    resultFile,
    resultSha256,
    approvedReviewFile,
    validatedPayloadFile = null,
  }: {
    leaseFile: string;
    worktreePath: string;
    worktreeDigest: string;
    resultFile: string;
    resultSha256: string;
    approvedReviewFile: string;
    validatedPayloadFile?: string | null;
  }): PrReviewLease {
    return {
      schema: "pr-review/lease/v1",
      repository: "owner/repo",
      pr_number: 432,
      state: "posted",
      base_ref: "main",
      head_ref: "topic",
      worktree_path: worktreePath,
      worktree_digest: worktreeDigest,
      lease_file: leaseFile,
      created_at: "2026-06-11T00:00:00Z",
      updated_at: "2026-06-11T00:03:00Z",
      artifacts: {
        handoff_file: null,
        result_file: resultFile,
        approved_review_file: approvedReviewFile,
        validated_payload_file: validatedPayloadFile,
      },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:02:00Z",
          sha256: resultSha256,
        },
      },
      presentation: {
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      },
      terminal: { finished_at: "2026-06-11T00:03:00Z", reason: null },
      failure: { phase: null, reason: null, recoverability: null },
      github: {
        github_post_attempted: true,
        github_post_result: "succeeded",
        github_posted_at: "2026-06-11T00:03:00Z",
      },
    };
  }

  async function writeReviewHelperScripts(tempRoot: string): Promise<{
    prReviewDir: string;
    prReviewManifestHelperScript: string;
    prReviewLeaseHelperScript: string;
    playReviewHelper: string;
  }> {
    const skillsRoot = path.join(tempRoot, "skills");
    const prReviewDir = path.join(skillsRoot, "pr-review");
    const prReviewScripts = path.join(prReviewDir, "scripts");
    const playReviewScripts = path.join(skillsRoot, "play-review", "scripts");
    await mkdir(prReviewScripts, { recursive: true });
    await mkdir(playReviewScripts, { recursive: true });
    const scopeHelper = path.join(prReviewScripts, "prior-thread-artifacts.sh");
    const prReviewManifestHelperScript = path.join(
      prReviewScripts,
      "review-manifests.sh",
    );
    const prReviewLeaseHelperScript = path.join(
      prReviewScripts,
      "review-leases.sh",
    );
    const playReviewHelper = path.join(
      playReviewScripts,
      "review-artifacts.sh",
    );
    const passThrough = "#!/usr/bin/env bash\nset -euo pipefail\nexit 0\n";
    const approvedReviewHelper = path.join(
      prReviewScripts,
      "approved-review-artifacts.sh",
    );
    await writeFile(scopeHelper, passThrough);
    await writeFile(prReviewManifestHelperScript, passThrough);
    await writeFile(prReviewLeaseHelperScript, passThrough);
    await writeFile(
      approvedReviewHelper,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'command_name="${1:-}"',
        'if [ "$command_name" = "inspect-approved-review-ownership" ]; then',
        '  printf \'{"review_body_file":".ephemeral/pr-%s-%s-review-body.md","review_payload_file":".ephemeral/review-topic-%s-review-payload.json"}\\n\' "$PR_NUMBER" "$HEAD_SHA" "$HEAD_SHA"',
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    await writeFile(playReviewHelper, passThrough);
    await chmod(scopeHelper, 0o755);
    await chmod(prReviewManifestHelperScript, 0o755);
    await chmod(prReviewLeaseHelperScript, 0o755);
    await chmod(approvedReviewHelper, 0o755);
    await chmod(playReviewHelper, 0o755);
    return {
      prReviewDir,
      prReviewManifestHelperScript,
      prReviewLeaseHelperScript,
      playReviewHelper,
    };
  }

  async function writeCountingReviewHelperScripts(
    tempRoot: string,
    scopeValidationLog: string,
  ): Promise<Awaited<ReturnType<typeof writeReviewHelperScripts>>> {
    const helpers = await writeReviewHelperScripts(
      path.join(tempRoot, "counting-helpers"),
    );
    const scopeHelper = path.join(
      helpers.prReviewDir,
      "scripts",
      "prior-thread-artifacts.sh",
    );
    await writeFile(
      scopeHelper,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'case "${1:-}" in',
        "  validate-scope-decision)",
        `    printf 'validate-scope-decision\\n' >> ${JSON.stringify(scopeValidationLog)}`,
        "    ;;",
        "  validate-prior-threads)",
        "    ;;",
        "  *)",
        '    echo "unexpected helper command" >&2',
        "    exit 1",
        "    ;;",
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(scopeHelper, 0o755);
    return helpers;
  }

  async function writeResultArtifact(
    worktree: string,
    physicalWorktree: string,
    resultFile: string,
    reviewHead: string,
    presentationStatus:
      | "not-presented"
      | "preview-current"
      | "edited" = "preview-current",
    includeSharedContext = false,
    findingsBranch = "review-topic",
  ): Promise<{ findingsFile: string }> {
    const handoffFile = `.ephemeral/pr-432-${reviewHead}-handoff.json`;
    const findingsFile = `.ephemeral/${findingsBranch}-${reviewHead}-findings.json`;
    const reviewBodyFile = `.ephemeral/pr-432-${reviewHead}-review-body.md`;
    const scopeDecisionFile = ".ephemeral/review-topic-scope-decision.json";
    const providerScopeEvidenceFile = `.ephemeral/review-topic-${reviewHead}-provider-scope-evidence.json`;
    const providerPrDiffRange = `${reviewHead}..${reviewHead}`;
    await writeFile(
      path.join(worktree, providerScopeEvidenceFile),
      `${JSON.stringify(
        {
          schema: "pr-review/provider-scope-evidence/v2",
          provider: "github",
          repository: "owner/repo",
          pr_number: 432,
          baseRefOid: reviewHead,
          headRefOid: reviewHead,
          provider_pr_diff_base_sha: reviewHead,
          local_review_head_sha: reviewHead,
          full_pr_diff_range: providerPrDiffRange,
          evidence_complete: true,
          digest_provenance: {
            schema: "pr-review/digest-provenance/v1",
            provider_diff: "canonical-git-diff/v1",
            local_diff: "canonical-git-diff/v1",
            provider_patches: "canonical-git-diff/v1",
            local_patches: "canonical-git-diff/v1",
          },
          provider_files: [],
          local_files: [],
          provider_diff_sha256: "0".repeat(64),
          local_diff_sha256: "0".repeat(64),
        },
        null,
        2,
      )}\n`,
    );
    const providerScopeEvidenceSha256 = await sha256File(
      path.join(worktree, providerScopeEvidenceFile),
    );
    const scopeDecision = {
      head_sha: reviewHead,
      selected_range: providerPrDiffRange,
      full_range: providerPrDiffRange,
      language_hints: [],
      mode: "initial",
      is_followup_narrow: false,
      last_reviewed_sha: null,
      selection_reason: "Initial review scope.",
      prior_context: { kind: "none", path: null },
      artifacts: {
        provider_scope_evidence_file: providerScopeEvidenceFile,
        provider_scope_evidence_sha256: providerScopeEvidenceSha256,
      },
    };
    await writeFile(
      path.join(worktree, scopeDecisionFile),
      `${JSON.stringify(scopeDecision, null, 2)}\n`,
    );
    await writeFile(
      path.join(worktree, findingsFile),
      `${JSON.stringify({ findings: [], carry_forward: [] }, null, 2)}\n`,
    );
    await writeFile(path.join(worktree, reviewBodyFile), "Review preview.\n");
    const sharedContext = includeSharedContext
      ? await writeSharedContextFamily(
          physicalWorktree,
          findingsFile,
          reviewHead,
          providerPrDiffRange,
        )
      : null;
    const handoff = {
      schema: "pr-review/handoff/v1",
      pr_number: 432,
      repository: "owner/repo",
      execution: {
        kind: "review-worktree",
        working_directory: physicalWorktree,
      },
      base_ref: "main",
      head_ref: "topic",
      review_scope_base_ref: reviewHead,
      active_diff_range: providerPrDiffRange,
      full_pr_diff_range: providerPrDiffRange,
      review_head_sha: reviewHead,
      mode: "github-post",
      language_hints: [],
      follow_up: {
        state: "initial",
        last_reviewed_sha: null,
        is_followup_narrow: false,
      },
      artifacts: {
        scope_decision_file: scopeDecisionFile,
        prior_threads_file: null,
        provider_scope_evidence_file: providerScopeEvidenceFile,
        provider_scope_evidence_sha256: providerScopeEvidenceSha256,
      },
    };
    await writeFile(
      path.join(worktree, handoffFile),
      `${JSON.stringify(handoff, null, 2)}\n`,
    );
    const result = {
      schema: "pr-review/result/v1",
      repository: "owner/repo",
      pr_number: 432,
      review_head_sha: reviewHead,
      findings_file: findingsFile,
      review_body_file: reviewBodyFile,
      context_file: sharedContext?.contextFile ?? null,
      artifacts: {
        handoff_file: handoffFile,
        scope_decision_file: scopeDecisionFile,
        prior_threads_file: null,
        rendered_preview_file: null,
        provider_scope_evidence_file: providerScopeEvidenceFile,
      },
      digests: {
        handoff_sha256: await sha256File(path.join(worktree, handoffFile)),
        findings_sha256: await sha256File(path.join(worktree, findingsFile)),
        review_body_sha256: await sha256File(
          path.join(worktree, reviewBodyFile),
        ),
        context_sha256: sharedContext?.contextSha256 ?? null,
        scope_decision_sha256: await sha256File(
          path.join(worktree, scopeDecisionFile),
        ),
        prior_threads_sha256: null,
        rendered_preview_sha256: null,
        provider_scope_evidence_sha256: providerScopeEvidenceSha256,
      },
      scope_decision: {
        summary: "Initial review scope.",
        selected_range: providerPrDiffRange,
        full_range: providerPrDiffRange,
        is_followup_narrow: false,
      },
      presentation: { status: presentationStatus, notes: null },
      validation: {
        status: "valid",
        findings_validated: true,
        scope_decision_validated: true,
      },
    };
    await writeFile(
      path.join(worktree, resultFile),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    return { findingsFile };
  }

  async function writeSharedContextFamily(
    physicalWorktree: string,
    findingsFile: string,
    reviewHead: string,
    diffRange: string,
  ): Promise<{ contextFile: string; contextSha256: string }> {
    const priorCwd = process.cwd();
    const contextEnv = [
      "HEAD_SHA",
      "FINDINGS_FILE",
      "REVIEW_CONTEXT_INPUT_FILE",
      "REVIEW_CONTEXT_INPUT_JSON",
    ] as const;
    const priorEnv = new Map(contextEnv.map((key) => [key, process.env[key]]));

    try {
      process.chdir(physicalWorktree);
      process.env.HEAD_SHA = reviewHead;
      process.env.FINDINGS_FILE = findingsFile;
      process.env.REVIEW_CONTEXT_INPUT_JSON = JSON.stringify({
        schema: "play-review/shared-context-input/v1",
        header: {
          working_directory: physicalWorktree,
          base_ref: "main",
          head_sha: reviewHead,
          active_diff_range: diffRange,
          full_pr_diff_range: diffRange,
          mode: "github-post",
          language_hints: [],
        },
        changed_files: {
          command: "fixture",
          total_count: 0,
          truncated: false,
          records: [],
        },
        doc_impact_summary: {
          arch_files: [],
          new_adrs: [],
          modified_adrs: [],
          architecture_routing_risks: {
            mechanical_path_signals: [],
            semantic_classification_notes: [],
          },
          spec_routing_risks: {
            mechanical_path_signals: [],
            semantic_classification_notes: [],
          },
          notes: "fixture",
        },
        adr_references: [],
        discovered_guidelines: { records: [] },
        output_format: { markdown: "fixture" },
        prior_review_context: null,
      });
      const input = await runPlayReviewSharedContextCommand([
        "write-review-context-input",
      ]);
      if (input.exitCode !== 0) {
        throw new Error(input.stderr);
      }
      process.env.REVIEW_CONTEXT_INPUT_FILE = input.stdout.trim();
      const output = await runPlayReviewSharedContextCommand([
        "build-review-context",
      ]);
      if (output.exitCode !== 0) {
        throw new Error(output.stderr);
      }
      const contextFile = output.stdout.trim();
      return {
        contextFile,
        contextSha256: await sha256File(
          path.join(physicalWorktree, contextFile),
        ),
      };
    } finally {
      process.chdir(priorCwd);
      for (const [key, value] of priorEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  async function writeApprovedReviewArtifact(
    worktree: string,
    approvedReviewFile: string,
    reviewHead: string,
  ): Promise<void> {
    await writeFile(
      path.join(worktree, approvedReviewFile),
      `${JSON.stringify({
        schema: "pr-review/approved-review/v1",
        review_head_sha: reviewHead,
        review_body_file: `.ephemeral/pr-432-${reviewHead}-review-body.md`,
        payload: reviewPayload(reviewHead),
      })}\n`,
    );
  }

  async function writeValidatedPayloadArtifact(
    worktree: string,
    reviewHead: string,
  ): Promise<string> {
    const validatedPayloadFile = `.ephemeral/pr-432-${reviewHead}-validated-review-payload.json`;
    await writeFile(
      path.join(worktree, validatedPayloadFile),
      `${JSON.stringify(reviewPayload(reviewHead))}\n`,
    );
    return validatedPayloadFile;
  }

  function reviewPayload(reviewHead: string): Record<string, unknown> {
    return {
      commit_id: reviewHead,
      event: "COMMENT",
      body: "Review body\n",
      comments: [],
    };
  }

  function omitKey<T extends object, K extends keyof T>(
    object: T,
    key: K,
  ): Omit<T, K> {
    const { [key]: _omitted, ...rest } = object;
    return rest;
  }

  function reviewedCommandLease(
    leaseFile: string,
    worktreePath: string,
    worktreeDigest: string,
    resultFile: string,
    resultSha256: string,
  ): PrReviewLease {
    return {
      schema: "pr-review/lease/v1",
      repository: "owner/repo",
      pr_number: 432,
      state: "reviewed",
      base_ref: "main",
      head_ref: "topic",
      worktree_path: worktreePath,
      worktree_digest: worktreeDigest,
      lease_file: leaseFile,
      created_at: "2026-06-11T00:00:00Z",
      updated_at: "2026-06-11T00:01:00Z",
      artifacts: {
        handoff_file: null,
        result_file: resultFile,
        approved_review_file: null,
        validated_payload_file: null,
      },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:01:00Z",
          sha256: resultSha256,
        },
      },
      presentation: { presented_at: null, status: null },
      terminal: { finished_at: null, reason: null },
      failure: { phase: null, reason: null, recoverability: null },
      github: {
        github_post_attempted: false,
        github_post_result: "not-attempted",
        github_posted_at: null,
      },
    };
  }

  function gatedCommandLease({
    leaseFile,
    worktreePath,
    worktreeDigest,
    resultFile,
    resultSha256,
  }: {
    leaseFile: string;
    worktreePath: string;
    worktreeDigest: string;
    resultFile: string;
    resultSha256: string;
  }): PrReviewLease {
    return {
      schema: "pr-review/lease/v1",
      repository: "owner/repo",
      pr_number: 432,
      state: "gated",
      base_ref: "main",
      head_ref: "topic",
      worktree_path: worktreePath,
      worktree_digest: worktreeDigest,
      lease_file: leaseFile,
      created_at: "2026-06-11T00:00:00Z",
      updated_at: "2026-06-11T00:02:00Z",
      artifacts: {
        handoff_file: null,
        result_file: resultFile,
        approved_review_file: null,
        validated_payload_file: null,
      },
      validation: {
        result_manifest: {
          status: "valid",
          validated_at: "2026-06-11T00:02:00Z",
          sha256: resultSha256,
        },
      },
      presentation: {
        presented_at: "2026-06-11T00:02:00Z",
        status: "preview-current",
      },
      terminal: { finished_at: null, reason: null },
      failure: { phase: null, reason: null, recoverability: null },
      github: {
        github_post_attempted: false,
        github_post_result: "not-attempted",
        github_posted_at: null,
      },
    };
  }

  async function makeAttemptRetirementFixture(
    leaves: Record<string, string> = {
      "failed-scope.json": "invalid original candidate\n",
      "validator.stderr": "original diagnostic\n",
    },
  ) {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    process.chdir(fixture.worktree);
    Object.assign(process.env, { REPOSITORY: "owner/repo", PR_NUMBER: "432" });
    const recordFile = path.join(
      fixture.repository.physicalRepository,
      ".ephemeral/original-regression.json",
    );
    const allocated = await runPrReviewProviderScopeEvidenceCommand([
      "allocate-original",
      "--record-file",
      recordFile,
    ]);
    expect(allocated.exitCode, allocated.stderr).toBe(0);
    const resource = allocated.stdout.trim();
    for (const [name, bytes] of Object.entries(leaves))
      await writeFile(path.join(fixture.worktree, resource, name), bytes);
    expect(
      (
        await runPrReviewProviderScopeEvidenceCommand([
          "seal-original",
          "--record-file",
          recordFile,
        ])
      ).exitCode,
    ).toBe(0);
    process.chdir(fixture.repository.physicalRepository);
    setTerminalAdvanceEnv(
      fixture.repository.physicalRepository,
      fixture.newHead,
    );
    const requestFile = path.join(
      fixture.repository.physicalRepository,
      ".ephemeral/retirement-request.json",
    );
    await writeFile(
      requestFile,
      JSON.stringify({
        schema: "pr-review/attempt-retirement/v1",
        repository: "owner/repo",
        pr_number: 432,
        worktree_path: fixture.worktree,
        old_head: fixture.oldHead,
        lease_file: path.relative(
          fixture.repository.physicalRepository,
          fixture.leasePath,
        ),
        original_records: [
          { file: recordFile, sha256: await sha256File(recordFile) },
        ],
        authority_ref: "original-owner/correction",
        active_consumers: [],
        pending_effects: [],
        publication: { status: "not-required", references: [] },
      }),
    );
    return { ...fixture, recordFile, requestFile, resource };
  }

  async function writeContinuationRequest(
    fixture: {
      repository: { physicalRepository: string };
      leasePath: string;
      worktree: string;
      oldHead: string;
      newHead: string;
    },
    baseline: "completed" | "incomplete",
  ) {
    process.chdir(fixture.repository.physicalRepository);
    setTerminalAdvanceEnv(
      fixture.repository.physicalRepository,
      fixture.newHead,
    );
    const providerFile = path.join(
      fixture.repository.physicalRepository,
      ".ephemeral/current-provider-head.json",
    );
    await writeFile(
      providerFile,
      JSON.stringify({
        repository: "owner/repo",
        pr_number: 432,
        headRefOid: fixture.newHead,
      }),
    );
    const requestFile = path.join(
      fixture.repository.physicalRepository,
      ".ephemeral/continuation-request.json",
    );
    await writeFile(
      requestFile,
      JSON.stringify({
        schema: "pr-review/attempt-continuation/v1",
        repository: "owner/repo",
        pr_number: 432,
        worktree_path: fixture.worktree,
        old_head: fixture.oldHead,
        target_head: fixture.newHead,
        lease_file: path.relative(
          fixture.repository.physicalRepository,
          fixture.leasePath,
        ),
        lease_sha256: await sha256File(fixture.leasePath),
        authority_ref: "current-correction",
        active_consumers: [],
        pending_effects: [],
        publication: { status: "not-required", references: [] },
        provider_evidence: {
          file: providerFile,
          sha256: await sha256File(providerFile),
        },
        baseline,
        continuity: [],
      }),
    );
    process.env.CONTINUATION_REQUEST_FILE = requestFile;
  }

  async function makeEnrolledRetirementFixture(
    outcome: "posted" | "aborted" | "post-failed" | "reviewed",
    replayLifecycle = false,
  ) {
    const workspace = await makeGatedStatusWorkspace(
      "enrolled-retirement",
      true,
    );
    await writeFile(
      path.join(workspace.physicalPrimary, ".git/info/exclude"),
      ".ephemeral/\n.worktrees/\n",
    );
    const resultPath = path.join(workspace.worktree, workspace.resultFile);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    const handoffFile = result.artifacts.handoff_file;
    const scopeFile = result.artifacts.scope_decision_file;
    const scope = JSON.parse(
      await readFile(path.join(workspace.worktree, scopeFile), "utf8"),
    );
    scope.semantic_decision = {
      checked: true,
      ambiguous: false,
      notes: "Original reviewer verified this unchanged scope.",
    };
    await writeFile(
      path.join(workspace.worktree, scopeFile),
      JSON.stringify(scope),
    );
    result.digests.scope_decision_sha256 = await sha256File(
      path.join(workspace.worktree, scopeFile),
    );
    await writeFile(resultPath, JSON.stringify(result));
    process.chdir(workspace.worktree);
    Object.assign(process.env, { REPOSITORY: "owner/repo", PR_NUMBER: "432" });
    const recordFile = path.join(
      workspace.physicalPrimary,
      ".ephemeral/enrolled-original.json",
    );
    const allocation = await runPrReviewProviderScopeEvidenceCommand([
      "allocate-original",
      "--record-file",
      recordFile,
    ]);
    expect(allocation.exitCode, allocation.stderr).toBe(0);
    const resource = allocation.stdout.trim();
    const failedScope = {
      ...scope,
      semantic_decision: { ...scope.semantic_decision, checked: false },
    };
    await writeFile(
      path.join(workspace.worktree, resource, "failed-scope.json"),
      JSON.stringify(failedScope),
    );
    await writeFile(
      path.join(workspace.worktree, resource, "validator.stderr"),
      "semantic decision must be checked\n",
    );
    const sealed = await runPrReviewProviderScopeEvidenceCommand([
      "seal-original",
      "--record-file",
      recordFile,
    ]);
    expect(sealed.exitCode, sealed.stderr).toBe(0);
    process.chdir(workspace.physicalPrimary);
    setReadStatusEnv(workspace);
    const approvedFile = `.ephemeral/topic-${workspace.reviewHead}-approved-review.json`;
    const payloadFile = `.ephemeral/review-topic-${workspace.reviewHead}-review-payload.json`;
    const validatedFile = `.ephemeral/pr-432-${workspace.reviewHead}-validated-review-payload.json`;
    if (outcome === "posted" || outcome === "post-failed") {
      await writeApprovedReviewArtifact(
        workspace.worktree,
        approvedFile,
        workspace.reviewHead,
      );
      await writeFile(
        path.join(workspace.worktree, payloadFile),
        JSON.stringify(reviewPayload(workspace.reviewHead)),
      );
      expect(
        await writeValidatedPayloadArtifact(
          workspace.worktree,
          workspace.reviewHead,
        ),
      ).toBe(validatedFile);
    }
    // The successful-posting retirement test retains the complete command-driven
    // enrollment/lifecycle proof. Other retirement cases need the same starting
    // evidence, not another replay of those already-covered transitions.
    if (replayLifecycle) {
      expect(outcome).toBe("posted");
      await fsPromises.rm(
        path.join(workspace.physicalPrimary, workspace.leaseFile),
      );
      for (const key of [
        "RESULT_FILE",
        "APPROVED_REVIEW_FILE",
        "VALIDATED_REVIEW_PAYLOAD_FILE",
        "PRESENTED_AT",
        "PRESENTATION_STATUS",
        "GITHUB_POST_ATTEMPTED",
        "GITHUB_POST_RESULT",
        "GITHUB_POSTED_AT",
      ] as const)
        unsetEnv(key);
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:00:00Z",
      });
      Object.assign(process.env, {
        EXPECTED_STATE: "created",
        FAILURE_PHASE: "handoff-validation",
        FAILURE_REASON: "original scope candidate rejected",
        FAILURE_RECOVERABILITY: "recoverable",
        FINISHED_AT: "2026-06-11T00:00:30Z",
      });
      await writeLeaseCommandState({
        state: "failed",
        updatedAt: "2026-06-11T00:00:30Z",
      });
      Object.assign(process.env, {
        EXPECTED_STATE: "failed",
        HANDOFF_FILE: handoffFile,
        HEAD_SHA: workspace.reviewHead,
        PREPARATION_FAILURE_DIRS: JSON.stringify([resource]),
      });
      await writeLeaseCommandState({
        state: "created",
        updatedAt: "2026-06-11T00:01:00Z",
      });
      unsetEnv("PREPARATION_FAILURE_DIRS");
      Object.assign(process.env, {
        EXPECTED_STATE: "created",
        RESULT_FILE: workspace.resultFile,
      });
      await writeLeaseCommandState({
        state: "reviewed",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      Object.assign(process.env, {
        EXPECTED_STATE: "reviewed",
        PRESENTATION_STATUS: "preview-current",
        PRESENTED_AT: "2026-06-11T00:02:00Z",
      });
      await writeLeaseCommandState({
        state: "gated",
        updatedAt: "2026-06-11T00:02:00Z",
      });
      Object.assign(process.env, {
        EXPECTED_STATE: "gated",
        APPROVED_REVIEW_FILE: approvedFile,
        VALIDATED_REVIEW_PAYLOAD_FILE: validatedFile,
        GITHUB_POST_ATTEMPTED: "true",
        GITHUB_POST_RESULT: "succeeded",
        GITHUB_POSTED_AT: "2026-06-11T00:03:00Z",
        FINISHED_AT: "2026-06-11T00:03:00Z",
      });
      await writeLeaseCommandState({
        state: "posted",
        updatedAt: "2026-06-11T00:03:00Z",
      });
    } else {
      const bindings = {
        leaseFile: workspace.leaseFile,
        worktreePath: workspace.physicalWorktree,
        worktreeDigest: workspace.worktreeDigest,
        resultFile: workspace.resultFile,
        resultSha256: await sha256File(resultPath),
      };
      const lease =
        outcome === "posted" || outcome === "post-failed"
          ? postedCommandLease({
              ...bindings,
              approvedReviewFile: approvedFile,
              validatedPayloadFile: validatedFile,
            })
          : outcome === "reviewed"
            ? reviewedCommandLease(
                bindings.leaseFile,
                bindings.worktreePath,
                bindings.worktreeDigest,
                bindings.resultFile,
                bindings.resultSha256,
              )
            : gatedCommandLease(bindings);
      if (outcome === "reviewed") {
        lease.updated_at = "2026-06-11T00:02:00Z";
        lease.validation.result_manifest.validated_at = lease.updated_at;
      } else if (outcome === "aborted") {
        lease.state = "aborted";
        lease.updated_at = "2026-06-11T00:03:00Z";
        lease.terminal = {
          finished_at: lease.updated_at,
          reason: "explicitly abandoned fixture review",
        };
      } else if (outcome === "post-failed") {
        lease.state = "failed";
        lease.github.github_post_result = "failed";
        lease.github.github_posted_at = null;
        lease.failure = {
          phase: "github-post",
          reason: "posting outcome requires reconciliation",
          recoverability: "unknown",
        };
      }
      lease.artifacts.handoff_file = handoffFile;
      lease.preparation_failures = [
        {
          directory: resource,
          scope_sha256: await sha256File(
            path.join(workspace.worktree, resource, "failed-scope.json"),
          ),
          diagnostics_sha256: await sha256File(
            path.join(workspace.worktree, resource, "validator.stderr"),
          ),
        },
      ];
      await writeFile(
        path.join(workspace.physicalPrimary, workspace.leaseFile),
        `${JSON.stringify(lease, null, 2)}\n`,
      );
    }
    const requestFile = path.join(
      workspace.physicalPrimary,
      ".ephemeral/enrolled-retirement-request.json",
    );
    await writeFile(
      requestFile,
      JSON.stringify({
        schema: "pr-review/attempt-retirement/v1",
        repository: "owner/repo",
        pr_number: 432,
        worktree_path: workspace.worktree,
        old_head: workspace.reviewHead,
        lease_file: workspace.leaseFile,
        original_records: [
          { file: recordFile, sha256: await sha256File(recordFile) },
        ],
        authority_ref: "original-owner/covered-cleanup",
        active_consumers: [],
        pending_effects: [],
        publication: { status: "not-required", references: [] },
      }),
    );
    return { ...workspace, resource, recordFile, requestFile };
  }

  async function makeIncompleteContinuationFixture() {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    const lease = JSON.parse(fixture.leaseBytes);
    lease.state = "failed";
    lease.terminal.reason = null;
    lease.failure = {
      phase: "review",
      reason: "incomplete route",
      recoverability: "recoverable",
    };
    await writeFile(fixture.leasePath, `${JSON.stringify(lease, null, 2)}\n`);
    await writeContinuationRequest(fixture, "incomplete");
    return fixture;
  }

  async function makeGuardedScratchCleanupFixture(family = false) {
    const fixture = await makeTerminalAdvanceRefusalFixture({
      canonical: true,
    });
    const primary = fixture.repository.physicalRepository;
    const resource = ".ephemeral/provider-scope-capture.existing-owner";
    const directory = path.join(fixture.worktree, resource);
    await mkdir(directory);
    await writeFile(
      path.join(directory, "failed-scope.json"),
      "original never-accepted bytes\n",
    );
    await writeFile(
      path.join(directory, "validator.stderr"),
      "original diagnostic\n",
    );
    const stat = await fsPromises.lstat(directory);
    const entries = [];
    for (const name of (await readdir(directory)).sort()) {
      const leaf = await fsPromises.lstat(path.join(directory, name));
      entries.push({
        name,
        dev: leaf.dev,
        ino: leaf.ino,
        sha256: await sha256File(path.join(directory, name)),
      });
    }
    const requestFile = path.join(
      primary,
      ".ephemeral/guarded-scratch-request.json",
    );
    await writeFile(
      requestFile,
      JSON.stringify({
        schema: "pr-review/provider-scope-cleanup/v1",
        repository: "owner/repo",
        pr_number: 432,
        worktree_path: fixture.worktree,
        old_head: fixture.oldHead,
        lease_file: path.relative(primary, fixture.leasePath),
        expected_scratch: [{ resource, dev: stat.dev, ino: stat.ino, entries }],
        authority_ref: "fixture-owner/covered-cleanup",
        active_consumers: [],
        pending_effects: [],
        publication: { status: "not-required", references: [] },
      }),
    );
    const resources = [resource];
    if (family) {
      const second = `${resource}-second`;
      const secondDirectory = path.join(fixture.worktree, second);
      await mkdir(secondDirectory);
      for (const name of ["failed-scope.json", "validator.stderr"])
        await writeFile(
          path.join(secondDirectory, name),
          await readFile(path.join(directory, name)),
        );
      const snapshot = {
        resource: second,
        ...(await fsPromises.lstat(secondDirectory)),
        entries: [] as {
          name: string;
          sha256: string;
          dev: number;
          ino: number;
        }[],
      };
      for (const name of (await readdir(secondDirectory)).sort()) {
        const leaf = await fsPromises.lstat(path.join(secondDirectory, name));
        snapshot.entries.push({
          name,
          sha256: await sha256File(path.join(secondDirectory, name)),
          dev: leaf.dev,
          ino: leaf.ino,
        });
      }
      const request = JSON.parse(await readFile(requestFile, "utf8"));
      request.expected_scratch.push({
        resource: second,
        dev: snapshot.dev,
        ino: snapshot.ino,
        entries: snapshot.entries,
      });
      await writeFile(requestFile, JSON.stringify(request));
      resources.push(second);
    }
    process.chdir(primary);
    setTerminalAdvanceEnv(primary, fixture.newHead);
    return { ...fixture, primary, resource, resources, requestFile };
  }
  return {
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
    makeTerminalAdvanceRefusalFixture,
    setTerminalAdvanceEnv,
    expectTerminalAdvanceUnchanged,
    makeAttemptRetirementFixture,
    writeContinuationRequest,
    makeEnrolledRetirementFixture,
    makeIncompleteContinuationFixture,
    makeGuardedScratchCleanupFixture,
    addAmbiguousTerminalCandidate,
  };
}
