import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
import { requireDirectEphemeralChild } from "./paths.js";

const execFileAsync = promisify(execFile);

type RuntimeCommandOutcome =
  | { exitCode: 0; stdout: string; stderr: string }
  | { exitCode: 1; stdout: string; stderr: string };

type LeaseState =
  | "created"
  | "reviewed"
  | "gated"
  | "posted"
  | "aborted"
  | "failed";

type GitHubPostResult = "succeeded" | "failed" | "not-attempted";
type PresentationStatus = "preview-current" | "edited";
type Recoverability = "recoverable" | "unrecoverable" | "unknown";
type FailurePhase =
  | "handoff-validation"
  | "review"
  | "result-validation"
  | "preview-render"
  | "approval-freeze"
  | "stale-head"
  | "github-post";
type ValidationStatus = "valid" | null;

export interface PrReviewLease {
  schema: "pr-review/lease/v1";
  repository: string;
  pr_number: number;
  state: LeaseState;
  base_ref: string;
  head_ref: string;
  worktree_path: string;
  worktree_digest: string;
  lease_file: string;
  created_at: string;
  updated_at: string;
  artifacts: {
    handoff_file: string | null;
    result_file: string | null;
    approved_review_file: string | null;
    validated_payload_file: string | null;
  };
  validation: {
    result_manifest: {
      status: ValidationStatus;
      validated_at: string | null;
    };
  };
  presentation: {
    presented_at: string | null;
    status: PresentationStatus | null;
  };
  terminal: {
    finished_at: string | null;
    reason: string | null;
  };
  failure: {
    phase: FailurePhase | null;
    reason: string | null;
    recoverability: Recoverability | null;
  };
  github: {
    github_post_attempted: boolean;
    github_post_result: GitHubPostResult;
    github_posted_at: string | null;
  };
  cleanup?: {
    last_outcome: "removed" | "retained" | "skipped" | "failed" | null;
    last_checked_at: string | null;
  };
}

interface LeaseIdentity {
  repository: string;
  prNumber: number;
  primaryRoot: string;
  worktreePath: string;
  worktreeDigest: string;
  leaseFile: string;
}

interface CleanupIdentity extends LeaseIdentity {
  worktreeExists: boolean;
}

interface LeaseInputs {
  state: LeaseState;
  baseRef: string;
  headRef: string;
  createdAt: string;
  updatedAt: string;
  handoffFile?: string;
  resultFile?: string;
  approvedReviewFile?: string;
  validatedPayloadFile?: string;
  presentedAt?: string;
  presentationStatus?: PresentationStatus;
  finishedAt?: string;
  terminalReason?: string;
  failurePhase?: FailurePhase;
  failureReason?: string;
  failureRecoverability?: Recoverability;
  githubPostAttempted?: boolean;
  githubPostResult?: GitHubPostResult;
  githubPostedAt?: string;
  expectedState?: LeaseState;
}

const SHA_RE = /^[0-9a-f]{40}$/u;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const DIRECT_SUFFIXES = {
  handoff: "-handoff.json",
  result: "-result.json",
  approved: "-approved-review.json",
  payload: "-validated-review-payload.json",
  lease: "-lease.json",
} as const;

export async function runPrReviewLeasesCommand(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  try {
    const [commandName] = args;
    switch (commandName) {
      case "derive-path":
        return ok(`${(await readIdentity(false)).leaseFile}\n`);
      case "write":
        return ok(`${await writeLease()}\n`);
      case "validate":
        await validateLeaseCommand();
        return ok("");
      case "inspect-worktree":
        return ok(await inspectWorktree());
      case "cleanup-worktree":
        return ok(await cleanupWorktree());
      default:
        throw new PrReviewLeaseError(
          "usage: review-leases.sh derive-path|write|validate|inspect-worktree|cleanup-worktree",
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
}

interface CleanupDecision {
  canRemove: boolean;
  refusalReason: string;
  dirty: boolean;
  leaseState: LeaseState | "";
  identityMatch: boolean;
  requiresConfirmation: boolean;
  metadataOutcome: "" | "removed" | "retained" | "skipped" | "failed";
  forceRemoveAllowed: boolean;
  message: string;
}

export function reducePrReviewLease(
  previous: PrReviewLease | null,
  identity: Omit<LeaseIdentity, "primaryRoot">,
  inputs: LeaseInputs,
): PrReviewLease {
  const previousState = previous?.state ?? "none";
  const row = transitionId(previous, inputs);
  if (row === null) {
    throw invalidTransition(previousState, inputs.state);
  }
  if (
    inputs.expectedState !== undefined &&
    inputs.expectedState !== previous?.state
  ) {
    throw new PrReviewLeaseError(
      `EXPECTED_STATE mismatch: ${previous?.state ?? "none"}`,
    );
  }

  const base = buildBaseLease(previous, identity, inputs, row);
  switch (row) {
    case "LC-01":
    case "LC-18":
      return base;
    case "LC-02":
      requireInput("HANDOFF_FILE", inputs.handoffFile);
      if (previous?.artifacts.handoff_file !== null) {
        throw invalidTransition("created", "created");
      }
      return {
        ...base,
        artifacts: { ...base.artifacts, handoff_file: inputs.handoffFile },
      };
    case "LC-03":
      requireInput("RESULT_FILE", inputs.resultFile);
      return {
        ...base,
        state: "reviewed",
        artifacts: {
          ...base.artifacts,
          handoff_file:
            inputs.handoffFile ?? previous?.artifacts.handoff_file ?? null,
          result_file: inputs.resultFile,
        },
        validation: validResultValidation(inputs.updatedAt),
      };
    case "LC-04":
    case "LC-14":
      return applyGated(base, previous, inputs);
    case "LC-05":
      if (
        inputs.resultFile === undefined &&
        inputs.presentedAt === undefined &&
        inputs.presentationStatus === undefined
      ) {
        throw invalidTransition("gated", "gated");
      }
      return applyGated(base, previous, inputs);
    case "LC-06":
    case "LC-07":
    case "LC-15":
      requireInput("FINISHED_AT", inputs.finishedAt);
      requireInput("TERMINAL_REASON", inputs.terminalReason);
      return {
        ...base,
        state: "aborted",
        artifacts: {
          ...base.artifacts,
          handoff_file: previous?.artifacts.handoff_file ?? null,
          result_file: previous?.artifacts.result_file ?? null,
        },
        validation: previous?.validation ?? emptyValidation(),
        presentation:
          row === "LC-07"
            ? (previous?.presentation ?? emptyPresentation())
            : emptyPresentation(),
        terminal: {
          finished_at: inputs.finishedAt,
          reason: inputs.terminalReason,
        },
      };
    case "LC-08":
      requireInput("APPROVED_REVIEW_FILE", inputs.approvedReviewFile);
      requireInput("FINISHED_AT", inputs.finishedAt);
      requireInput("GITHUB_POSTED_AT", inputs.githubPostedAt);
      return {
        ...base,
        state: "posted",
        artifacts: {
          ...base.artifacts,
          handoff_file: previous?.artifacts.handoff_file ?? null,
          result_file: previous?.artifacts.result_file ?? null,
          approved_review_file: inputs.approvedReviewFile,
          validated_payload_file: inputs.validatedPayloadFile ?? null,
        },
        validation: previous?.validation ?? emptyValidation(),
        presentation: previous?.presentation ?? emptyPresentation(),
        terminal: { finished_at: inputs.finishedAt, reason: null },
        github: {
          github_post_attempted: true,
          github_post_result: "succeeded",
          github_posted_at: inputs.githubPostedAt,
        },
      };
    case "LC-09":
    case "LC-10":
    case "LC-11":
    case "LC-12":
    case "LC-13":
    case "LC-16":
      return applyFailure(row, base, previous, inputs);
    case "LC-17":
      requireInput("FINISHED_AT", inputs.finishedAt);
      requireInput("GITHUB_POSTED_AT", inputs.githubPostedAt);
      if (previous?.failure.phase !== "github-post") {
        throw new PrReviewLeaseError(
          "invalid lease transition: failed -> posted requires github-post failure",
        );
      }
      if (
        inputs.approvedReviewFile !== undefined &&
        inputs.approvedReviewFile !== previous.artifacts.approved_review_file
      ) {
        throw new PrReviewLeaseError(
          "APPROVED_REVIEW_FILE must match existing failed approved-review",
        );
      }
      return {
        ...base,
        state: "posted",
        artifacts: previous.artifacts,
        validation: previous.validation,
        presentation: previous.presentation,
        terminal: { finished_at: inputs.finishedAt, reason: null },
        github: {
          github_post_attempted: true,
          github_post_result: "succeeded",
          github_posted_at: inputs.githubPostedAt,
        },
      };
  }
}

async function writeLease(): Promise<string> {
  const identity = await readIdentity(true);
  const inputs = readInputs();
  const previous = await readExistingLease(identity.leaseFile);
  const archive = archivePathIfNeeded(previous, identity, inputs);
  const reduced = reducePrReviewLease(previous, identity, inputs);

  validateLeaseShape(reduced);
  await validateReferencedArtifacts(reduced, identity.worktreePath);
  await assertWritableDirectChild(
    identity.primaryRoot,
    identity.leaseFile,
    "lease",
  );

  const target = path.join(identity.primaryRoot, identity.leaseFile);
  const content = `${JSON.stringify(reduced, null, 2)}\n`;
  if (archive !== null) {
    await assertWritableDirectChild(
      identity.primaryRoot,
      archive,
      "archived lease",
    );
    await rename(target, path.join(identity.primaryRoot, archive));
  }
  await writeTextAtomically(target, content);
  return identity.leaseFile;
}

async function validateLeaseCommand(): Promise<void> {
  const identity = await readIdentity(true);
  const lease = await readRequiredJson<PrReviewLease>(
    identity.primaryRoot,
    identity.leaseFile,
    "lease file",
  );
  const normalizedLease = normalizeLegacyLease(lease);
  validateLeaseShape(normalizedLease);
  if (normalizedLease.repository !== identity.repository) {
    throw new PrReviewLeaseError("lease repository mismatch");
  }
  if (normalizedLease.pr_number !== identity.prNumber) {
    throw new PrReviewLeaseError("lease PR number mismatch");
  }
  if (normalizedLease.worktree_path !== identity.worktreePath) {
    throw new PrReviewLeaseError("lease worktree path mismatch");
  }
  if (normalizedLease.worktree_digest !== identity.worktreeDigest) {
    throw new PrReviewLeaseError("lease worktree digest mismatch");
  }
  if (normalizedLease.lease_file !== identity.leaseFile) {
    throw new PrReviewLeaseError("lease file identity mismatch");
  }
  await validateReferencedArtifacts(normalizedLease, identity.worktreePath);
}

async function inspectWorktree(): Promise<string> {
  const identity = await readCleanupIdentity();
  const decision = await classifyCleanup(identity);
  if (decision.identityMatch && decision.leaseState !== "") {
    await recordCleanupMetadata(identity, decision.leaseState, "");
  }
  return cleanupOutput("inspect", decision);
}

async function cleanupWorktree(): Promise<string> {
  const identity = await readCleanupIdentity();
  const decision = await classifyCleanup(identity);
  if (!decision.canRemove) {
    const outcome =
      decision.metadataOutcome === "skipped" ? "skipped" : "retained";
    if (decision.identityMatch && decision.leaseState !== "") {
      await recordCleanupMetadata(identity, decision.leaseState, outcome);
      decision.metadataOutcome = outcome;
    }
    return cleanupOutput(outcome, decision);
  }

  try {
    if (decision.identityMatch && decision.leaseState !== "") {
      await recordCleanupMetadata(identity, decision.leaseState, "removed");
      decision.metadataOutcome = "removed";
    }
    const args = ["-C", identity.primaryRoot, "worktree", "remove"];
    if (decision.forceRemoveAllowed) {
      args.push("-f");
    }
    args.push(identity.worktreePath);
    await execFileAsync("git", args);
    return cleanupOutput("removed", {
      ...decision,
      metadataOutcome: "removed",
      message: "worktree removed",
    });
  } catch {
    if (decision.identityMatch && decision.leaseState !== "") {
      await recordCleanupMetadata(identity, decision.leaseState, "failed");
    }
    return cleanupOutput("failed", {
      ...decision,
      metadataOutcome: "failed",
      message: "git worktree remove failed",
    });
  }
}

async function classifyCleanup(
  identity: CleanupIdentity,
): Promise<CleanupDecision> {
  const base: CleanupDecision = {
    canRemove: false,
    refusalReason: "",
    dirty: false,
    leaseState: "",
    identityMatch: false,
    requiresConfirmation: false,
    metadataOutcome: "",
    forceRemoveAllowed: false,
    message: "worktree retained",
  };
  let lease: PrReviewLease;
  try {
    lease = normalizeLegacyLease(
      await readRequiredJson<PrReviewLease>(
        identity.primaryRoot,
        identity.leaseFile,
        "lease file",
      ),
    );
    validateLeaseShape(lease);
    base.leaseState = lease.state;
    base.identityMatch =
      lease.repository === identity.repository &&
      lease.pr_number === identity.prNumber &&
      lease.worktree_path === identity.worktreePath &&
      lease.worktree_digest === identity.worktreeDigest &&
      lease.lease_file === identity.leaseFile;
    if (!base.identityMatch) {
      return {
        ...base,
        refusalReason: "identity-mismatch",
        message: "lease identity mismatch",
      };
    }
    if (!identity.worktreeExists) {
      return {
        ...base,
        refusalReason: "missing-worktree",
        metadataOutcome: "skipped",
        message: "worktree path is missing",
      };
    }
    if (
      !(await isRegisteredWorktree(identity.primaryRoot, identity.worktreePath))
    ) {
      return {
        ...base,
        refusalReason: "not-registered-worktree",
        metadataOutcome: "skipped",
        message: "worktree path is not registered for the primary repository",
      };
    }
    await validateReferencedArtifacts(lease, identity.worktreePath);
    const unmanagedArtifacts = await findUnmanagedEphemeralArtifacts(
      lease,
      identity.worktreePath,
    );
    if (unmanagedArtifacts.length > 0) {
      return {
        ...base,
        refusalReason: "unmanaged-ephemeral-artifacts",
        message: `unmanaged .ephemeral artifacts: ${unmanagedArtifacts.join(", ")}`,
      };
    }
  } catch {
    return {
      ...base,
      refusalReason: "invalid-lease",
      message: "lease is invalid; preserving worktree",
    };
  }

  base.dirty = await isWorktreeDirty(identity.worktreePath);
  if (base.dirty) {
    return {
      ...base,
      refusalReason: "dirty",
      message: "worktree has local changes",
    };
  }

  base.requiresConfirmation = !["posted", "aborted"].includes(lease.state);
  const override = optionalEnv("ALLOW_POLICY_OVERRIDE") === "yes";
  if (base.requiresConfirmation && !override) {
    return {
      ...base,
      refusalReason: "confirmation-required",
      message: "cleanup requires explicit confirmation",
    };
  }

  return {
    ...base,
    canRemove: true,
    forceRemoveAllowed: true,
    message: "worktree can be removed",
  };
}

async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", worktreePath, "status", "--porcelain"],
      { maxBuffer: 1024 * 1024 },
    );
    return stdout.length > 0;
  } catch {
    return true;
  }
}

async function recordCleanupMetadata(
  identity: LeaseIdentity,
  state: LeaseState,
  outcome: "" | "removed" | "retained" | "skipped" | "failed",
): Promise<void> {
  const lease = await readRequiredJson<PrReviewLease>(
    identity.primaryRoot,
    identity.leaseFile,
    "lease file",
  );
  const next: PrReviewLease = {
    ...lease,
    cleanup: {
      last_outcome:
        outcome === "" ? (lease.cleanup?.last_outcome ?? null) : outcome,
      last_checked_at: nowTimestamp(),
    },
  };
  validateLeaseShape(next);
  await writeTextAtomically(
    path.join(identity.primaryRoot, identity.leaseFile),
    `${JSON.stringify(next, null, 2)}\n`,
  );
  if (state !== lease.state) {
    throw new PrReviewLeaseError(
      "lease state changed during cleanup metadata write",
    );
  }
}

function cleanupOutput(
  outcome: "inspect" | "removed" | "retained" | "skipped" | "failed",
  decision: CleanupDecision,
): string {
  return [
    `OUTCOME=${outcome}`,
    `CAN_REMOVE=${decision.canRemove ? "yes" : "no"}`,
    `REFUSAL_REASON=${decision.refusalReason}`,
    `DIRTY=${decision.dirty ? "yes" : "no"}`,
    `LEASE_STATE=${decision.leaseState}`,
    `IDENTITY_MATCH=${decision.identityMatch ? "yes" : "no"}`,
    `REQUIRES_CONFIRMATION=${decision.requiresConfirmation ? "yes" : "no"}`,
    `METADATA_OUTCOME=${decision.metadataOutcome}`,
    `FORCE_REMOVE_ALLOWED=${decision.forceRemoveAllowed ? "yes" : "no"}`,
    `MESSAGE=${decision.message}`,
    "",
  ].join("\n");
}

async function readIdentity(requireLeaseFile: boolean): Promise<LeaseIdentity> {
  const repository = requiredEnv("REPOSITORY");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new PrReviewLeaseError("REPOSITORY must be owner/name");
  }
  const prNumber = parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
  const primaryRoot = await realpath(requiredEnv("PRIMARY_REPOSITORY_ROOT"));
  const cwd = await realpath(process.cwd());
  if (primaryRoot !== cwd) {
    throw new PrReviewLeaseError(
      "PRIMARY_REPOSITORY_ROOT must match the primary repository root",
    );
  }
  const worktreePath = await realpath(requiredEnv("WORKTREE_PATH"));
  if (worktreePath === primaryRoot) {
    throw new PrReviewLeaseError(
      "WORKTREE_PATH must be a review worktree, not the primary repository root",
    );
  }
  const worktreeDigest = digestPath(worktreePath);
  const expected = `.ephemeral/pr-${prNumber}-${worktreeDigest}-lease.json`;
  const leaseFile = process.env.LEASE_FILE ?? expected;
  if (requireLeaseFile && process.env.LEASE_FILE === undefined) {
    throw new PrReviewLeaseError("LEASE_FILE is required");
  }
  validateDirectChild("lease", leaseFile, DIRECT_SUFFIXES.lease);
  if (leaseFile !== expected) {
    throw new PrReviewLeaseError(`lease path mismatch: ${leaseFile}`);
  }
  return {
    repository,
    prNumber,
    primaryRoot,
    worktreePath,
    worktreeDigest,
    leaseFile,
  };
}

async function readCleanupIdentity(): Promise<CleanupIdentity> {
  const repository = requiredEnv("REPOSITORY");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new PrReviewLeaseError("REPOSITORY must be owner/name");
  }
  const prNumber = parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
  const primaryRoot = await realpath(requiredEnv("PRIMARY_REPOSITORY_ROOT"));
  const cwd = await realpath(process.cwd());
  if (primaryRoot !== cwd) {
    throw new PrReviewLeaseError(
      "PRIMARY_REPOSITORY_ROOT must match the primary repository root",
    );
  }
  const resolvedWorktree = await resolveWorktreePathForCleanup(
    requiredEnv("WORKTREE_PATH"),
  );
  if (resolvedWorktree.path === primaryRoot) {
    throw new PrReviewLeaseError(
      "WORKTREE_PATH must be a review worktree, not the primary repository root",
    );
  }
  const worktreeDigest = digestPath(resolvedWorktree.path);
  const expected = `.ephemeral/pr-${prNumber}-${worktreeDigest}-lease.json`;
  const leaseFile = requiredEnv("LEASE_FILE");
  validateDirectChild("lease", leaseFile, DIRECT_SUFFIXES.lease);
  if (leaseFile !== expected) {
    throw new PrReviewLeaseError(`lease path mismatch: ${leaseFile}`);
  }
  return {
    repository,
    prNumber,
    primaryRoot,
    worktreePath: resolvedWorktree.path,
    worktreeDigest,
    leaseFile,
    worktreeExists: resolvedWorktree.exists,
  };
}

async function resolveWorktreePathForCleanup(
  worktreePath: string,
): Promise<{ path: string; exists: boolean }> {
  try {
    return { path: await realpath(worktreePath), exists: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw err;
    }
    return { path: path.resolve(worktreePath), exists: false };
  }
}

async function isRegisteredWorktree(
  primaryRoot: string,
  worktreePath: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", primaryRoot, "worktree", "list", "--porcelain", "-z"],
      { maxBuffer: 1024 * 1024 },
    );
    const expected = normalizeComparablePath(worktreePath);
    return stdout
      .split("\0")
      .filter((entry) => entry.startsWith("worktree "))
      .some((entry) => normalizeComparablePath(entry.slice(9)) === expected);
  } catch {
    return false;
  }
}

function readInputs(): LeaseInputs {
  return {
    state: parseState(requiredEnv("STATE")),
    baseRef: requiredEnv("BASE_REF"),
    headRef: requiredEnv("HEAD_REF"),
    createdAt: process.env.CREATED_AT ?? process.env.UPDATED_AT ?? "",
    updatedAt: requiredEnv("UPDATED_AT"),
    handoffFile: optionalEnv("HANDOFF_FILE"),
    resultFile: optionalEnv("RESULT_FILE"),
    approvedReviewFile: optionalEnv("APPROVED_REVIEW_FILE"),
    validatedPayloadFile:
      optionalEnv("VALIDATED_REVIEW_PAYLOAD_FILE") ??
      optionalEnv("VALIDATED_PAYLOAD_FILE"),
    presentedAt: optionalEnv("PRESENTED_AT"),
    presentationStatus: parseOptionalPresentation(
      optionalEnv("PRESENTATION_STATUS"),
    ),
    finishedAt: optionalEnv("FINISHED_AT"),
    terminalReason: optionalEnv("TERMINAL_REASON"),
    failurePhase: parseOptionalFailurePhase(optionalEnv("FAILURE_PHASE")),
    failureReason: optionalEnv("FAILURE_REASON"),
    failureRecoverability: parseOptionalRecoverability(
      optionalEnv("FAILURE_RECOVERABILITY"),
    ),
    githubPostAttempted: parseOptionalBoolean(
      optionalEnv("GITHUB_POST_ATTEMPTED"),
    ),
    githubPostResult: parseOptionalGitHubResult(
      optionalEnv("GITHUB_POST_RESULT"),
    ),
    githubPostedAt: optionalEnv("GITHUB_POSTED_AT"),
    expectedState: parseOptionalState(optionalEnv("EXPECTED_STATE")),
  };
}

function buildBaseLease(
  previous: PrReviewLease | null,
  identity: Omit<LeaseIdentity, "primaryRoot">,
  inputs: LeaseInputs,
  row: TransitionId,
): PrReviewLease {
  const createdAt =
    row === "LC-01" || row === "LC-18"
      ? inputs.createdAt
      : (previous?.created_at ?? inputs.createdAt);
  return {
    schema: "pr-review/lease/v1",
    repository: identity.repository,
    pr_number: identity.prNumber,
    state: inputs.state,
    base_ref:
      row === "LC-01" || row === "LC-18"
        ? inputs.baseRef
        : (previous?.base_ref ?? inputs.baseRef),
    head_ref:
      row === "LC-01" || row === "LC-18"
        ? inputs.headRef
        : (previous?.head_ref ?? inputs.headRef),
    worktree_path: identity.worktreePath,
    worktree_digest: identity.worktreeDigest,
    lease_file: identity.leaseFile,
    created_at: createdAt,
    updated_at: inputs.updatedAt,
    artifacts: emptyArtifacts(),
    validation: emptyValidation(),
    presentation: emptyPresentation(),
    terminal: { finished_at: null, reason: null },
    failure: { phase: null, reason: null, recoverability: null },
    github: {
      github_post_attempted: false,
      github_post_result: "not-attempted",
      github_posted_at: null,
    },
  };
}

function applyGated(
  base: PrReviewLease,
  previous: PrReviewLease | null,
  inputs: LeaseInputs,
): PrReviewLease {
  const resultFile =
    inputs.resultFile ?? previous?.artifacts.result_file ?? null;
  requireInput("RESULT_FILE", resultFile ?? undefined);
  requireInput("PRESENTED_AT", inputs.presentedAt);
  requireInput("PRESENTATION_STATUS", inputs.presentationStatus);
  return {
    ...base,
    state: "gated",
    artifacts: {
      ...base.artifacts,
      handoff_file: previous?.artifacts.handoff_file ?? null,
      result_file: resultFile,
    },
    validation:
      resultFile === previous?.artifacts.result_file
        ? (previous?.validation ?? emptyValidation())
        : validResultValidation(inputs.updatedAt),
    presentation: {
      presented_at: inputs.presentedAt,
      status: inputs.presentationStatus,
    },
  };
}

function applyFailure(
  row: Exclude<
    TransitionId,
    | "LC-01"
    | "LC-02"
    | "LC-03"
    | "LC-04"
    | "LC-05"
    | "LC-06"
    | "LC-07"
    | "LC-08"
    | "LC-15"
    | "LC-17"
    | "LC-18"
  >,
  base: PrReviewLease,
  previous: PrReviewLease | null,
  inputs: LeaseInputs,
): PrReviewLease {
  requireInput("FINISHED_AT", inputs.finishedAt);
  requireInput("FAILURE_PHASE", inputs.failurePhase);
  requireInput("FAILURE_REASON", inputs.failureReason);
  requireInput("FAILURE_RECOVERABILITY", inputs.failureRecoverability);
  if (inputs.failurePhase === "github-post") {
    if (row !== "LC-13" && row !== "LC-16") {
      throw new PrReviewLeaseError("github-post failure requires gated lease");
    }
    if (inputs.githubPostAttempted !== true) {
      throw new PrReviewLeaseError(
        "GITHUB_POST_ATTEMPTED must be true for github-post failure",
      );
    }
    if (inputs.githubPostResult !== "failed") {
      throw new PrReviewLeaseError(
        "GITHUB_POST_RESULT must be failed for github-post failure",
      );
    }
  }
  const resultFile = failureResultFile(row, previous, inputs);
  const approvedReviewFile =
    inputs.failurePhase === "approval-freeze" ||
    inputs.failurePhase === "github-post"
      ? (inputs.approvedReviewFile ??
        previous?.artifacts.approved_review_file ??
        null)
      : null;
  if (inputs.failurePhase === "github-post" && approvedReviewFile === null) {
    throw new PrReviewLeaseError(
      "APPROVED_REVIEW_FILE is required for github-post failure",
    );
  }
  return {
    ...base,
    state: "failed",
    artifacts: {
      handoff_file: previous?.artifacts.handoff_file ?? null,
      result_file: resultFile,
      approved_review_file: approvedReviewFile,
      validated_payload_file:
        approvedReviewFile === null
          ? null
          : (inputs.validatedPayloadFile ??
            previous?.artifacts.validated_payload_file ??
            null),
    },
    validation: previous?.validation ?? emptyValidation(),
    presentation:
      row === "LC-11" || row === "LC-12" || row === "LC-13"
        ? (previous?.presentation ?? emptyPresentation())
        : emptyPresentation(),
    terminal: { finished_at: inputs.finishedAt, reason: null },
    failure: {
      phase: inputs.failurePhase,
      reason: inputs.failureReason,
      recoverability: inputs.failureRecoverability,
    },
    github:
      inputs.failurePhase === "github-post"
        ? {
            github_post_attempted: true,
            github_post_result: "failed",
            github_posted_at: null,
          }
        : {
            github_post_attempted: false,
            github_post_result: "not-attempted",
            github_posted_at: null,
          },
  };
}

function failureResultFile(
  row: TransitionId,
  previous: PrReviewLease | null,
  inputs: LeaseInputs,
): string | null {
  if (row === "LC-09") {
    return null;
  }
  if (row === "LC-16") {
    return inputs.resultFile ?? previous?.artifacts.result_file ?? null;
  }
  const current = previous?.artifacts.result_file ?? null;
  if (current === null) {
    throw new PrReviewLeaseError(
      "failed transition requires existing result pointer",
    );
  }
  if (inputs.resultFile !== undefined && inputs.resultFile !== current) {
    throw new PrReviewLeaseError(
      `RESULT_FILE must match existing ${previous?.state} result`,
    );
  }
  return current;
}

type TransitionId =
  | "LC-01"
  | "LC-02"
  | "LC-03"
  | "LC-04"
  | "LC-05"
  | "LC-06"
  | "LC-07"
  | "LC-08"
  | "LC-09"
  | "LC-10"
  | "LC-11"
  | "LC-12"
  | "LC-13"
  | "LC-14"
  | "LC-15"
  | "LC-16"
  | "LC-17"
  | "LC-18";

function transitionId(
  previous: PrReviewLease | null,
  inputs: LeaseInputs,
): TransitionId | null {
  const previousState = previous?.state ?? "none";
  if (previousState === "none" && inputs.state === "created") return "LC-01";
  if (
    (previousState === "posted" || previousState === "aborted") &&
    inputs.state === "created"
  ) {
    return "LC-18";
  }
  if (previousState === "created" && inputs.state === "created") return "LC-02";
  if (previousState === "created" && inputs.state === "reviewed")
    return "LC-03";
  if (previousState === "reviewed" && inputs.state === "gated") return "LC-04";
  if (previousState === "gated" && inputs.state === "gated") return "LC-05";
  if (previousState === "reviewed" && inputs.state === "aborted")
    return "LC-06";
  if (previousState === "gated" && inputs.state === "aborted") return "LC-07";
  if (previousState === "gated" && inputs.state === "posted") return "LC-08";
  if (previousState === "created" && inputs.state === "failed") return "LC-09";
  if (previousState === "reviewed" && inputs.state === "failed") return "LC-10";
  if (previousState === "gated" && inputs.state === "failed") {
    if (inputs.failurePhase === "approval-freeze") return "LC-12";
    if (inputs.failurePhase === "github-post") return "LC-13";
    return "LC-11";
  }
  if (previousState === "failed" && inputs.state === "gated") return "LC-14";
  if (previousState === "failed" && inputs.state === "aborted") return "LC-15";
  if (previousState === "failed" && inputs.state === "failed") return "LC-16";
  if (previousState === "failed" && inputs.state === "posted") return "LC-17";
  return null;
}

function archivePathIfNeeded(
  previous: PrReviewLease | null,
  identity: LeaseIdentity,
  inputs: LeaseInputs,
): string | null {
  if (
    inputs.state !== "created" ||
    (previous?.state !== "posted" && previous?.state !== "aborted")
  ) {
    return null;
  }
  const stamp = (previous.terminal.finished_at ?? previous.updated_at).replace(
    /[-:Z]/gu,
    "",
  );
  return `.ephemeral/pr-${identity.prNumber}-${identity.worktreeDigest}-${stamp}-${previous.state}-archived-lease.json`;
}

function normalizeLegacyLease(lease: PrReviewLease): PrReviewLease {
  if ((lease as { validation?: unknown }).validation !== undefined) {
    return lease;
  }
  const resultFile =
    isObject((lease as { artifacts?: unknown }).artifacts) &&
    typeof lease.artifacts.result_file === "string"
      ? lease.artifacts.result_file
      : null;
  return {
    ...lease,
    validation:
      resultFile === null
        ? emptyValidation()
        : validResultValidation(lease.updated_at),
  };
}

function validateLeaseShape(lease: PrReviewLease): void {
  if (lease.schema !== "pr-review/lease/v1") {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  validateKnownLeaseState((lease as { state?: unknown }).state);
  validateTimestamp("created_at", lease.created_at);
  validateTimestamp("updated_at", lease.updated_at);
  if (lease.presentation.presented_at !== null) {
    validateTimestamp(
      "presentation.presented_at",
      lease.presentation.presented_at,
    );
  }
  if (lease.terminal.finished_at !== null) {
    validateTimestamp("terminal.finished_at", lease.terminal.finished_at);
  }
  if (lease.github.github_posted_at !== null) {
    validateTimestamp("github.github_posted_at", lease.github.github_posted_at);
  }
  if (lease.validation.result_manifest.validated_at !== null) {
    validateTimestamp(
      "validation.result_manifest.validated_at",
      lease.validation.result_manifest.validated_at,
    );
  }
  for (const [label, value, suffix] of [
    ["handoff", lease.artifacts.handoff_file, DIRECT_SUFFIXES.handoff],
    ["result", lease.artifacts.result_file, DIRECT_SUFFIXES.result],
    [
      "approved review",
      lease.artifacts.approved_review_file,
      DIRECT_SUFFIXES.approved,
    ],
    [
      "validated payload",
      lease.artifacts.validated_payload_file,
      DIRECT_SUFFIXES.payload,
    ],
    ["lease", lease.lease_file, DIRECT_SUFFIXES.lease],
  ] as const) {
    if (value !== null) validateDirectChild(label, value, suffix);
  }
  validateStateInvariants(lease);
}

function validateStateInvariants(lease: PrReviewLease): void {
  if (lease.state === "created" && lease.artifacts.result_file !== null) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (
    (lease.state === "reviewed" ||
      lease.state === "gated" ||
      lease.state === "posted") &&
    lease.artifacts.result_file === null
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (lease.artifacts.result_file === null) {
    if (
      lease.validation.result_manifest.status !== null ||
      lease.validation.result_manifest.validated_at !== null
    ) {
      throw new PrReviewLeaseError("lease schema mismatch");
    }
  } else if (
    lease.validation.result_manifest.status !== "valid" ||
    lease.validation.result_manifest.validated_at === null
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (lease.state === "gated" && lease.presentation.presented_at === null) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (
    (lease.state === "posted" ||
      lease.state === "aborted" ||
      lease.state === "failed") &&
    lease.terminal.finished_at === null
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (
    lease.state === "posted" &&
    lease.artifacts.approved_review_file === null
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (lease.state === "failed" && lease.failure.phase === null) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
}

async function validateReferencedArtifacts(
  lease: PrReviewLease,
  worktreePath: string,
): Promise<void> {
  let resultReviewHead: string | null = null;
  if (lease.artifacts.handoff_file !== null) {
    const handoff = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.handoff_file,
      "handoff file",
    );
    validateHandoffIdentity(handoff, lease, worktreePath);
  }
  if (lease.artifacts.result_file !== null) {
    const result = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.result_file,
      "result file",
    );
    validateResultIdentity(result, lease);
    resultReviewHead = stringField(result, "review_head_sha");
  }
  if (lease.artifacts.approved_review_file !== null) {
    const approved = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.approved_review_file,
      "approved review file",
    );
    const approvedReviewHead = validateApprovedIdentity(
      approved,
      lease,
      resultReviewHead,
    );
    if (lease.artifacts.validated_payload_file !== null) {
      const expectedPayloadFile = expectedValidatedPayloadPath(
        lease.pr_number,
        approvedReviewHead,
      );
      if (lease.artifacts.validated_payload_file !== expectedPayloadFile) {
        throw new PrReviewLeaseError("validated payload path mismatch");
      }
      const payload = await readRequiredJson<JsonObject>(
        worktreePath,
        lease.artifacts.validated_payload_file,
        "validated payload file",
      );
      if (JSON.stringify(payload) !== JSON.stringify(approved.payload)) {
        throw new PrReviewLeaseError(
          "validated payload approved-review mismatch",
        );
      }
    }
  }
}

async function findUnmanagedEphemeralArtifacts(
  lease: PrReviewLease,
  worktreePath: string,
): Promise<string[]> {
  const ephemeralPath = path.join(worktreePath, ".ephemeral");
  let entries: { name: string }[];
  try {
    entries = await readdir(ephemeralPath, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const owned = await collectOwnedEphemeralArtifacts(lease, worktreePath);
  return entries
    .map((entry) => `.ephemeral/${entry.name}`)
    .filter((entryPath) => !owned.has(entryPath))
    .sort();
}

async function collectOwnedEphemeralArtifacts(
  lease: PrReviewLease,
  worktreePath: string,
): Promise<Set<string>> {
  const owned = new Set<string>();
  addOwnedPath(owned, lease.artifacts.handoff_file);
  addOwnedPath(owned, lease.artifacts.result_file);
  addOwnedPath(owned, lease.artifacts.approved_review_file);
  addOwnedPath(owned, lease.artifacts.validated_payload_file);

  if (lease.artifacts.handoff_file !== null) {
    const handoff = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.handoff_file,
      "handoff file",
    );
    collectHandoffArtifactPaths(owned, handoff);
  }
  if (lease.artifacts.result_file !== null) {
    const result = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.result_file,
      "result file",
    );
    addOwnedPath(owned, stringField(result, "findings_file"));
    addOwnedPath(owned, nullableStringField(result, "review_body_file"));
    addOwnedPath(owned, nullableStringField(result, "context_file"));
    collectResultArtifactPaths(owned, result);
  }
  if (lease.artifacts.approved_review_file !== null) {
    const approved = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.approved_review_file,
      "approved review file",
    );
    addOwnedPath(
      owned,
      typeof approved.review_body_file === "string"
        ? approved.review_body_file
        : null,
    );
  }

  return owned;
}

function collectHandoffArtifactPaths(
  owned: Set<string>,
  handoff: JsonObject,
): void {
  const artifacts = handoff.artifacts;
  if (!isObject(artifacts)) {
    return;
  }
  addOwnedPath(owned, stringField(artifacts, "scope_decision_file"));
  addOwnedPath(owned, nullableStringField(artifacts, "prior_threads_file"));
}

function collectResultArtifactPaths(
  owned: Set<string>,
  result: JsonObject,
): void {
  const artifacts = result.artifacts;
  if (!isObject(artifacts)) {
    return;
  }
  addOwnedPath(owned, stringField(artifacts, "handoff_file"));
  addOwnedPath(owned, stringField(artifacts, "scope_decision_file"));
  addOwnedPath(owned, nullableStringField(artifacts, "prior_threads_file"));
  addOwnedPath(owned, nullableStringField(artifacts, "rendered_preview_file"));
}

function addOwnedPath(owned: Set<string>, value: string | null): void {
  if (value === null) {
    return;
  }
  requireDirectEphemeralChild(value);
  owned.add(value);
}

type JsonObject = Record<string, unknown>;

function validateHandoffIdentity(
  handoff: JsonObject,
  lease: PrReviewLease,
  worktreePath: string,
): void {
  if (handoff.repository !== lease.repository) {
    throw new PrReviewLeaseError("handoff repository mismatch");
  }
  if (handoff.pr_number !== lease.pr_number) {
    throw new PrReviewLeaseError("handoff PR number mismatch");
  }
  if (handoff.base_ref !== undefined && handoff.base_ref !== lease.base_ref) {
    throw new PrReviewLeaseError("handoff base ref mismatch");
  }
  if (handoff.head_ref !== undefined && handoff.head_ref !== lease.head_ref) {
    throw new PrReviewLeaseError("handoff head ref mismatch");
  }
  const execution = handoff.execution;
  if (
    execution !== undefined &&
    isObject(execution) &&
    execution.working_directory !== undefined &&
    normalizeComparablePath(String(execution.working_directory)) !==
      normalizeComparablePath(worktreePath)
  ) {
    throw new PrReviewLeaseError("handoff worktree path mismatch");
  }
}

function validateResultIdentity(
  result: JsonObject,
  lease: PrReviewLease,
): void {
  if (result.repository !== lease.repository) {
    throw new PrReviewLeaseError("result repository mismatch");
  }
  if (result.pr_number !== lease.pr_number) {
    throw new PrReviewLeaseError("result PR number mismatch");
  }
  const reviewHead = stringField(result, "review_head_sha");
  if (!SHA_RE.test(reviewHead)) {
    throw new PrReviewLeaseError("result review head mismatch");
  }
  const handoffFile =
    isObject(result.artifacts) &&
    typeof result.artifacts.handoff_file === "string"
      ? result.artifacts.handoff_file
      : typeof result.handoff_file === "string"
        ? result.handoff_file
        : null;
  if (
    lease.artifacts.handoff_file !== null &&
    handoffFile !== null &&
    handoffFile !== lease.artifacts.handoff_file
  ) {
    throw new PrReviewLeaseError("result handoff mismatch");
  }
  if (lease.state === "gated" && isObject(result.presentation)) {
    const status = result.presentation.status;
    if (status !== "preview-current" && status !== "edited") {
      throw new PrReviewLeaseError("gated result presentation mismatch");
    }
  }
}

function validateApprovedIdentity(
  approved: JsonObject,
  lease: PrReviewLease,
  resultReviewHead: string | null,
): string {
  const reviewHead = stringField(approved, "review_head_sha");
  if (!SHA_RE.test(reviewHead)) {
    throw new PrReviewLeaseError("approved review head mismatch");
  }
  if (resultReviewHead !== null && reviewHead !== resultReviewHead) {
    throw new PrReviewLeaseError("approved review result head mismatch");
  }
  if (
    isObject(approved.payload) &&
    typeof approved.payload.commit_id === "string" &&
    approved.payload.commit_id !== reviewHead
  ) {
    throw new PrReviewLeaseError("approved review payload head mismatch");
  }
  if (
    lease.artifacts.result_file !== null &&
    typeof approved.review_body_file !== "string"
  ) {
    throw new PrReviewLeaseError("approved review result binding mismatch");
  }
  return reviewHead;
}

async function readExistingLease(file: string): Promise<PrReviewLease | null> {
  try {
    const lease = normalizeLegacyLease(
      await readRequiredJson<PrReviewLease>(process.cwd(), file, "lease file"),
    );
    validateLeaseShape(lease);
    return lease;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readRequiredJson<T>(
  root: string,
  relPath: string,
  label: string,
): Promise<T> {
  validateDirectChild(label.replace(" file", ""), relPath);
  await assertReadableDirectChild(root, relPath, label);
  return JSON.parse(await readFile(path.join(root, relPath), "utf8")) as T;
}

async function assertReadableDirectChild(
  root: string,
  relPath: string,
  label: string,
): Promise<void> {
  const fullPath = path.join(root, relPath);
  await assertEphemeralDirectory(root);
  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(fullPath);
  } catch {
    throw new PrReviewLeaseError(`${label} missing or not a regular file`);
  }
  if (stat.isSymbolicLink()) {
    throw new PrReviewLeaseError(`${label} must not be a symlink`);
  }
  if (!stat.isFile()) {
    throw new PrReviewLeaseError(`${label} missing or not a regular file`);
  }
  await access(fullPath, constants.R_OK);
}

async function assertWritableDirectChild(
  root: string,
  relPath: string,
  label: string,
): Promise<void> {
  validateDirectChild(label, relPath);
  await assertEphemeralDirectory(root);
  await mkdir(path.join(root, ".ephemeral"), { recursive: true });
  try {
    const stat = await lstat(path.join(root, relPath));
    if (stat.isSymbolicLink()) {
      throw new PrReviewLeaseError(
        `${label} path must not be a symlink: ${relPath}`,
      );
    }
    if (!stat.isFile()) {
      throw new PrReviewLeaseError(
        `${label} path exists but is not a regular file: ${relPath}`,
      );
    }
  } catch (err) {
    if (err instanceof PrReviewLeaseError) throw err;
  }
}

async function assertEphemeralDirectory(root: string): Promise<void> {
  const ephemeral = path.join(root, ".ephemeral");
  try {
    const stat = await lstat(ephemeral);
    if (stat.isSymbolicLink()) {
      throw new PrReviewLeaseError(
        ".ephemeral must be a directory, not a symlink",
      );
    }
    if (!stat.isDirectory()) {
      throw new PrReviewLeaseError(".ephemeral must be a directory");
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

function validateDirectChild(label: string, value: string, suffix = ""): void {
  try {
    requireDirectEphemeralChild(value);
  } catch {
    if (value.includes("..")) {
      throw new PrReviewLeaseError(`path traversal: ${value}`);
    }
    if (value.includes("\\")) {
      throw new PrReviewLeaseError(`${label} path validation failed: ${value}`);
    }
    if (value.startsWith(".ephemeral/") && value.slice(11).includes("/")) {
      throw new PrReviewLeaseError(`nested ${label} path rejected: ${value}`);
    }
    throw new PrReviewLeaseError(`${label} path validation failed: ${value}`);
  }
  if (suffix.length > 0 && !value.endsWith(suffix)) {
    throw new PrReviewLeaseError(`${label} path validation failed: ${value}`);
  }
}

function digestPath(value: string): string {
  return createHash("sha256")
    .update(normalizeComparablePath(value))
    .digest("hex");
}

function expectedValidatedPayloadPath(
  prNumber: number,
  reviewHead: string,
): string {
  return `.ephemeral/pr-${prNumber}-${reviewHead}-validated-review-payload.json`;
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  return /^[A-Za-z]:\//u.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function emptyArtifacts(): PrReviewLease["artifacts"] {
  return {
    handoff_file: null,
    result_file: null,
    approved_review_file: null,
    validated_payload_file: null,
  };
}

function emptyValidation(): PrReviewLease["validation"] {
  return {
    result_manifest: {
      status: null,
      validated_at: null,
    },
  };
}

function validResultValidation(
  validatedAt: string,
): PrReviewLease["validation"] {
  return {
    result_manifest: {
      status: "valid",
      validated_at: validatedAt,
    },
  };
}

function emptyPresentation(): PrReviewLease["presentation"] {
  return { presented_at: null, status: null };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new PrReviewLeaseError(`${name} is required`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.length === 0 ? undefined : value;
}

function requireInput(name: string, value: unknown): asserts value {
  if (value === undefined || value === null || value === "") {
    throw new PrReviewLeaseError(`${name} is required`);
  }
}

function parsePositiveInteger(name: string, value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new PrReviewLeaseError(`${name} must be a positive integer`);
  }
  return Number(value);
}

function validateTimestamp(label: string, value: string): void {
  if (!TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new PrReviewLeaseError(
      `${label} must be a UTC RFC3339 timestamp ending in Z`,
    );
  }
}

function validateKnownLeaseState(value: unknown): asserts value is LeaseState {
  if (typeof value !== "string") {
    throw new PrReviewLeaseError("lease state must be a string");
  }
  parseState(value);
}

function nowTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function parseState(value: string): LeaseState {
  const parsed = parseOptionalState(value);
  if (parsed === undefined) {
    throw new PrReviewLeaseError(`unknown lease state: ${value}`);
  }
  return parsed;
}

function parseOptionalState(value: string | undefined): LeaseState | undefined {
  if (
    value === "created" ||
    value === "reviewed" ||
    value === "gated" ||
    value === "posted" ||
    value === "aborted" ||
    value === "failed"
  ) {
    return value;
  }
  if (value === undefined) return undefined;
  throw new PrReviewLeaseError(`unknown lease state: ${value}`);
}

function parseOptionalPresentation(
  value: string | undefined,
): PresentationStatus | undefined {
  if (
    value === undefined ||
    value === "preview-current" ||
    value === "edited"
  ) {
    return value;
  }
  throw new PrReviewLeaseError(`unknown presentation status: ${value}`);
}

function parseOptionalFailurePhase(
  value: string | undefined,
): FailurePhase | undefined {
  if (
    value === undefined ||
    value === "handoff-validation" ||
    value === "review" ||
    value === "result-validation" ||
    value === "preview-render" ||
    value === "approval-freeze" ||
    value === "stale-head" ||
    value === "github-post"
  ) {
    return value;
  }
  throw new PrReviewLeaseError(`unknown failure phase: ${value}`);
}

function parseOptionalRecoverability(
  value: string | undefined,
): Recoverability | undefined {
  if (
    value === undefined ||
    value === "recoverable" ||
    value === "unrecoverable" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new PrReviewLeaseError(`unknown failure recoverability: ${value}`);
}

function parseOptionalGitHubResult(
  value: string | undefined,
): GitHubPostResult | undefined {
  if (
    value === undefined ||
    value === "succeeded" ||
    value === "failed" ||
    value === "not-attempted"
  ) {
    return value;
  }
  throw new PrReviewLeaseError(`unknown GitHub post result: ${value}`);
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new PrReviewLeaseError(`expected boolean: ${value}`);
}

function stringField(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string") {
    throw new PrReviewLeaseError(`${key} is required`);
  }
  return value;
}

function nullableStringField(object: JsonObject, key: string): string | null {
  const value = object[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new PrReviewLeaseError(`${key} is required`);
  }
  return value;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidTransition(
  previous: LeaseState | "none",
  target: LeaseState,
): PrReviewLeaseError {
  return new PrReviewLeaseError(
    `invalid lease transition: ${previous} -> ${target}`,
  );
}

function ok(stdout: string): RuntimeCommandOutcome {
  return { exitCode: 0, stdout, stderr: "" };
}

class PrReviewLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrReviewLeaseError";
  }
}
