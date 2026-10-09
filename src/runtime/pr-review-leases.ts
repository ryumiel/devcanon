import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
import { requireDirectEphemeralChild } from "./paths.js";
import { validateSharedContextFamilyBinding } from "./play-review-shared-context.js";
import { validatePrReviewPreparationHandoff } from "./pr-review-manifests.js";
import {
  type PrReviewResultValidationContext,
  createPrReviewResultValidationContext,
  validatePrReviewResultCommandAuthority,
} from "./pr-review-result-validation.js";

import {
  type OriginalReviewArtifact,
  assertClosedOriginalObject,
  assertOriginalEvidencePath,
  assertOriginalRecordPath,
  parseOriginalReviewJson,
  readOriginalReviewRecord,
  snapshotOriginalReviewResource,
} from "./review-artifacts.js";

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
type ResultPresentationStatus = PresentationStatus | "not-presented";
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
type EvidencePolicy =
  | "accept-reviewed-result"
  | "accept-gated-result"
  | "accept-post-success"
  | "validate-live-gated-status"
  | "validate-stored-lease"
  | "preserve-created-recovery"
  | "preserve-reviewed-recovery"
  | "preserve-gated-recovery"
  | "preserve-failed-recovery"
  | "validate-post-retry"
  | "validate-cleanup-metadata";

type DiscoveryDisposition =
  | "create"
  | "resume"
  | "cleanup-required"
  | "ambiguous"
  | "invalid";
type DiscoveryClassification =
  | "resumable"
  | "terminal"
  | "reentry"
  | "missing"
  | "unregistered"
  | "invalid";

interface DiscoveryIdentity {
  repository: string;
  prNumber: number;
  primaryRoot: string;
}

interface DiscoveryCandidate {
  lease_file: string;
  worktree_path: string | null;
  state: LeaseState | null;
  classification: DiscoveryClassification;
  worktree_dirty: boolean | null;
  unmanaged_ephemeral_artifacts: boolean | null;
}

interface PrReviewSessionDiscovery {
  schema: "pr-review/session-discovery/v1";
  repository: string;
  pr_number: number;
  primary_repository_root: string;
  canonical_worktree_path: string;
  canonical_worktree_present: boolean;
  active: DiscoveryCandidate[];
  archived_lease_files: string[];
  disposition: DiscoveryDisposition;
  resume: { lease_file: string; worktree_path: string } | null;
}

type SessionCreateOutcome = "success" | "conflict" | "manual-cleanup";
type SessionCreateConflictReason =
  | "discovery-not-create"
  | "reservation-contended"
  | "worktree-create-failed"
  | "lease-create-failed"
  | "final-verification-failed"
  | "interrupted"
  | "lifecycle-reentry-required";
type ObservedArtifact = "reservation" | "worktree" | "registration" | "lease";
type SessionCreateManualReason =
  | "reservation-unverifiable"
  | "worktree-unverifiable"
  | "lease-unverifiable"
  | "rollback-incomplete"
  | "interrupted";

interface RegistrationIdentity {
  worktree_path: string;
  git_directory: string;
}

interface SessionCreateReservation {
  schema: "pr-review/session-create-reservation/v1";
  invocation_token: string;
  repository: string;
  pr_number: number;
  primary_repository_root: string;
  common_git_directory: string;
  canonical_worktree_path: string;
  immutable_head: string;
  lease_file: string;
  expected_lease_sha256: string;
}

interface TerminalAdvanceCandidate {
  lease: PrReviewLease;
  leaseBytes: string;
  worktreePath: string;
  leaseFile: string;
  oldHead: string;
  continuationBytes?: string;
}

interface TerminalArtifactSnapshot {
  file: string;
  bytes: Buffer;
  dev: number;
  ino: number;
}

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
      sha256: string | null;
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
  preparation_failures?: {
    directory: string;
    scope_sha256: string;
    diagnostics_sha256: string;
    second_pair?: { scope_sha256: string; diagnostics_sha256: string };
  }[];
  cleanup?: {
    last_outcome: "removed" | "retained" | "skipped" | "failed" | null;
    last_checked_at: string | null;
    removed_at: string | null;
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
  resultSha256?: string | null;
}

const SHA_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const DIRECT_SUFFIXES = {
  handoff: "-handoff.json",
  result: "-result.json",
  approved: "-approved-review.json",
  payload: "-validated-review-payload.json",
  lease: "-lease.json",
} as const;

interface PrReviewLeasesCommandOptions {
  validationContext?: PrReviewResultValidationContext;
}

export async function runPrReviewLeasesCommand(
  args: readonly string[],
  options: PrReviewLeasesCommandOptions = {},
): Promise<RuntimeCommandOutcome> {
  try {
    const [commandName, ...commandArgs] = args;
    switch (commandName) {
      case "derive-path":
        return ok(`${(await readIdentity(false)).leaseFile}\n`);
      case "discover":
        if (commandArgs.length !== 0) {
          throw new PrReviewLeaseError(
            "discover does not accept positional arguments",
          );
        }
        return ok(`${JSON.stringify(await discoverReviewSession())}\n`);
      case "session-reconcile":
        return await reconcileSession(commandArgs);
      case "retire-attempt":
        return await retireAttempt(commandArgs);
      case "session-create":
        if (commandArgs.length !== 0) {
          throw new PrReviewLeaseError(
            "session-create does not accept positional arguments",
          );
        }
        return await sessionCreatePreflight();
      case "write":
        return await withReviewMutationReservation("write", async () =>
          ok(`${await writeLease(options)}\n`),
        );
      case "record-audit-failure":
        return await withReviewMutationReservation(
          "record-audit-failure",
          async () => ok(`${await recordAuditFailure(options)}\n`),
        );
      case "validate":
        await validateLeaseCommand(options);
        return ok("");
      case "read-status":
        return ok(`${await readStatus(options)}\n`);
      case "inspect-worktree":
        return await withReviewMutationReservation(
          "inspect-worktree",
          async () => ok(await inspectWorktree()),
        );
      case "cleanup-worktree":
        return await withReviewMutationReservation(
          "cleanup-worktree",
          async () => ok(await cleanupWorktree()),
        );
      default:
        throw new PrReviewLeaseError(
          "usage: review-leases.sh derive-path|discover|retire-attempt|session-reconcile|session-create|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree",
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
}

async function withReviewMutationReservation(
  command: string,
  mutate: () => Promise<RuntimeCommandOutcome>,
): Promise<RuntimeCommandOutcome> {
  const identity =
    command === "record-audit-failure"
      ? (await readAuditFailureIdentity()).identity
      : command.endsWith("worktree")
        ? await readCleanupIdentity()
        : await readIdentity(true);
  const reservationFile = `.ephemeral/pr-${identity.prNumber}-session-create-reservation.json`;
  const leasePath = path.join(identity.primaryRoot, identity.leaseFile);
  const bytes = await readFile(leasePath, "utf8").catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  });
  const head = await execFileAsync("git", [
    "-C",
    identity.worktreePath,
    "rev-parse",
    "HEAD",
  ])
    .then((result) => result.stdout.trim())
    .catch(() => "0".repeat(40));
  const reservation: SessionCreateReservation = {
    schema: "pr-review/session-create-reservation/v1",
    invocation_token: randomUUID(),
    repository: identity.repository,
    pr_number: identity.prNumber,
    primary_repository_root: identity.primaryRoot,
    common_git_directory: await gitDirectory(
      identity.primaryRoot,
      "--git-common-dir",
    ).catch(() => path.join(identity.primaryRoot, ".git")),
    canonical_worktree_path: identity.worktreePath,
    immutable_head: head,
    lease_file: identity.leaseFile,
    expected_lease_sha256: sha256Text(bytes),
  };
  const reservationBytes = `${JSON.stringify(reservation)}\n`;
  if (
    (await acquireSessionCreateReservation(
      identity.primaryRoot,
      reservationFile,
      reservation,
      reservationBytes,
    )) !== "acquired"
  )
    throw new PrReviewLeaseError(
      "review mutation reservation contended or unverifiable",
    );
  let outcome: RuntimeCommandOutcome | undefined;
  let mutationError: unknown;
  let failed = false;
  try {
    outcome = await mutate();
  } catch (err) {
    failed = true;
    mutationError = err;
  }
  if (
    !(await removeOwnedReservation(
      identity.primaryRoot,
      reservationFile,
      reservation,
      reservationBytes,
    ))
  )
    throw new PrReviewLeaseError(
      "review mutation reservation release uncertain; reconcile exact operation",
    );
  if (failed) throw mutationError;
  if (outcome === undefined)
    throw new PrReviewLeaseError("review mutation outcome uncertain");
  return outcome;
}

interface AttemptRetirementRequest {
  schema: "pr-review/attempt-retirement/v1";
  operation_id: string;
  repository: string;
  pr_number: number;
  worktree_path: string;
  old_head: string;
  lease_file: string;
  lease_sha256: string;
  original_records: { file: string; sha256: string }[];
  authority_ref: string;
  active_consumers: string[];
  pending_effects: string[];
  publication: { status: "published" | "not-required"; references: string[] };
}
interface AttemptRetirementOperation {
  schema: "pr-review/attempt-retirement-operation/v1";
  request_sha256: string;
  reservation: SessionCreateReservation;
  original_lease: string;
  released_lease: string;
  records: OriginalReviewArtifact[];
  pending_leaf: string | null;
  removed_leaves: string[];
  removed_resources: string[];
  outcome: "held" | "retired";
}

function validateAttemptRetirementRequest(
  value: unknown,
): asserts value is AttemptRetirementRequest {
  assertClosedOriginalObject(value, [
    "schema",
    "operation_id",
    "repository",
    "pr_number",
    "worktree_path",
    "old_head",
    "lease_file",
    "lease_sha256",
    "original_records",
    "authority_ref",
    "active_consumers",
    "pending_effects",
    "publication",
  ]);
  if (
    value.schema !== "pr-review/attempt-retirement/v1" ||
    typeof value.operation_id !== "string" ||
    !/^[A-Za-z0-9_-]{1,80}$/u.test(value.operation_id) ||
    typeof value.repository !== "string" ||
    !/^[^/\s]+\/[^/\s]+$/u.test(value.repository) ||
    !Number.isSafeInteger(value.pr_number) ||
    Number(value.pr_number) <= 0 ||
    typeof value.worktree_path !== "string" ||
    !path.isAbsolute(value.worktree_path) ||
    typeof value.old_head !== "string" ||
    !SHA_RE.test(value.old_head) ||
    typeof value.lease_file !== "string" ||
    typeof value.lease_sha256 !== "string" ||
    !SHA256_RE.test(value.lease_sha256) ||
    typeof value.authority_ref !== "string" ||
    value.authority_ref.trim() === "" ||
    !Array.isArray(value.original_records) ||
    value.original_records.length === 0 ||
    !Array.isArray(value.active_consumers) ||
    value.active_consumers.length !== 0 ||
    !Array.isArray(value.pending_effects) ||
    value.pending_effects.length !== 0
  )
    throw new PrReviewLeaseError(
      "retirement requires exact identity, exhausted consumers/effects and separate action authority",
    );
  validateDirectChild("lease", value.lease_file, "-lease.json");
  assertClosedOriginalObject(value.publication, ["status", "references"]);
  const publication = value.publication;
  if (
    !["not-required", "published"].includes(String(publication.status)) ||
    !Array.isArray(publication.references) ||
    publication.references.some(
      (reference) =>
        typeof reference !== "string" ||
        !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:#.+)?$/u.test(
          reference,
        ),
    ) ||
    (publication.status === "published"
      ? publication.references.length === 0
      : publication.references.length !== 0)
  )
    throw new PrReviewLeaseError(
      "retirement requires verified durable publication or qualified not-required",
    );
  const files = new Set<string>();
  for (const reference of value.original_records) {
    assertClosedOriginalObject(reference, ["file", "sha256"]);
    if (
      typeof reference.file !== "string" ||
      !path.isAbsolute(reference.file) ||
      files.has(reference.file) ||
      typeof reference.sha256 !== "string" ||
      !SHA256_RE.test(reference.sha256)
    )
      throw new PrReviewLeaseError(
        "invalid or duplicate original record reference",
      );
    files.add(reference.file);
  }
}

async function retireAttempt(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  if (args.length !== 2 || args[0] !== "--request-file")
    throw new PrReviewLeaseError(
      "retire-attempt requires exactly --request-file <physical-primary-path>",
    );
  const identity = await readDiscoveryIdentity();
  await assertPrimaryGitBinding(identity.primaryRoot);
  const requestFile = args[1] as string;
  await assertOriginalRecordPath(requestFile);
  if (path.dirname(path.dirname(requestFile)) !== identity.primaryRoot)
    throw new PrReviewLeaseError(
      "retirement request must live in physical primary outside disposable checkout",
    );
  const requestBytes = await readFile(requestFile, "utf8");
  const parsedRequest = parseOriginalReviewJson(requestBytes);
  validateAttemptRetirementRequest(parsedRequest);
  const request: AttemptRetirementRequest = parsedRequest;
  if (
    request.repository !== identity.repository ||
    request.pr_number !== identity.prNumber
  )
    throw new PrReviewLeaseError("retirement repository/PR mismatch");
  const validationContext = await createPrReviewResultValidationContext({
    worktreeRoot: request.worktree_path,
  });
  const requestSha = sha256Text(requestBytes);
  const operationFile = path.join(
    identity.primaryRoot,
    `.ephemeral/pr-${identity.prNumber}-retirement-${request.operation_id}.json`,
  );
  const reservationFile = `.ephemeral/pr-${identity.prNumber}-session-create-reservation.json`;
  await assertOriginalRecordPath(operationFile, true);
  let operation: AttemptRetirementOperation;
  const operationExists = await pathExists(operationFile);
  if (operationExists) {
    const value = parseOriginalReviewJson(
      await readFile(operationFile, "utf8"),
    );
    assertClosedOriginalObject(value, [
      "schema",
      "request_sha256",
      "reservation",
      "original_lease",
      "released_lease",
      "records",
      "pending_leaf",
      "removed_leaves",
      "removed_resources",
      "outcome",
    ]);
    operation = value as unknown as AttemptRetirementOperation;
    if (
      operation.schema !== "pr-review/attempt-retirement-operation/v1" ||
      operation.request_sha256 !== requestSha ||
      !isClosedSessionCreateReservation(
        operation.reservation,
        operation.reservation,
        true,
      ) ||
      typeof operation.original_lease !== "string" ||
      typeof operation.released_lease !== "string" ||
      !Array.isArray(operation.records) ||
      !Array.isArray(operation.removed_leaves) ||
      !Array.isArray(operation.removed_resources) ||
      !["held", "retired"].includes(operation.outcome) ||
      (operation.pending_leaf !== null &&
        typeof operation.pending_leaf !== "string")
    )
      throw new PrReviewLeaseError(
        "retirement same-operation evidence is invalid or divergent",
      );
  } else {
    await assertReadableDirectChild(
      identity.primaryRoot,
      request.lease_file,
      "retirement lease",
    );
    const leaseBytes = await readFile(
      path.join(identity.primaryRoot, request.lease_file),
      "utf8",
    );
    if (sha256Text(leaseBytes) !== request.lease_sha256)
      throw new PrReviewLeaseError("retirement current lease bytes changed");
    const lease = parseOriginalReviewJson(leaseBytes) as PrReviewLease;
    validateLeaseShape(lease);
    const completedPosting =
      lease.state === "posted" &&
      lease.github.github_post_attempted &&
      lease.github.github_post_result === "succeeded" &&
      lease.github.github_posted_at !== null;
    if (
      lease.repository !== request.repository ||
      lease.pr_number !== request.pr_number ||
      lease.worktree_path !== request.worktree_path ||
      lease.lease_file !== request.lease_file ||
      lease.worktree_digest !== digestPath(request.worktree_path) ||
      lease.state === "created" ||
      (!completedPosting &&
        (lease.artifacts.approved_review_file !== null ||
          lease.github.github_post_attempted))
    )
      throw new PrReviewLeaseError(
        "retirement active, frozen or attempted-post lease refuses",
      );
    if (completedPosting)
      await validateReferencedArtifacts(lease, request.worktree_path, {
        validateResultAuthority: true,
        policy: "validate-stored-lease",
        validationContext,
      });
    const records: OriginalReviewArtifact[] = [];
    const resources = new Set<string>();
    for (const reference of request.original_records) {
      await assertOriginalRecordPath(reference.file);
      if (
        path.dirname(path.dirname(reference.file)) !== identity.primaryRoot ||
        sha256Text(await readFile(reference.file, "utf8")) !== reference.sha256
      )
        throw new PrReviewLeaseError(
          "original producer record unavailable or changed",
        );
      const record = await readOriginalReviewRecord(reference.file);
      for (const source of record.source_refs) {
        await assertOriginalEvidencePath(source.file);
        if (
          source.file.startsWith(`${request.worktree_path}${path.sep}`) ||
          sha256Text(await readFile(source.file, "utf8")) !== source.sha256
        )
          throw new PrReviewLeaseError(
            "original producer source evidence changed or is current-resource-only",
          );
      }

      if (
        record.production === "allocated" ||
        record.repository !== request.repository ||
        record.pr_number !== request.pr_number ||
        record.worktree_path !== request.worktree_path ||
        record.old_head !== request.old_head ||
        resources.has(record.resource)
      )
        throw new PrReviewLeaseError(
          "original producer association mismatch or unsealed production",
        );
      if (
        JSON.stringify(await snapshotOriginalReviewResource(record)) !==
        JSON.stringify(record.entries)
      )
        throw new PrReviewLeaseError(
          "original bytes or closed entry set changed",
        );
      resources.add(record.resource);
      records.push(record);
    }
    // Diagnostic retirement preserves every accepted lease pointer.
    if (
      Object.values(lease.artifacts).some(
        (file) => file !== null && resources.has(file),
      )
    )
      throw new PrReviewLeaseError(
        "retirement cannot erase accepted review pointers",
      );
    if ((lease.preparation_failures?.length ?? 0) > 0)
      await validatePreparationFailures(lease, request.worktree_path);
    const released = { ...lease };
    if (lease.preparation_failures !== undefined) {
      const remaining = lease.preparation_failures.filter(
        (record) => !resources.has(record.directory),
      );
      if (remaining.length) released.preparation_failures = remaining;
      else Reflect.deleteProperty(released, "preparation_failures");
    }
    validateLeaseShape(released);
    if (
      request.worktree_path !==
        (await canonicalPrReviewWorktreePath(identity)) ||
      (await realpath(request.worktree_path)) !== request.worktree_path ||
      (await isWorktreeDirty(request.worktree_path))
    )
      throw new PrReviewLeaseError(
        "retirement requires physical canonical clean worktree",
      );
    const active = (await discoverReviewSession()).active;
    if (active.length !== 1 || active[0]?.lease_file !== request.lease_file)
      throw new PrReviewLeaseError("retirement concurrent or ambiguous owner");
    const unmanaged = await findUnmanagedEphemeralArtifacts(
      lease,
      request.worktree_path,
    );
    if (unmanaged.some((resource) => !resources.has(resource)))
      throw new PrReviewLeaseError(
        "retirement unrelated or unknown artifacts remain",
      );
    const common = await gitDirectory(identity.primaryRoot, "--git-common-dir");
    if (
      (await verifyCreatedSessionWorktree(
        identity.primaryRoot,
        request.worktree_path,
        common,
        request.old_head,
        false,
      )) === null
    )
      throw new PrReviewLeaseError(
        "retirement old head or registration changed",
      );
    const reservation: SessionCreateReservation = {
      schema: "pr-review/session-create-reservation/v1",
      invocation_token: randomUUID(),
      repository: request.repository,
      pr_number: request.pr_number,
      primary_repository_root: identity.primaryRoot,
      common_git_directory: common,
      canonical_worktree_path: request.worktree_path,
      immutable_head: request.old_head,
      lease_file: request.lease_file,
      expected_lease_sha256: request.lease_sha256,
    };
    const reservationBytes = `${JSON.stringify(reservation)}\n`;
    if (
      (await acquireSessionCreateReservation(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      )) !== "acquired"
    )
      throw new PrReviewLeaseError(
        "retirement reservation contended or unverifiable",
      );
    operation = {
      schema: "pr-review/attempt-retirement-operation/v1",
      request_sha256: requestSha,
      reservation,
      original_lease: leaseBytes,
      released_lease:
        lease.preparation_failures === undefined
          ? leaseBytes
          : `${JSON.stringify(released, null, 2)}\n`,
      records,
      pending_leaf: null,
      removed_leaves: [],
      removed_resources: [],
      outcome: "held",
    };
    try {
      await writeFile(operationFile, `${JSON.stringify(operation)}\n`, {
        flag: "wx",
      });
    } catch (err) {
      await removeOwnedReservation(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      );
      throw err;
    }
  }
  const reservation = operation.reservation;
  if (
    reservation.repository !== request.repository ||
    reservation.pr_number !== request.pr_number ||
    reservation.primary_repository_root !== identity.primaryRoot ||
    reservation.canonical_worktree_path !== request.worktree_path ||
    reservation.immutable_head !== request.old_head ||
    reservation.lease_file !== request.lease_file ||
    reservation.expected_lease_sha256 !== request.lease_sha256 ||
    sha256Text(operation.original_lease) !== request.lease_sha256
  )
    throw new PrReviewLeaseError(
      "retirement operation identity or original lease binding changed",
    );
  const originalLease = parseOriginalReviewJson(
    operation.original_lease,
  ) as PrReviewLease;
  validateLeaseShape(originalLease);
  const recordedResources = new Set(
    operation.records.map((record) => record.resource),
  );
  const releasedLease = { ...originalLease };
  if (originalLease.preparation_failures !== undefined) {
    const remaining = originalLease.preparation_failures.filter(
      (record) => !recordedResources.has(record.directory),
    );
    if (remaining.length) releasedLease.preparation_failures = remaining;
    else Reflect.deleteProperty(releasedLease, "preparation_failures");
  }
  const expectedReleased =
    originalLease.preparation_failures === undefined
      ? operation.original_lease
      : `${JSON.stringify(releasedLease, null, 2)}\n`;
  if (operation.released_lease !== expectedReleased)
    throw new PrReviewLeaseError(
      "retirement coherent release evidence changed",
    );
  const validLeaves = new Set(
    operation.records.flatMap((record) =>
      record.entries.map((entry) => `${record.resource}/${entry.name}`),
    ),
  );
  if (
    recordedResources.size !== operation.records.length ||
    new Set(operation.removed_leaves).size !==
      operation.removed_leaves.length ||
    new Set(operation.removed_resources).size !==
      operation.removed_resources.length ||
    operation.removed_leaves.some((file) => !validLeaves.has(file)) ||
    operation.removed_resources.some((file) => !recordedResources.has(file)) ||
    (operation.pending_leaf !== null &&
      !validLeaves.has(operation.pending_leaf) &&
      !recordedResources.has(operation.pending_leaf)) ||
    (operation.outcome === "retired" &&
      operation.removed_resources.length !== operation.records.length)
  )
    throw new PrReviewLeaseError("retirement progress evidence invalid");
  const reservationBytes = `${JSON.stringify(reservation)}\n`;
  const output = async (
    outcome: "held" | "retired",
    reason: string | null,
  ): Promise<RuntimeCommandOutcome> => {
    let leaseSha256: string | null = null;
    try {
      await assertReadableDirectChild(
        identity.primaryRoot,
        request.lease_file,
        "retirement lease",
      );
      const leasePath = path.join(identity.primaryRoot, request.lease_file);
      const before = await lstat(leasePath);
      const bytes = await readFile(leasePath);
      const after = await lstat(leasePath);
      if (
        after.isFile() &&
        !after.isSymbolicLink() &&
        before.dev === after.dev &&
        before.ino === after.ino &&
        bytes.equals(await readFile(leasePath))
      )
        leaseSha256 = createHash("sha256").update(bytes).digest("hex");
    } catch {
      // Unknown current lease bytes are not the planned released lease digest.
    }
    return {
      exitCode: outcome === "retired" ? 0 : 1,
      stdout: `${JSON.stringify({ schema: "pr-review/attempt-retirement-result/v1", outcome, operation_file: operationFile, request_sha256: requestSha, lease_sha256: leaseSha256, reason })}\n`,
      stderr: "",
    };
  };
  async function save() {
    await writeTextAtomically(operationFile, `${JSON.stringify(operation)}\n`);
  }
  async function binding() {
    if (
      sha256Text(await readFile(requestFile, "utf8")) !== requestSha ||
      (await realpath(request.worktree_path)) !== request.worktree_path ||
      request.worktree_path !== (await canonicalPrReviewWorktreePath(identity))
    )
      throw new PrReviewLeaseError(
        "retirement current action or physical canonical worktree changed",
      );
    await assertReadableDirectChild(
      identity.primaryRoot,
      request.lease_file,
      "retirement lease",
    );
    const leaseBytes = await readFile(
      path.join(identity.primaryRoot, request.lease_file),
      "utf8",
    );
    if (
      leaseBytes !== operation.original_lease &&
      leaseBytes !== operation.released_lease
    )
      throw new PrReviewLeaseError("retirement lease changed");
    if (
      (await isWorktreeDirty(request.worktree_path)) ||
      (await verifyCreatedSessionWorktree(
        identity.primaryRoot,
        request.worktree_path,
        reservation.common_git_directory,
        request.old_head,
        false,
      )) === null
    )
      throw new PrReviewLeaseError(
        "retirement worktree dirty, stale or unregistered",
      );
    if (originalLease.state === "posted") {
      const acceptedPostingLease = { ...originalLease };
      Reflect.deleteProperty(acceptedPostingLease, "preparation_failures");
      await validateReferencedArtifacts(
        acceptedPostingLease,
        request.worktree_path,
        {
          validateResultAuthority: true,
          policy: "validate-stored-lease",
          validationContext,
        },
      );
    }
    if (
      operation.outcome !== "retired" &&
      !(await reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      ))
    )
      throw new PrReviewLeaseError("retirement reservation changed");
    const currentRecords: OriginalReviewArtifact[] = [];
    for (const reference of request.original_records) {
      if (
        sha256Text(await readFile(reference.file, "utf8")) !== reference.sha256
      )
        throw new PrReviewLeaseError("retirement original evidence changed");
      const record = await readOriginalReviewRecord(reference.file);
      for (const source of record.source_refs) {
        await assertOriginalEvidencePath(source.file);
        if (sha256Text(await readFile(source.file, "utf8")) !== source.sha256)
          throw new PrReviewLeaseError(
            "retirement original production source changed",
          );
      }
      currentRecords.push(record);
    }
    if (!isDeepStrictEqual(currentRecords, operation.records))
      throw new PrReviewLeaseError(
        "retirement original operation records changed",
      );
  }
  try {
    await binding();
    if (operation.outcome === "retired") {
      if (await pathExists(path.join(identity.primaryRoot, reservationFile))) {
        if (
          !(await removeOwnedReservation(
            identity.primaryRoot,
            reservationFile,
            reservation,
            reservationBytes,
          ))
        )
          return output("held", "reservation changed");
      }
      for (const record of operation.records)
        if (await pathExists(path.join(request.worktree_path, record.resource)))
          return output("held", "retired resource reappeared");
      return output("retired", null);
    }
    for (const record of operation.records) {
      const target = path.join(request.worktree_path, record.resource);
      if (operation.removed_resources.includes(record.resource)) {
        if (await pathExists(target))
          throw new PrReviewLeaseError("retired resource reappeared");
        continue;
      }
      await binding();
      if (!(await pathExists(target))) {
        const onlyLeaf =
          record.resource_kind === "file" && record.entries.length === 1
            ? `${record.resource}/${record.entries[0]?.name}`
            : null;
        if (
          operation.pending_leaf !== record.resource &&
          !(
            onlyLeaf !== null &&
            (operation.pending_leaf === onlyLeaf ||
              operation.removed_leaves.includes(onlyLeaf))
          )
        )
          throw new PrReviewLeaseError(
            "resource absent without exact same-operation evidence",
          );
        operation.removed_resources.push(record.resource);
        operation.pending_leaf = null;
        await save();
        continue;
      }
      const resourceStat = await lstat(target);
      if (
        resourceStat.dev !== record.dev ||
        resourceStat.ino !== record.ino ||
        resourceStat.isSymbolicLink()
      )
        throw new PrReviewLeaseError("original resource replaced");
      const expected = record.entries.filter(
        (entry) =>
          !operation.removed_leaves.includes(
            `${record.resource}/${entry.name}`,
          ),
      );
      const actual = await snapshotOriginalReviewResource(record);
      const pending = operation.pending_leaf;
      const allowed = expected.filter(
        (entry) => `${record.resource}/${entry.name}` !== pending,
      );
      if (
        JSON.stringify(actual) !== JSON.stringify(expected) &&
        !(
          pending !== null && JSON.stringify(actual) === JSON.stringify(allowed)
        )
      )
        throw new PrReviewLeaseError(
          "original resource bytes or extra entries changed",
        );
      if (
        pending !== null &&
        actual.length === allowed.length &&
        pending.startsWith(`${record.resource}/`)
      ) {
        operation.removed_leaves.push(pending);
        operation.pending_leaf = null;
        await save();
      }
      for (const entry of record.entries) {
        const key = `${record.resource}/${entry.name}`;
        if (operation.removed_leaves.includes(key)) continue;
        await binding();
        const current = await snapshotOriginalReviewResource(record);
        const remaining = record.entries.filter(
          (leaf) =>
            !operation.removed_leaves.includes(
              `${record.resource}/${leaf.name}`,
            ),
        );
        if (JSON.stringify(current) !== JSON.stringify(remaining))
          throw new PrReviewLeaseError(
            "original bytes changed before destructive step",
          );
        const file = resourceStat.isDirectory()
          ? path.join(target, entry.name)
          : target;
        operation.pending_leaf = key;
        await save();
        await rm(file);
        operation.removed_leaves.push(key);
        operation.pending_leaf = null;
        await save();
      }
      await binding();
      operation.pending_leaf = record.resource;
      await save();
      if (resourceStat.isDirectory()) {
        const current = await lstat(target);
        if (
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          current.dev !== record.dev ||
          current.ino !== record.ino
        )
          throw new PrReviewLeaseError(
            "original directory changed before removal",
          );
        if ((await readdir(target)).length !== 0)
          throw new PrReviewLeaseError(
            "original resource has unexpected remaining entries",
          );
        await rmdir(target);
      }
      operation.removed_resources.push(record.resource);
      operation.pending_leaf = null;
      await save();
    }
    await binding();
    const leasePath = path.join(identity.primaryRoot, request.lease_file);
    if (
      (await readFile(leasePath, "utf8")) === operation.original_lease &&
      operation.original_lease !== operation.released_lease
    )
      await writeTextAtomically(leasePath, operation.released_lease);
    if ((await readFile(leasePath, "utf8")) !== operation.released_lease)
      throw new PrReviewLeaseError("released lease publication uncertain");
    operation.outcome = "retired";
    await save();
    if (
      !(await removeOwnedReservation(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      ))
    )
      return output("held", "reservation release uncertain");
    return output("retired", null);
  } catch (err) {
    return output("held", err instanceof Error ? err.message : String(err));
  }
}

interface SessionAdvanceOperation {
  schema: "pr-review/session-advance-operation/v1";
  reservation: SessionCreateReservation;
  old_head: string;
  archive_file: string;
  archive_sha256: string;
  successor_bytes: string;
  continuation_file: string | null;
  continuation_sha256: string | null;
  artifacts: { file: string; sha256: string; dev: number; ino: number }[];
  pending_file: string | null;
  removed_files: string[];
  outcome: "held" | "complete";
}
function sessionAdvanceOperationFile(
  identity: DiscoveryIdentity,
  token: string,
): string {
  if (!/^[0-9a-f-]{36}$/u.test(token))
    throw new PrReviewLeaseError("invalid session operation token");
  return path.join(
    identity.primaryRoot,
    `.ephemeral/pr-${identity.prNumber}-session-advance-${token}.json`,
  );
}
async function reconcileSession(
  args: readonly string[],
): Promise<RuntimeCommandOutcome> {
  if (args.length !== 2 || args[0] !== "--invocation-token")
    throw new PrReviewLeaseError(
      "session-reconcile requires exactly --invocation-token <same-operation-token>",
    );
  const identity = await readDiscoveryIdentity();
  const operationFile = sessionAdvanceOperationFile(
    identity,
    args[1] as string,
  );
  await assertOriginalRecordPath(operationFile);
  let operationBytes = await readFile(operationFile, "utf8");
  const value = parseOriginalReviewJson(operationBytes);
  assertClosedOriginalObject(value, [
    "schema",
    "reservation",
    "old_head",
    "archive_file",
    "archive_sha256",
    "successor_bytes",
    "continuation_file",
    "continuation_sha256",
    "artifacts",
    "pending_file",
    "removed_files",
    "outcome",
  ]);
  const operation = value as unknown as SessionAdvanceOperation;
  const reservation = operation.reservation;
  if (
    operation.schema !== "pr-review/session-advance-operation/v1" ||
    !isClosedSessionCreateReservation(reservation, reservation, true) ||
    reservation.invocation_token !== args[1] ||
    reservation.repository !== identity.repository ||
    reservation.pr_number !== identity.prNumber ||
    reservation.primary_repository_root !== identity.primaryRoot ||
    !SHA_RE.test(operation.old_head) ||
    !SHA256_RE.test(operation.archive_sha256) ||
    typeof operation.successor_bytes !== "string" ||
    sha256Text(operation.successor_bytes) !==
      reservation.expected_lease_sha256 ||
    !Array.isArray(operation.artifacts) ||
    !Array.isArray(operation.removed_files) ||
    !["held", "complete"].includes(operation.outcome)
  )
    throw new PrReviewLeaseError(
      "session reconciliation operation binding invalid",
    );
  validateDirectChild(
    "archived lease",
    operation.archive_file,
    "-archived-lease.json",
  );
  await assertReadableDirectChild(
    identity.primaryRoot,
    operation.archive_file,
    "archived lease",
  );
  const archiveBytes = await readFile(
    path.join(identity.primaryRoot, operation.archive_file),
    "utf8",
  );
  if (sha256Text(archiveBytes) !== operation.archive_sha256)
    throw new PrReviewLeaseError("session reconciliation archive changed");
  const oldLease = parseOriginalReviewJson(archiveBytes) as PrReviewLease;
  const newLease = parseOriginalReviewJson(
    operation.successor_bytes,
  ) as PrReviewLease;
  validateLeaseShape(oldLease);
  validateLeaseShape(newLease);
  if (
    newLease.state !== "created" ||
    Object.values(newLease.artifacts).some((artifact) => artifact !== null) ||
    newLease.preparation_failures !== undefined ||
    newLease.github.github_post_attempted ||
    oldLease.worktree_path !== reservation.canonical_worktree_path ||
    oldLease.repository !== identity.repository ||
    oldLease.pr_number !== identity.prNumber ||
    oldLease.lease_file !== reservation.lease_file ||
    newLease.worktree_path !== oldLease.worktree_path ||
    newLease.lease_file !== oldLease.lease_file ||
    operation.archive_file !==
      terminalArchivePath(oldLease, identity.prNumber) ||
    reservation.canonical_worktree_path !==
      (await canonicalPrReviewWorktreePath(identity))
  )
    throw new PrReviewLeaseError(
      "session reconciliation cannot inherit or substitute authority",
    );
  const files = new Set<string>();
  for (const artifact of operation.artifacts) {
    assertClosedOriginalObject(artifact, ["file", "sha256", "dev", "ino"]);
    validateDirectChild("session artifact", artifact.file);
    if (
      files.has(artifact.file) ||
      !SHA256_RE.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.dev) ||
      !Number.isSafeInteger(artifact.ino)
    )
      throw new PrReviewLeaseError("invalid session reconciliation artifacts");
    files.add(artifact.file);
  }
  if (
    new Set(operation.removed_files).size !== operation.removed_files.length ||
    operation.removed_files.some((file) => !files.has(file)) ||
    (operation.pending_file !== null && !files.has(operation.pending_file)) ||
    (operation.outcome === "complete" &&
      operation.removed_files.length !== files.size)
  )
    throw new PrReviewLeaseError("session reconciliation progress invalid");
  const reservationFile = `.ephemeral/pr-${identity.prNumber}-session-create-reservation.json`;
  const reservationBytes = `${JSON.stringify(reservation)}\n`;
  const leasePath = path.join(identity.primaryRoot, reservation.lease_file);
  async function binding() {
    if ((await readFile(operationFile, "utf8")) !== operationBytes)
      throw new PrReviewLeaseError("session reconciliation operation changed");
    if (
      (await readFile(
        path.join(identity.primaryRoot, operation.archive_file),
        "utf8",
      )) !== archiveBytes
    )
      throw new PrReviewLeaseError("session reconciliation archive changed");
    if (
      operation.outcome !== "complete" &&
      !(await reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      ))
    )
      throw new PrReviewLeaseError(
        "session reconciliation reservation changed",
      );
    await assertEphemeralDirectory(reservation.canonical_worktree_path);
    const leaseBytes = await readFile(leasePath, "utf8");
    if (leaseBytes !== archiveBytes && leaseBytes !== operation.successor_bytes)
      throw new PrReviewLeaseError("session reconciliation lease changed");
    if (await isWorktreeDirty(reservation.canonical_worktree_path))
      throw new PrReviewLeaseError("session reconciliation worktree dirty");
    const head = (
      await execFileAsync("git", [
        "-C",
        reservation.canonical_worktree_path,
        "rev-parse",
        "HEAD",
      ])
    ).stdout.trim();
    if (
      operation.outcome === "complete" &&
      (head !== reservation.immutable_head ||
        leaseBytes !== operation.successor_bytes)
    )
      throw new PrReviewLeaseError(
        "completed session operation no longer matches current successor",
      );
    if (head !== operation.old_head && head !== reservation.immutable_head)
      throw new PrReviewLeaseError(
        "session reconciliation worktree head uncertain",
      );
    if (
      (await verifyCreatedSessionWorktree(
        identity.primaryRoot,
        reservation.canonical_worktree_path,
        reservation.common_git_directory,
        head,
        head !== operation.old_head,
      )) === null
    )
      throw new PrReviewLeaseError(
        "session reconciliation registration changed",
      );
    if (operation.continuation_file !== null) {
      await assertOriginalRecordPath(operation.continuation_file);
      if (
        sha256Text(await readFile(operation.continuation_file, "utf8")) !==
          operation.continuation_sha256 ||
        process.env.CONTINUATION_REQUEST_FILE !== operation.continuation_file
      )
        throw new PrReviewLeaseError(
          "session reconciliation continuation action changed or not supplied",
        );
      await validateAttemptContinuation(
        identity,
        oldLease,
        archiveBytes,
        operation.old_head,
        reservation.immutable_head,
      );
    } else if (operation.continuation_sha256 !== null)
      throw new PrReviewLeaseError("session reconciliation action malformed");
  }
  async function save() {
    operationBytes = `${JSON.stringify(operation)}\n`;
    await writeTextAtomically(operationFile, operationBytes);
  }
  async function finishArtifacts() {
    for (const artifact of operation.artifacts) {
      await binding();
      const target = path.join(
        reservation.canonical_worktree_path,
        artifact.file,
      );
      const entry = await lstat(target).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      });
      if (operation.removed_files.includes(artifact.file)) {
        if (entry !== null)
          throw new PrReviewLeaseError("retired session artifact reappeared");
        continue;
      }
      if (entry === null) {
        if (operation.pending_file !== artifact.file)
          throw new PrReviewLeaseError(
            "session artifact absent without exact operation evidence",
          );
      } else {
        await assertReadableDirectChild(
          reservation.canonical_worktree_path,
          artifact.file,
          "session artifact",
        );
        if (
          entry.dev !== artifact.dev ||
          entry.ino !== artifact.ino ||
          sha256Text(await readFile(target, "utf8")) !== artifact.sha256
        )
          throw new PrReviewLeaseError(
            "session artifact identity or bytes changed",
          );
        try {
          await execFileAsync("git", [
            "-C",
            reservation.canonical_worktree_path,
            "ls-files",
            "--error-unmatch",
            "--",
            artifact.file,
          ]);
          throw new PrReviewLeaseError("session artifact is tracked");
        } catch (err) {
          if ((err as { code?: unknown }).code !== 1) throw err;
        }
        operation.pending_file = artifact.file;
        await save();
        await binding();
        await rm(target);
      }
      operation.removed_files.push(artifact.file);
      operation.pending_file = null;
      await save();
    }
  }
  try {
    await binding();
    if (operation.outcome !== "complete") {
      const head = (
        await execFileAsync("git", [
          "-C",
          reservation.canonical_worktree_path,
          "rev-parse",
          "HEAD",
        ])
      ).stdout.trim();
      if (head === operation.old_head) {
        if (
          (await readFile(leasePath, "utf8")) !== archiveBytes ||
          operation.removed_files.length !== 0 ||
          operation.pending_file !== null
        )
          throw new PrReviewLeaseError(
            "session reconciliation old-head effects uncertain",
          );
        await execFileAsync("git", [
          "-C",
          reservation.canonical_worktree_path,
          "checkout",
          "--no-overwrite-ignore",
          "--detach",
          reservation.immutable_head,
        ]);
        await binding();
      }
      if ((await readFile(leasePath, "utf8")) === archiveBytes) {
        await binding();
        await writeTextAtomically(leasePath, operation.successor_bytes);
      }
      await finishArtifacts();
      const registration = await verifyCreatedSessionWorktree(
        identity.primaryRoot,
        reservation.canonical_worktree_path,
        reservation.common_git_directory,
        reservation.immutable_head,
      );
      if (
        registration === null ||
        !(await verifySessionCreateFinalState({
          identity,
          commonGitDirectory: reservation.common_git_directory,
          headSha: reservation.immutable_head,
          lease: newLease,
          leaseBytes: operation.successor_bytes,
          leaseSha256: reservation.expected_lease_sha256,
          registration,
        }))
      )
        throw new PrReviewLeaseError(
          "session reconciliation final state uncertain",
        );
      operation.outcome = "complete";
      await save();
    }
    await binding();
    await finishArtifacts();
    if (
      (await pathExists(path.join(identity.primaryRoot, reservationFile))) &&
      !(await removeOwnedReservation(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      ))
    )
      throw new PrReviewLeaseError(
        "session reconciliation reservation release uncertain",
      );
    return sessionCreateSuccess(
      identity,
      reservation.common_git_directory,
      reservation.canonical_worktree_path,
      reservation.immutable_head,
      reservation.lease_file,
      reservation.expected_lease_sha256,
    );
  } catch (err) {
    return {
      exitCode: 1,
      stdout: `${JSON.stringify({ schema: "pr-review/session-reconciliation/v1", outcome: "held", invocation_token: reservation.invocation_token, operation_file: operationFile, reason: err instanceof Error ? err.message : String(err) })}\n`,
      stderr: "",
    };
  }
}

async function sessionCreatePreflight(): Promise<RuntimeCommandOutcome> {
  const identity = await readDiscoveryIdentity();
  const headSha = requiredEnv("HEAD_SHA");
  if (!SHA_RE.test(headSha)) {
    throw new PrReviewLeaseError("HEAD_SHA must be a lowercase 40-hex SHA");
  }
  const baseRef = requiredEnv("BASE_REF");
  const headRef = requiredEnv("HEAD_REF");
  if (baseRef.trim() === "" || headRef.trim() === "") {
    throw new PrReviewLeaseError("BASE_REF and HEAD_REF must be nonblank");
  }
  const updatedAt = process.env.UPDATED_AT ?? nowTimestamp();
  validateTimestamp("UPDATED_AT", updatedAt);
  const allowTerminalAdvance = optionalTerminalAdvance();
  await assertPrimaryGitBinding(identity.primaryRoot);
  await assertGitCommit(identity.primaryRoot, headSha);

  const discovery = await discoverReviewSession();
  if (
    allowTerminalAdvance ||
    optionalEnv("CONTINUATION_REQUEST_FILE") !== undefined
  ) {
    return await sessionCreateTerminalAdvance({
      identity,
      headSha,
      baseRef,
      headRef,
      updatedAt,
      discovery,
    });
  }
  if (hasLifecycleReentry(discovery)) {
    return sessionCreateConflict("lifecycle-reentry-required", []);
  }
  if (discovery.disposition !== "create") {
    return sessionCreateConflict("discovery-not-create", []);
  }

  const commonGitDirectory = await gitDirectory(
    identity.primaryRoot,
    "--git-common-dir",
  );
  const worktreePath = discovery.canonical_worktree_path;
  const worktreeDigest = digestPath(worktreePath);
  const leaseFile = `.ephemeral/pr-${identity.prNumber}-${worktreeDigest}-lease.json`;
  const lease = reducePrReviewLease(
    null,
    {
      repository: identity.repository,
      prNumber: identity.prNumber,
      worktreePath,
      worktreeDigest,
      leaseFile,
    },
    {
      state: "created",
      baseRef,
      headRef,
      createdAt: updatedAt,
      updatedAt,
    },
  );
  validateLeaseShape(lease);
  const leaseBytes = `${JSON.stringify(lease, null, 2)}\n`;
  const leaseSha256 = sha256Text(leaseBytes);
  const reservation: SessionCreateReservation = {
    schema: "pr-review/session-create-reservation/v1",
    invocation_token: randomUUID(),
    repository: identity.repository,
    pr_number: identity.prNumber,
    primary_repository_root: identity.primaryRoot,
    common_git_directory: commonGitDirectory,
    canonical_worktree_path: worktreePath,
    immutable_head: headSha,
    lease_file: leaseFile,
    expected_lease_sha256: leaseSha256,
  };
  const reservationFile = `.ephemeral/pr-${identity.prNumber}-session-create-reservation.json`;
  const reservationBytes = `${JSON.stringify(reservation)}\n`;

  const reservationState = await acquireSessionCreateReservation(
    identity.primaryRoot,
    reservationFile,
    reservation,
    reservationBytes,
  );
  if (reservationState === "contended") {
    return sessionCreateConflict("reservation-contended", ["reservation"]);
  }
  if (reservationState !== "acquired") {
    return sessionCreateManualCleanup(
      "reservation-unverifiable",
      reservation,
      null,
      null,
      ["reservation"],
    );
  }

  try {
    const postReservationDiscovery = await discoverReviewSession();
    if (
      hasLifecycleReentry(postReservationDiscovery) ||
      postReservationDiscovery.disposition !== "create"
    ) {
      if (
        await removeOwnedReservation(
          identity.primaryRoot,
          reservationFile,
          reservation,
          reservationBytes,
        )
      ) {
        return sessionCreateConflict(
          hasLifecycleReentry(postReservationDiscovery)
            ? "lifecycle-reentry-required"
            : "discovery-not-create",
          [],
        );
      }
      return sessionCreateManualCleanup(
        "rollback-incomplete",
        reservation,
        null,
        null,
        ["reservation"],
      );
    }

    if (
      !(await reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      ))
    ) {
      return sessionCreateManualCleanup(
        "reservation-unverifiable",
        reservation,
        null,
        null,
        ["reservation"],
      );
    }

    try {
      await execFileAsync("git", [
        "-C",
        identity.primaryRoot,
        "worktree",
        "add",
        "--detach",
        worktreePath,
        headSha,
      ]);
    } catch {
      const registration = await verifyCreatedSessionWorktree(
        identity.primaryRoot,
        worktreePath,
        commonGitDirectory,
        headSha,
      );
      const registrationState = await registeredWorktreeState(
        identity.primaryRoot,
        worktreePath,
      );
      if (
        registration === null &&
        ((await pathExists(worktreePath)) || registrationState !== "absent")
      ) {
        return sessionCreateManualCleanup(
          "worktree-unverifiable",
          reservation,
          null,
          null,
          ["reservation", "worktree"],
        );
      }
      return await sessionCreateRollbackResult({
        conflictReason: "worktree-create-failed",
        manualReason: "rollback-incomplete",
        identity,
        reservation,
        reservationFile,
        reservationBytes,
        registration,
        leaseBytes: null,
        leaseSha256: null,
        worktreeCreated: registration !== null,
      });
    }

    const registration = await verifyCreatedSessionWorktree(
      identity.primaryRoot,
      worktreePath,
      commonGitDirectory,
      headSha,
    );
    if (registration === null) {
      return await sessionCreateRollbackResult({
        conflictReason: "final-verification-failed",
        manualReason: "worktree-unverifiable",
        identity,
        reservation,
        reservationFile,
        reservationBytes,
        registration: null,
        leaseBytes: null,
        leaseSha256: null,
        worktreeCreated: true,
      });
    }

    if (
      !(await reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      ))
    ) {
      return sessionCreateManualCleanup(
        "reservation-unverifiable",
        reservation,
        registration,
        null,
        ["reservation", "worktree", "registration"],
      );
    }

    const leasePublication = await publishSessionCreateLease(
      identity.primaryRoot,
      leaseFile,
      leaseBytes,
    );
    if (leasePublication !== "published") {
      if (leasePublication === "not-published") {
        return await sessionCreateRollbackResult({
          conflictReason: "lease-create-failed",
          manualReason: "lease-unverifiable",
          identity,
          reservation,
          reservationFile,
          reservationBytes,
          registration,
          leaseBytes: null,
          leaseSha256: null,
          worktreeCreated: true,
        });
      }
      return sessionCreateManualCleanup(
        "lease-unverifiable",
        reservation,
        registration,
        leasePublication === "published-unverifiable" ? leaseSha256 : null,
        ["reservation", "worktree", "registration", "lease"],
      );
    }

    if (
      !(await verifySessionCreateFinalState({
        identity,
        commonGitDirectory,
        headSha,
        lease,
        leaseBytes,
        leaseSha256,
        registration,
      }))
    ) {
      // A linked LC-01 lease is the creation commit point: discovery can now
      // legitimately resume it. Do not roll back that visible session.
      return sessionCreateManualCleanup(
        "lease-unverifiable",
        reservation,
        registration,
        leaseSha256,
        ["reservation", "worktree", "registration", "lease"],
      );
    }

    if (
      !(await removeOwnedReservation(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      ))
    ) {
      return sessionCreateManualCleanup(
        "rollback-incomplete",
        reservation,
        registration,
        leaseSha256,
        ["reservation", "worktree", "registration", "lease"],
      );
    }

    return sessionCreateSuccess(
      identity,
      commonGitDirectory,
      worktreePath,
      headSha,
      leaseFile,
      leaseSha256,
    );
  } catch {
    const observed: ObservedArtifact[] = ["reservation"];
    try {
      if (await pathExists(worktreePath)) observed.push("worktree");
      if (
        (await registeredWorktreeState(identity.primaryRoot, worktreePath)) ===
        "present"
      ) {
        observed.push("registration");
      }
      if (await pathExists(path.join(identity.primaryRoot, leaseFile))) {
        observed.push("lease");
      }
    } catch {
      // The closed manual-cleanup result still preserves the known reservation.
    }
    return sessionCreateManualCleanup(
      "rollback-incomplete",
      reservation,
      null,
      null,
      observed,
    );
  }
}

function optionalTerminalAdvance(): boolean {
  const value = process.env.ALLOW_TERMINAL_ADVANCE;
  if (value === undefined) return false;
  if (value !== "yes") {
    throw new PrReviewLeaseError(
      "ALLOW_TERMINAL_ADVANCE must be yes when supplied",
    );
  }
  return true;
}

async function sessionCreateTerminalAdvance({
  identity,
  headSha,
  baseRef,
  headRef,
  updatedAt,
  discovery,
}: {
  identity: DiscoveryIdentity;
  headSha: string;
  baseRef: string;
  headRef: string;
  updatedAt: string;
  discovery: PrReviewSessionDiscovery;
}): Promise<RuntimeCommandOutcome> {
  const commonGitDirectory = await gitDirectory(
    identity.primaryRoot,
    "--git-common-dir",
  );
  const candidate = await terminalAdvanceCandidate(
    identity,
    discovery,
    commonGitDirectory,
    headSha,
  );
  if (candidate === null) {
    return sessionCreateConflict("discovery-not-create", []);
  }

  const worktreeDigest = digestPath(candidate.worktreePath);
  const lease = reducePrReviewLease(
    optionalEnv("CONTINUATION_REQUEST_FILE") === undefined
      ? candidate.lease
      : null,
    {
      repository: identity.repository,
      prNumber: identity.prNumber,
      worktreePath: candidate.worktreePath,
      worktreeDigest,
      leaseFile: candidate.leaseFile,
    },
    {
      state: "created",
      baseRef,
      headRef,
      createdAt: updatedAt,
      updatedAt,
    },
  );
  validateLeaseShape(lease);
  const leaseBytes = `${JSON.stringify(lease, null, 2)}\n`;
  const leaseSha256 = sha256Text(leaseBytes);
  const reservation: SessionCreateReservation = {
    schema: "pr-review/session-create-reservation/v1",
    invocation_token: randomUUID(),
    repository: identity.repository,
    pr_number: identity.prNumber,
    primary_repository_root: identity.primaryRoot,
    common_git_directory: commonGitDirectory,
    canonical_worktree_path: candidate.worktreePath,
    immutable_head: headSha,
    lease_file: candidate.leaseFile,
    expected_lease_sha256: leaseSha256,
  };
  const reservationFile = `.ephemeral/pr-${identity.prNumber}-session-create-reservation.json`;
  const reservationBytes = `${JSON.stringify(reservation)}\n`;
  const reservationState = await acquireSessionCreateReservation(
    identity.primaryRoot,
    reservationFile,
    reservation,
    reservationBytes,
  );
  if (reservationState === "contended") {
    return sessionCreateConflict("reservation-contended", ["reservation"]);
  }
  if (reservationState !== "acquired") {
    return sessionCreateManualCleanup(
      "reservation-unverifiable",
      reservation,
      null,
      null,
      ["reservation"],
    );
  }

  let registration: RegistrationIdentity | null = null;
  const observed: ObservedArtifact[] = ["reservation"];
  let published = false;
  try {
    const revalidated = await terminalAdvanceCandidate(
      identity,
      await discoverReviewSession(),
      commonGitDirectory,
      headSha,
    );
    if (
      revalidated === null ||
      revalidated.leaseFile !== candidate.leaseFile ||
      revalidated.leaseBytes !== candidate.leaseBytes ||
      revalidated.oldHead !== candidate.oldHead ||
      revalidated.continuationBytes !== candidate.continuationBytes
    ) {
      return await terminalAdvancePreAdvanceResult(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      );
    }
    let snapshots: TerminalArtifactSnapshot[];
    try {
      snapshots = await snapshotTerminalArtifacts(
        candidate.lease,
        candidate.worktreePath,
      );
    } catch {
      return await terminalAdvancePreAdvanceResult(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      );
    }
    if (
      !(await reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      )) ||
      !(await directSessionLeaseMatches(
        identity.primaryRoot,
        candidate.leaseFile,
        candidate.leaseBytes,
        sha256Text(candidate.leaseBytes),
      ))
    ) {
      return await terminalAdvancePreAdvanceResult(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      );
    }

    const archive = terminalArchivePath(candidate.lease, identity.prNumber);
    try {
      await assertWritableDirectChild(
        identity.primaryRoot,
        archive,
        "archived lease",
      );
      await writeTerminalArchive(
        path.join(identity.primaryRoot, candidate.leaseFile),
        path.join(identity.primaryRoot, archive),
        Buffer.from(candidate.leaseBytes, "utf8"),
      );
    } catch {
      return await terminalAdvancePreAdvanceResult(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      );
    }

    const operation: SessionAdvanceOperation = {
      schema: "pr-review/session-advance-operation/v1",
      reservation,
      old_head: candidate.oldHead,
      archive_file: archive,
      archive_sha256: sha256Text(candidate.leaseBytes),
      successor_bytes: leaseBytes,
      continuation_file: optionalEnv("CONTINUATION_REQUEST_FILE") ?? null,
      continuation_sha256:
        candidate.continuationBytes === undefined
          ? null
          : sha256Text(candidate.continuationBytes),
      artifacts: snapshots.map((snapshot) => ({
        file: snapshot.file,
        sha256: createHash("sha256").update(snapshot.bytes).digest("hex"),
        dev: snapshot.dev,
        ino: snapshot.ino,
      })),
      pending_file: null,
      removed_files: [],
      outcome: "held",
    };
    const operationFile = sessionAdvanceOperationFile(
      identity,
      reservation.invocation_token,
    );
    await assertOriginalRecordPath(operationFile, true);
    await writeFile(operationFile, `${JSON.stringify(operation)}\n`, {
      flag: "wx",
    });
    if (candidate.continuationBytes !== undefined) {
      if (
        (await readFile(requiredEnv("CONTINUATION_REQUEST_FILE"), "utf8")) !==
        candidate.continuationBytes
      )
        throw new PrReviewLeaseError("continuation current action changed");
      await validateAttemptContinuation(
        identity,
        candidate.lease,
        candidate.leaseBytes,
        candidate.oldHead,
        headSha,
      );
    }
    try {
      await execFileAsync("git", [
        "-C",
        candidate.worktreePath,
        "checkout",
        "--no-overwrite-ignore",
        "--detach",
        headSha,
      ]);
    } catch {
      observed.length = 0;
      try {
        if (
          await pathExists(path.join(identity.primaryRoot, reservationFile))
        ) {
          observed.push("reservation");
        }
        if (await pathExists(candidate.worktreePath)) {
          observed.push("worktree");
        }
        registration = await verifyCreatedSessionWorktree(
          identity.primaryRoot,
          candidate.worktreePath,
          commonGitDirectory,
          headSha,
        );
        if (registration !== null) {
          observed.push("registration");
        }
        if (
          await pathExists(path.join(identity.primaryRoot, candidate.leaseFile))
        ) {
          observed.push("lease");
        }
      } catch {
        // Keep only evidence successfully observed before inspection failed.
      }
      return terminalAdvanceManualCleanup(
        reservation,
        registration,
        null,
        observed,
      );
    }
    observed.length = 0;
    if (await pathExists(path.join(identity.primaryRoot, reservationFile))) {
      observed.push("reservation");
    }
    if (await pathExists(candidate.worktreePath)) {
      observed.push("worktree");
    }
    registration = await verifyCreatedSessionWorktree(
      identity.primaryRoot,
      candidate.worktreePath,
      commonGitDirectory,
      headSha,
    );
    if (registration !== null) {
      observed.push("registration");
    }
    if (
      await pathExists(path.join(identity.primaryRoot, candidate.leaseFile))
    ) {
      observed.push("lease");
    }
    if (registration === null) {
      return terminalAdvanceManualCleanup(reservation, null, null, observed);
    }
    await assertWritableDirectChild(
      identity.primaryRoot,
      candidate.leaseFile,
      "lease",
    );
    const [leaseOwned, archiveOwned, reservationOwned] = await Promise.all([
      directSessionLeaseMatches(
        identity.primaryRoot,
        candidate.leaseFile,
        candidate.leaseBytes,
        sha256Text(candidate.leaseBytes),
      ),
      directSessionLeaseMatches(
        identity.primaryRoot,
        archive,
        candidate.leaseBytes,
        sha256Text(candidate.leaseBytes),
      ),
      reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      ),
    ]);
    if (!leaseOwned || !archiveOwned || !reservationOwned) {
      return terminalAdvanceManualCleanup(
        reservation,
        registration,
        null,
        observed,
      );
    }
    if (candidate.continuationBytes !== undefined) {
      if (
        (await readFile(requiredEnv("CONTINUATION_REQUEST_FILE"), "utf8")) !==
        candidate.continuationBytes
      )
        throw new PrReviewLeaseError("continuation current action changed");
      await validateAttemptContinuation(
        identity,
        candidate.lease,
        candidate.leaseBytes,
        candidate.oldHead,
        headSha,
      );
    }
    await writeTextAtomically(
      path.join(identity.primaryRoot, candidate.leaseFile),
      leaseBytes,
    );
    published = true;
    if (
      !(await removeTerminalArtifacts(
        candidate.worktreePath,
        snapshots,
        async (file, removed) => {
          if (
            !(await reservationMatches(
              path.join(identity.primaryRoot, reservationFile),
              reservation,
              reservationBytes,
            ))
          )
            throw new PrReviewLeaseError(
              "session advancement reservation changed",
            );
          if (removed) {
            operation.removed_files.push(file);
            operation.pending_file = null;
          } else operation.pending_file = file;
          await writeTextAtomically(
            operationFile,
            `${JSON.stringify(operation)}\n`,
          );
        },
      ))
    ) {
      return terminalAdvanceManualCleanup(
        reservation,
        registration,
        leaseSha256,
        observed,
      );
    }
    if (
      !(await verifySessionCreateFinalState({
        identity,
        commonGitDirectory,
        headSha,
        lease,
        leaseBytes,
        leaseSha256,
        registration,
      })) ||
      !(await directSessionLeaseMatches(
        identity.primaryRoot,
        archive,
        candidate.leaseBytes,
        sha256Text(candidate.leaseBytes),
      ))
    ) {
      return terminalAdvanceManualCleanup(
        reservation,
        registration,
        leaseSha256,
        observed,
      );
    }
    operation.outcome = "complete";
    await writeTextAtomically(operationFile, `${JSON.stringify(operation)}\n`);
    if (
      !(await removeOwnedReservation(
        identity.primaryRoot,
        reservationFile,
        reservation,
        reservationBytes,
      ))
    ) {
      const currentObserved: ObservedArtifact[] = observed.filter(
        (artifact) => artifact !== "reservation",
      );
      if (await pathExists(path.join(identity.primaryRoot, reservationFile))) {
        currentObserved.unshift("reservation");
      }
      return terminalAdvanceManualCleanup(
        reservation,
        registration,
        leaseSha256,
        currentObserved,
      );
    }
    return sessionCreateSuccess(
      identity,
      commonGitDirectory,
      candidate.worktreePath,
      headSha,
      candidate.leaseFile,
      leaseSha256,
    );
  } catch {
    return terminalAdvanceManualCleanup(
      reservation,
      registration,
      published ? leaseSha256 : null,
      observed,
    );
  }
}

async function terminalAdvancePreAdvanceResult(
  primaryRoot: string,
  reservationFile: string,
  reservation: SessionCreateReservation,
  reservationBytes: string,
): Promise<RuntimeCommandOutcome> {
  if (
    await removeOwnedReservation(
      primaryRoot,
      reservationFile,
      reservation,
      reservationBytes,
    )
  ) {
    return sessionCreateConflict("discovery-not-create", []);
  }
  const observed: ObservedArtifact[] = [];
  if (await pathExists(path.join(primaryRoot, reservationFile))) {
    observed.push("reservation");
  }
  return sessionCreateManualCleanup(
    "rollback-incomplete",
    reservation,
    null,
    null,
    observed,
  );
}

function terminalAdvanceManualCleanup(
  reservation: SessionCreateReservation,
  registration: RegistrationIdentity | null,
  leaseSha256: string | null,
  observed: ObservedArtifact[],
): RuntimeCommandOutcome {
  return sessionCreateManualCleanup(
    "rollback-incomplete",
    reservation,
    registration,
    leaseSha256,
    observed,
  );
}

async function validateAttemptContinuation(
  identity: DiscoveryIdentity,
  lease: PrReviewLease,
  leaseBytes: string,
  oldHead: string,
  targetHead: string,
): Promise<void> {
  const requestFile = requiredEnv("CONTINUATION_REQUEST_FILE");
  await assertOriginalRecordPath(requestFile);
  if (path.dirname(path.dirname(requestFile)) !== identity.primaryRoot)
    throw new PrReviewLeaseError(
      "continuation request must be in physical primary",
    );
  const value = parseOriginalReviewJson(await readFile(requestFile, "utf8"));
  assertClosedOriginalObject(value, [
    "schema",
    "repository",
    "pr_number",
    "worktree_path",
    "old_head",
    "target_head",
    "lease_file",
    "lease_sha256",
    "authority_ref",
    "active_consumers",
    "pending_effects",
    "publication",
    "provider_evidence",
    "baseline",
    "continuity",
  ]);
  if (
    value.schema !== "pr-review/attempt-continuation/v1" ||
    value.repository !== identity.repository ||
    value.pr_number !== identity.prNumber ||
    value.worktree_path !== lease.worktree_path ||
    value.old_head !== oldHead ||
    value.target_head !== targetHead ||
    value.lease_file !== lease.lease_file ||
    value.lease_sha256 !== sha256Text(leaseBytes) ||
    typeof value.authority_ref !== "string" ||
    value.authority_ref.trim() === "" ||
    !Array.isArray(value.active_consumers) ||
    value.active_consumers.length ||
    !Array.isArray(value.pending_effects) ||
    value.pending_effects.length ||
    !Array.isArray(value.continuity) ||
    !["completed", "incomplete"].includes(String(value.baseline))
  )
    throw new PrReviewLeaseError(
      "continuation identity, authority or exhausted purpose mismatch",
    );
  assertClosedOriginalObject(value.publication, ["status", "references"]);
  const publication = value.publication;
  if (
    !["not-required", "published"].includes(String(publication.status)) ||
    !Array.isArray(publication.references) ||
    (publication.status === "published"
      ? publication.references.length === 0
      : publication.references.length !== 0) ||
    publication.references.some(
      (reference) =>
        typeof reference !== "string" ||
        !reference.startsWith(`https://github.com/${identity.repository}/`),
    )
  )
    throw new PrReviewLeaseError("continuation durable publication unresolved");
  assertClosedOriginalObject(value.provider_evidence, ["file", "sha256"]);
  const provider = value.provider_evidence;
  if (
    typeof provider.file !== "string" ||
    typeof provider.sha256 !== "string" ||
    !SHA256_RE.test(provider.sha256)
  )
    throw new PrReviewLeaseError("continuation provider evidence invalid");
  await assertOriginalRecordPath(provider.file);
  if (path.dirname(path.dirname(provider.file)) !== identity.primaryRoot)
    throw new PrReviewLeaseError(
      "continuation provider evidence must outlive checkout",
    );
  const providerBytes = await readFile(provider.file, "utf8");
  if (sha256Text(providerBytes) !== provider.sha256)
    throw new PrReviewLeaseError("continuation provider evidence changed");
  const providerValue = parseOriginalReviewJson(providerBytes);
  if (
    !isObject(providerValue) ||
    providerValue.repository !== identity.repository ||
    providerValue.pr_number !== identity.prNumber ||
    providerValue.headRefOid !== targetHead
  )
    throw new PrReviewLeaseError(
      "continuation independently verified provider head mismatch",
    );
  const hasCompleteResult =
    lease.artifacts.result_file !== null &&
    lease.validation.result_manifest.status === "valid";
  if (
    (value.baseline === "completed") !== hasCompleteResult ||
    (["reviewed", "gated"].includes(lease.state) && !hasCompleteResult)
  )
    throw new PrReviewLeaseError(
      "continuation cannot fabricate or erase semantic completion",
    );
  const references = new Set<string>();
  for (const reference of value.continuity) {
    assertClosedOriginalObject(reference, ["file", "sha256"]);
    if (
      typeof reference.file !== "string" ||
      typeof reference.sha256 !== "string" ||
      !SHA256_RE.test(reference.sha256) ||
      references.has(reference.file) ||
      reference.file.startsWith(`${lease.worktree_path}${path.sep}`)
    )
      throw new PrReviewLeaseError(
        "continuation custody must be exact, distinct and accessible outside disposable checkout",
      );
    await assertOriginalRecordPath(reference.file);
    if (sha256Text(await readFile(reference.file, "utf8")) !== reference.sha256)
      throw new PrReviewLeaseError(
        "continuation custody changed or unavailable",
      );
    references.add(reference.file);
  }
}

async function terminalAdvanceCandidate(
  identity: DiscoveryIdentity,
  discovery: PrReviewSessionDiscovery,
  commonGitDirectory: string,
  headSha: string,
): Promise<TerminalAdvanceCandidate | null> {
  if (discovery.active.length !== 1) return null;
  const candidate = discovery.active[0];
  if (
    candidate === undefined ||
    (optionalEnv("CONTINUATION_REQUEST_FILE") === undefined
      ? candidate.classification !== "terminal" ||
        (candidate.state !== "posted" && candidate.state !== "aborted")
      : candidate.classification !== "resumable" ||
        !["reviewed", "gated", "failed"].includes(candidate.state ?? "")) ||
    candidate.worktree_path === null ||
    candidate.worktree_dirty !== false ||
    candidate.unmanaged_ephemeral_artifacts !== false ||
    normalizeComparablePath(candidate.worktree_path) !==
      normalizeComparablePath(discovery.canonical_worktree_path)
  ) {
    return null;
  }
  const leasePath = path.join(identity.primaryRoot, candidate.lease_file);
  try {
    const leaseBytes = await readFile(leasePath, "utf8");
    const lease = JSON.parse(leaseBytes) as PrReviewLease;
    validateLeaseShape(lease);
    if (
      (lease.preparation_failures?.length ?? 0) > 0 ||
      lease.state !== candidate.state ||
      lease.lease_file !== candidate.lease_file ||
      lease.worktree_path !== candidate.worktree_path ||
      lease.worktree_digest !== digestPath(candidate.worktree_path)
    ) {
      return null;
    }
    await validateReferencedArtifacts(lease, candidate.worktree_path, {
      validateResultAuthority: true,
      policy: "validate-stored-lease",
    });
    const oldHead = (
      await execFileAsync("git", [
        "-C",
        candidate.worktree_path,
        "rev-parse",
        "HEAD",
      ])
    ).stdout.trim();
    if (!SHA_RE.test(oldHead) || oldHead === headSha) return null;
    if (optionalEnv("CONTINUATION_REQUEST_FILE") !== undefined) {
      if (
        lease.artifacts.approved_review_file !== null ||
        lease.artifacts.validated_payload_file !== null ||
        lease.github.github_post_attempted ||
        lease.github.github_post_result !== "not-attempted"
      )
        return null;
      await validateAttemptContinuation(
        identity,
        lease,
        leaseBytes,
        oldHead,
        headSha,
      );
    }

    const registration = await verifyCreatedSessionWorktree(
      identity.primaryRoot,
      candidate.worktree_path,
      commonGitDirectory,
      oldHead,
      optionalEnv("CONTINUATION_REQUEST_FILE") === undefined,
    );
    if (registration === null) return null;
    return {
      lease,
      leaseBytes,
      worktreePath: candidate.worktree_path,
      leaseFile: candidate.lease_file,
      oldHead,
      ...(optionalEnv("CONTINUATION_REQUEST_FILE") === undefined
        ? {}
        : {
            continuationBytes: await readFile(
              requiredEnv("CONTINUATION_REQUEST_FILE"),
              "utf8",
            ),
          }),
    };
  } catch {
    return null;
  }
}

async function snapshotTerminalArtifacts(
  lease: PrReviewLease,
  worktreePath: string,
): Promise<TerminalArtifactSnapshot[]> {
  const files = await collectOwnedEphemeralArtifacts(lease, worktreePath);
  const snapshots: TerminalArtifactSnapshot[] = [];
  for (const file of files) {
    validateDirectChild("terminal artifact", file);
    let tracked = false;
    try {
      await execFileAsync("git", [
        "-C",
        worktreePath,
        "ls-files",
        "--error-unmatch",
        "--",
        file,
      ]);
      tracked = true;
    } catch (err) {
      if ((err as { code?: unknown }).code !== 1) throw err;
    }
    if (tracked) {
      throw new PrReviewLeaseError("terminal artifact is tracked");
    }
    const target = path.join(worktreePath, file);
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new PrReviewLeaseError(
        "terminal artifact missing or not a regular file",
      );
    }
    const bytes = await readFile(target);
    const after = await lstat(target);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    ) {
      throw new PrReviewLeaseError("terminal artifact identity changed");
    }
    snapshots.push({ file, bytes, dev: before.dev, ino: before.ino });
  }
  return snapshots;
}

async function removeTerminalArtifacts(
  worktreePath: string,
  snapshots: readonly TerminalArtifactSnapshot[],
  progress?: (file: string, removed: boolean) => Promise<void>,
): Promise<boolean> {
  if (!(await terminalArtifactsMatchSnapshots(worktreePath, snapshots))) {
    return false;
  }
  for (const snapshot of snapshots) {
    try {
      if (!(await terminalArtifactsMatchSnapshots(worktreePath, [snapshot])))
        return false;
      const target = path.join(worktreePath, snapshot.file);
      await progress?.(snapshot.file, false);
      await rm(target);
      await progress?.(snapshot.file, true);
    } catch {
      return false;
    }
  }
  return true;
}

async function terminalArtifactsMatchSnapshots(
  worktreePath: string,
  snapshots: readonly TerminalArtifactSnapshot[],
): Promise<boolean> {
  for (const snapshot of snapshots) {
    try {
      await execFileAsync("git", [
        "-C",
        worktreePath,
        "ls-files",
        "--error-unmatch",
        "--",
        snapshot.file,
      ]);
      return false;
    } catch (err) {
      if ((err as { code?: unknown }).code !== 1) return false;
    }
    try {
      const target = path.join(worktreePath, snapshot.file);
      const before = await lstat(target);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.dev !== snapshot.dev ||
        before.ino !== snapshot.ino ||
        !(await readFile(target)).equals(snapshot.bytes)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

async function assertPrimaryGitBinding(primaryRoot: string): Promise<void> {
  const { stdout } = await execFileAsync("git", [
    "-C",
    primaryRoot,
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
  ]);
  if ((await realpath(stdout.trim())) !== primaryRoot) {
    throw new PrReviewLeaseError(
      "PRIMARY_REPOSITORY_ROOT must be the physical Git worktree root",
    );
  }
  const registrations = await listRegisteredWorktrees(primaryRoot);
  const primaryRegistration = registrations[0];
  if (
    primaryRegistration === undefined ||
    (await realpath(primaryRegistration)) !== primaryRoot
  ) {
    throw new PrReviewLeaseError(
      "PRIMARY_REPOSITORY_ROOT must be the primary Git worktree",
    );
  }
}

async function assertGitCommit(
  primaryRoot: string,
  immutableHead: string,
): Promise<void> {
  try {
    const { stdout } = await execFileAsync("git", [
      "-C",
      primaryRoot,
      "cat-file",
      "-t",
      immutableHead,
    ]);
    if (stdout.trim() !== "commit") {
      throw new PrReviewLeaseError("HEAD_SHA must name an available commit");
    }
  } catch {
    throw new PrReviewLeaseError("HEAD_SHA must name an available commit");
  }
}

async function gitDirectory(
  workingDirectory: string,
  option: "--git-common-dir" | "--git-dir",
): Promise<string> {
  const { stdout } = await execFileAsync("git", [
    "-C",
    workingDirectory,
    "rev-parse",
    "--path-format=absolute",
    option,
  ]);
  return realpath(stdout.trim());
}

function hasLifecycleReentry(discovery: PrReviewSessionDiscovery): boolean {
  return discovery.active.some((entry) => entry.classification === "reentry");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function acquireSessionCreateReservation(
  primaryRoot: string,
  reservationFile: string,
  reservation: SessionCreateReservation,
  bytes: string,
): Promise<"acquired" | "contended" | "unverifiable"> {
  validateDirectChild("reservation", reservationFile);
  await assertEphemeralDirectory(primaryRoot);
  await mkdir(path.join(primaryRoot, ".ephemeral"), { recursive: true });
  const target = path.join(primaryRoot, reservationFile);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(target, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      return "unverifiable";
    }
    return (await isValidForeignReservation(target, reservation))
      ? "contended"
      : "unverifiable";
  }
  let writeSucceeded = true;
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } catch {
    writeSucceeded = false;
  }
  try {
    await handle.close();
  } catch {
    return "unverifiable";
  }
  if (!writeSucceeded) return "unverifiable";
  return (await reservationMatches(target, reservation, bytes))
    ? "acquired"
    : "unverifiable";
}

async function isValidForeignReservation(
  target: string,
  expected: SessionCreateReservation,
): Promise<boolean> {
  try {
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    const content = await readFile(target, "utf8");
    const after = await lstat(target);
    return (
      after.isFile() &&
      !after.isSymbolicLink() &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      content === `${JSON.stringify(JSON.parse(content) as unknown)}\n` &&
      isValidForeignSessionCreateReservation(
        JSON.parse(content) as unknown,
        expected,
      )
    );
  } catch {
    return false;
  }
}

function isClosedSessionCreateReservation(
  value: unknown,
  expected: SessionCreateReservation,
  requireExpectedToken: boolean,
): boolean {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  const expectedKeys = [
    "schema",
    "invocation_token",
    "repository",
    "pr_number",
    "primary_repository_root",
    "common_git_directory",
    "canonical_worktree_path",
    "immutable_head",
    "lease_file",
    "expected_lease_sha256",
  ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    return false;
  }
  const candidate = value as Partial<SessionCreateReservation>;
  return (
    candidate.schema === expected.schema &&
    typeof candidate.invocation_token === "string" &&
    candidate.invocation_token.length > 0 &&
    (!requireExpectedToken ||
      candidate.invocation_token === expected.invocation_token) &&
    candidate.repository === expected.repository &&
    candidate.pr_number === expected.pr_number &&
    candidate.primary_repository_root === expected.primary_repository_root &&
    candidate.common_git_directory === expected.common_git_directory &&
    candidate.canonical_worktree_path === expected.canonical_worktree_path &&
    candidate.immutable_head === expected.immutable_head &&
    candidate.lease_file === expected.lease_file &&
    candidate.expected_lease_sha256 === expected.expected_lease_sha256
  );
}

function isValidForeignSessionCreateReservation(
  value: unknown,
  expected: SessionCreateReservation,
): boolean {
  if (!isObject(value)) return false;
  const candidate = value as Partial<SessionCreateReservation>;
  const keys = Object.keys(candidate);
  const expectedKeys = [
    "schema",
    "invocation_token",
    "repository",
    "pr_number",
    "primary_repository_root",
    "common_git_directory",
    "canonical_worktree_path",
    "immutable_head",
    "lease_file",
    "expected_lease_sha256",
  ];
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    candidate.schema === expected.schema &&
    typeof candidate.invocation_token === "string" &&
    candidate.invocation_token.length > 0 &&
    candidate.repository === expected.repository &&
    candidate.pr_number === expected.pr_number &&
    candidate.primary_repository_root === expected.primary_repository_root &&
    candidate.common_git_directory === expected.common_git_directory &&
    candidate.canonical_worktree_path === expected.canonical_worktree_path &&
    typeof candidate.immutable_head === "string" &&
    SHA_RE.test(candidate.immutable_head) &&
    candidate.lease_file === expected.lease_file &&
    typeof candidate.expected_lease_sha256 === "string" &&
    SHA256_RE.test(candidate.expected_lease_sha256)
  );
}

async function reservationMatches(
  target: string,
  expected: SessionCreateReservation,
  bytes: string,
): Promise<boolean> {
  try {
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    const content = await readFile(target, "utf8");
    const after = await lstat(target);
    return (
      after.isFile() &&
      !after.isSymbolicLink() &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      content === bytes &&
      sha256Text(content) === sha256Text(bytes) &&
      isClosedSessionCreateReservation(
        JSON.parse(content) as unknown,
        expected,
        true,
      )
    );
  } catch {
    return false;
  }
}

async function removeOwnedReservation(
  primaryRoot: string,
  reservationFile: string,
  reservation: SessionCreateReservation,
  bytes: string,
): Promise<boolean> {
  const target = path.join(primaryRoot, reservationFile);
  if (!(await reservationMatches(target, reservation, bytes))) return false;
  try {
    await rm(target);
    return true;
  } catch {
    return false;
  }
}

async function verifyCreatedSessionWorktree(
  primaryRoot: string,
  worktreePath: string,
  commonGitDirectory: string,
  immutableHead: string,
  requireDetached = true,
): Promise<RegistrationIdentity | null> {
  try {
    if ((await realpath(worktreePath)) !== worktreePath) return null;
    if (
      (await registeredWorktreeState(primaryRoot, worktreePath)) !== "present"
    )
      return null;
    const [commonDirectory, gitDirectoryPath, head] = await Promise.all([
      gitDirectory(worktreePath, "--git-common-dir"),
      gitDirectory(worktreePath, "--git-dir"),
      execFileAsync("git", ["-C", worktreePath, "rev-parse", "HEAD"]),
    ]);
    if (
      commonDirectory !== commonGitDirectory ||
      head.stdout.trim() !== immutableHead
    ) {
      return null;
    }
    if (!requireDetached)
      return { worktree_path: worktreePath, git_directory: gitDirectoryPath };
    try {
      await execFileAsync("git", [
        "-C",
        worktreePath,
        "symbolic-ref",
        "-q",
        "HEAD",
      ]);
      return null;
    } catch (err) {
      if ((err as { code?: unknown }).code !== 1) return null;
    }
    return { worktree_path: worktreePath, git_directory: gitDirectoryPath };
  } catch {
    return null;
  }
}

async function publishSessionCreateLease(
  primaryRoot: string,
  leaseFile: string,
  bytes: string,
): Promise<
  "published" | "published-unverifiable" | "not-published" | "unverifiable"
> {
  validateDirectChild("lease", leaseFile, DIRECT_SUFFIXES.lease);
  await assertEphemeralDirectory(primaryRoot);
  const target = path.join(primaryRoot, leaseFile);
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.session-create.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temp, "wx");
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
  } catch {
    await handle?.close().catch(() => undefined);
    try {
      await rm(temp, { force: true });
      return "not-published";
    } catch {
      return "unverifiable";
    }
  }

  try {
    try {
      await link(temp, target);
    } catch {
      // A failed publication primitive can be unsupported or otherwise
      // unverifiable even when it did not report EEXIST.
      return "unverifiable";
    }

    try {
      await rm(temp);
      return "published";
    } catch {
      return "published-unverifiable";
    }
  } finally {
    await rm(temp, { force: true }).catch(() => undefined);
  }
}

async function verifySessionCreateFinalState({
  identity,
  commonGitDirectory,
  headSha,
  lease,
  leaseBytes,
  leaseSha256,
  registration,
}: {
  identity: DiscoveryIdentity;
  commonGitDirectory: string;
  headSha: string;
  lease: PrReviewLease;
  leaseBytes: string;
  leaseSha256: string;
  registration: RegistrationIdentity;
}): Promise<boolean> {
  try {
    const worktree = await verifyCreatedSessionWorktree(
      identity.primaryRoot,
      registration.worktree_path,
      commonGitDirectory,
      headSha,
    );
    if (
      worktree === null ||
      worktree.git_directory !== registration.git_directory ||
      !(await directSessionLeaseMatches(
        identity.primaryRoot,
        lease.lease_file,
        leaseBytes,
        leaseSha256,
      ))
    ) {
      return false;
    }
    validateLeaseShape(
      JSON.parse(
        await readFile(
          path.join(identity.primaryRoot, lease.lease_file),
          "utf8",
        ),
      ) as PrReviewLease,
    );
    const finalDiscovery = await discoverReviewSession();
    return (
      finalDiscovery.disposition === "resume" &&
      finalDiscovery.resume?.lease_file === lease.lease_file &&
      finalDiscovery.resume.worktree_path === registration.worktree_path
    );
  } catch {
    return false;
  }
}

async function sessionCreateRollbackResult({
  conflictReason,
  manualReason,
  identity,
  reservation,
  reservationFile,
  reservationBytes,
  registration,
  leaseBytes,
  leaseSha256,
  worktreeCreated,
}: {
  conflictReason: SessionCreateConflictReason;
  manualReason: SessionCreateManualReason;
  identity: DiscoveryIdentity;
  reservation: SessionCreateReservation;
  reservationFile: string;
  reservationBytes: string;
  registration: RegistrationIdentity | null;
  leaseBytes: string | null;
  leaseSha256: string | null;
  worktreeCreated: boolean;
}): Promise<RuntimeCommandOutcome> {
  const observed: ObservedArtifact[] = ["reservation"];
  if (leaseBytes !== null) {
    observed.push("lease");
    if (
      !(await reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      )) ||
      !(await removeOwnedSessionLease(
        identity.primaryRoot,
        reservation.lease_file,
        leaseBytes,
      ))
    ) {
      return sessionCreateManualCleanup(
        manualReason,
        reservation,
        registration,
        leaseSha256,
        observed,
      );
    }
  }
  if (worktreeCreated) {
    observed.push("worktree");
    if (registration !== null) observed.push("registration");
    if (
      registration === null ||
      !(await reservationMatches(
        path.join(identity.primaryRoot, reservationFile),
        reservation,
        reservationBytes,
      )) ||
      !(await removeOwnedSessionWorktree(
        identity.primaryRoot,
        registration,
        reservation.common_git_directory,
        reservation.immutable_head,
      ))
    ) {
      return sessionCreateManualCleanup(
        manualReason,
        reservation,
        registration,
        leaseSha256,
        observed,
      );
    }
  }
  if (
    !(await removeOwnedReservation(
      identity.primaryRoot,
      reservationFile,
      reservation,
      reservationBytes,
    ))
  ) {
    return sessionCreateManualCleanup(
      manualReason,
      reservation,
      registration,
      leaseSha256,
      observed,
    );
  }
  return sessionCreateConflict(conflictReason, []);
}

async function removeOwnedSessionLease(
  primaryRoot: string,
  leaseFile: string,
  expectedBytes: string,
): Promise<boolean> {
  const target = path.join(primaryRoot, leaseFile);
  try {
    if (
      !(await directSessionLeaseMatches(
        primaryRoot,
        leaseFile,
        expectedBytes,
        sha256Text(expectedBytes),
      ))
    )
      return false;
    await rm(target);
    return true;
  } catch {
    return false;
  }
}

async function directSessionLeaseMatches(
  primaryRoot: string,
  leaseFile: string,
  expectedBytes: string,
  expectedSha256: string,
): Promise<boolean> {
  const target = path.join(primaryRoot, leaseFile);
  try {
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink()) return false;
    const bytes = await readFile(target, "utf8");
    const after = await lstat(target);
    return (
      after.isFile() &&
      !after.isSymbolicLink() &&
      before.dev === after.dev &&
      before.ino === after.ino &&
      bytes === expectedBytes &&
      sha256Text(bytes) === expectedSha256
    );
  } catch {
    return false;
  }
}

async function hasSessionCreateRollbackChanges(
  worktreePath: string,
): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "--no-optional-locks",
      "-C",
      worktreePath,
      "status",
      "--porcelain",
      "--ignored",
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.length > 0;
}

async function hasUnexpectedSessionGitAdminOutput(
  gitDirectory: string,
): Promise<boolean> {
  const entries = await readdir(gitDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (
      ["HEAD", "ORIG_HEAD", "commondir", "gitdir", "index"].includes(entry.name)
    ) {
      if (!entry.isFile()) return true;
      continue;
    }
    if (/^sharedindex\.[0-9a-f]{40,64}$/u.test(entry.name)) {
      if (!entry.isFile()) return true;
      continue;
    }
    if (entry.name === "logs") {
      if (!entry.isDirectory()) return true;
      const logs = await readdir(path.join(gitDirectory, entry.name), {
        withFileTypes: true,
      });
      if (logs.some((log) => log.name !== "HEAD" || !log.isFile())) return true;
      continue;
    }
    if (entry.name === "refs") {
      if (
        !entry.isDirectory() ||
        (await readdir(path.join(gitDirectory, entry.name))).length > 0
      ) {
        return true;
      }
      continue;
    }
    return true;
  }
  return false;
}

async function removeOwnedSessionWorktree(
  primaryRoot: string,
  registration: RegistrationIdentity,
  commonGitDirectory: string,
  immutableHead: string,
): Promise<boolean> {
  const verified = await verifyCreatedSessionWorktree(
    primaryRoot,
    registration.worktree_path,
    commonGitDirectory,
    immutableHead,
  );
  if (
    verified === null ||
    verified.git_directory !== registration.git_directory
  ) {
    return false;
  }
  try {
    if (await hasUnexpectedSessionGitAdminOutput(verified.git_directory))
      return false;
    if (await hasSessionCreateRollbackChanges(registration.worktree_path))
      return false;
    if (
      (
        await findUnmanagedEphemeralArtifacts(
          { artifacts: emptyArtifacts() } as PrReviewLease,
          registration.worktree_path,
        )
      ).length > 0
    ) {
      return false;
    }
  } catch {
    return false;
  }
  try {
    await execFileAsync("git", [
      "-C",
      primaryRoot,
      "worktree",
      "remove",
      registration.worktree_path,
    ]);
    return (
      !(await pathExists(registration.worktree_path)) &&
      (await registeredWorktreeState(
        primaryRoot,
        registration.worktree_path,
      )) === "absent"
    );
  } catch {
    return false;
  }
}

function sessionCreateSuccess(
  identity: DiscoveryIdentity,
  commonGitDirectory: string,
  worktreePath: string,
  immutableHead: string,
  leaseFile: string,
  leaseSha256: string,
): RuntimeCommandOutcome {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({ schema: "pr-review/session-create/v1", outcome: "success", repository: identity.repository, pr_number: identity.prNumber, primary_repository_root: identity.primaryRoot, common_git_directory: commonGitDirectory, canonical_worktree_path: worktreePath, immutable_head: immutableHead, lease_file: leaseFile, lease_sha256: leaseSha256 })}\n`,
    stderr: "",
  };
}

function sessionCreateConflict(
  reason: SessionCreateConflictReason,
  observed: ObservedArtifact[],
): RuntimeCommandOutcome {
  const ordered = (
    ["reservation", "worktree", "registration", "lease"] as const
  ).filter((item) => observed.includes(item));
  return {
    exitCode: 1,
    stdout: `${JSON.stringify({ schema: "pr-review/session-create/v1", outcome: "conflict" as SessionCreateOutcome, reason, observed_artifacts: ordered })}\n`,
    stderr: "",
  };
}

function sessionCreateManualCleanup(
  reason: SessionCreateManualReason,
  reservation: SessionCreateReservation,
  registration: RegistrationIdentity | null,
  leaseSha256: string | null,
  observed: ObservedArtifact[],
): RuntimeCommandOutcome {
  const ordered = (
    ["reservation", "worktree", "registration", "lease"] as const
  ).filter((item) => observed.includes(item));
  return {
    exitCode: 1,
    stdout: `${JSON.stringify({ schema: "pr-review/session-create/v1", outcome: "manual-cleanup" as SessionCreateOutcome, invocation_token: reservation.invocation_token, canonical_worktree_path: reservation.canonical_worktree_path, immutable_head: reservation.immutable_head, registration_identity: registration, lease_sha256: leaseSha256, observed_artifacts: ordered, reason })}\n`,
    stderr: "",
  };
}

async function discoverReviewSession(): Promise<PrReviewSessionDiscovery> {
  const identity = await readDiscoveryIdentity();
  const canonicalWorktreePath = await canonicalPrReviewWorktreePath(identity);
  const canonicalWorktreePresent = await pathExists(canonicalWorktreePath);
  const entries = await readDiscoveryDirectory(identity.primaryRoot);
  const activeLeaseFiles = entries.filter((entry) =>
    new RegExp(`^pr-${identity.prNumber}-[0-9a-f]{64}-lease\\.json$`, "u").test(
      entry,
    ),
  );
  const archivedLeaseFiles = entries.filter((entry) =>
    new RegExp(
      `^pr-${identity.prNumber}-[0-9a-f]{64}-.*-archived-lease\\.json$`,
      "u",
    ).test(entry),
  );
  const registrations = await listRegisteredWorktrees(identity.primaryRoot);
  const canonicalWorktreeRegistered = registrations.some(
    (entry) =>
      normalizeComparablePath(entry) ===
      normalizeComparablePath(canonicalWorktreePath),
  );
  // Canonical preparation validation temporarily enters each worktree. Keep
  // candidate inspections sequential so their cwd and environment cannot mix.
  const active: DiscoveryCandidate[] = [];
  for (const leaseFile of activeLeaseFiles) {
    active.push(
      await inspectDiscoveryCandidate(identity, leaseFile, registrations),
    );
  }
  active.sort((left, right) =>
    compareDiscoveryEntries(left.lease_file, right.lease_file),
  );

  const invalid = active.some(
    (candidate) => candidate.classification === "invalid",
  );
  const resumable = active.filter(
    (candidate) => candidate.classification === "resumable",
  );
  const reentry = active.filter(
    (candidate) => candidate.classification === "reentry",
  );
  const blocked = active.some(
    (candidate) =>
      (candidate.classification !== "resumable" &&
        candidate.classification !== "reentry") ||
      candidate.worktree_dirty === true ||
      candidate.unmanaged_ephemeral_artifacts === true,
  );
  const selectedResumable = resumable.length === 1 ? resumable[0] : undefined;
  const selectedReentry =
    reentry.length === 1 && resumable.length === 0 ? reentry[0] : undefined;
  const canonicalConflictsWithResume =
    (canonicalWorktreePresent || canonicalWorktreeRegistered) &&
    (selectedReentry === undefined ||
      (!canonicalWorktreePresent && canonicalWorktreeRegistered)) &&
    (selectedResumable?.worktree_path === undefined ||
      selectedResumable.worktree_path === null ||
      normalizeComparablePath(selectedResumable.worktree_path) !==
        normalizeComparablePath(canonicalWorktreePath));
  const disposition: DiscoveryDisposition = invalid
    ? "invalid"
    : blocked
      ? "cleanup-required"
      : resumable.length > 1
        ? "ambiguous"
        : canonicalConflictsWithResume
          ? "cleanup-required"
          : resumable.length === 1
            ? "resume"
            : "create";
  const selected = disposition === "resume" ? selectedResumable : undefined;

  return {
    schema: "pr-review/session-discovery/v1",
    repository: identity.repository,
    pr_number: identity.prNumber,
    primary_repository_root: identity.primaryRoot,
    canonical_worktree_path: canonicalWorktreePath,
    canonical_worktree_present: canonicalWorktreePresent,
    active,
    archived_lease_files: archivedLeaseFiles
      .map((entry) => `.ephemeral/${entry}`)
      .sort(compareDiscoveryEntries),
    disposition,
    resume:
      selected?.worktree_path === null
        ? null
        : selected === undefined
          ? null
          : {
              lease_file: selected.lease_file,
              worktree_path: selected.worktree_path,
            },
  };
}

async function inspectDiscoveryCandidate(
  identity: DiscoveryIdentity,
  leaseFileName: string,
  registrations: readonly string[],
): Promise<DiscoveryCandidate> {
  const leaseFile = `.ephemeral/${leaseFileName}`;
  const leasePath = path.join(identity.primaryRoot, leaseFile);
  try {
    if (!(await lstat(leasePath)).isFile()) {
      return discoveryInvalidCandidate(leaseFile);
    }
    const lease = JSON.parse(
      await readFile(leasePath, "utf8"),
    ) as PrReviewLease;
    validateLeaseShape(lease);
    if (
      lease.repository !== identity.repository ||
      lease.pr_number !== identity.prNumber ||
      lease.lease_file !== leaseFile ||
      !path.isAbsolute(lease.worktree_path) ||
      leaseFile !==
        `.ephemeral/pr-${identity.prNumber}-${lease.worktree_digest}-lease.json` ||
      lease.worktree_digest !== digestPath(lease.worktree_path)
    ) {
      return discoveryInvalidCandidate(leaseFile);
    }
    if (
      normalizeComparablePath(path.resolve(lease.worktree_path)) !==
      normalizeComparablePath(lease.worktree_path)
    ) {
      return discoveryInvalidCandidate(leaseFile);
    }
    const resolvedWorktree = await resolveDiscoveryWorktreePath(
      lease.worktree_path,
    );
    if (
      normalizeComparablePath(resolvedWorktree.path) !==
      normalizeComparablePath(lease.worktree_path)
    ) {
      return discoveryInvalidCandidate(leaseFile);
    }
    if (!resolvedWorktree.exists) {
      if (await hasPostCleanupArchiveAuthority(lease, identity)) {
        const archive = await inspectTerminalArchive(
          lease,
          identity,
          leaseFile,
        );
        if (archive !== "divergent") {
          return {
            lease_file: leaseFile,
            worktree_path: lease.worktree_path,
            state: lease.state,
            classification: "reentry",
            worktree_dirty: null,
            unmanaged_ephemeral_artifacts: null,
          };
        }
      }
      return {
        lease_file: leaseFile,
        worktree_path: lease.worktree_path,
        state: lease.state,
        classification: "missing",
        worktree_dirty: null,
        unmanaged_ephemeral_artifacts: null,
      };
    }
    const worktreePath = resolvedWorktree.path;
    if (worktreePath === identity.primaryRoot) {
      return discoveryInvalidCandidate(leaseFile);
    }
    if (
      !registrations.some(
        (entry) =>
          normalizeComparablePath(entry) ===
          normalizeComparablePath(worktreePath),
      )
    ) {
      return {
        lease_file: leaseFile,
        worktree_path: worktreePath,
        state: lease.state,
        classification: "unregistered",
        worktree_dirty: null,
        unmanaged_ephemeral_artifacts: null,
      };
    }
    let inspectedLease = lease;
    if (
      eligiblePreparationRecovery(lease) &&
      optionalEnv("HANDOFF_FILE") !== undefined
    ) {
      requiredEnv("HEAD_SHA");
      const handoffFile = requiredEnv("HANDOFF_FILE");
      inspectedLease = {
        ...lease,
        artifacts: { ...lease.artifacts, handoff_file: handoffFile },
      };
      const handoff = await validatePreparationHandoff(
        inspectedLease,
        worktreePath,
      );
      const scope = await preparationScope(handoff, worktreePath);
      const records = [...(lease.preparation_failures ?? [])];
      for (const directory of readPreparationFailureDirectories())
        records.push(
          await validatePreparationFailureDirectory(
            directory,
            scope,
            worktreePath,
          ),
        );
      validatePreparationFailureRecords(records);
      inspectedLease = { ...inspectedLease, preparation_failures: records };
    }
    const worktreeDirty = await isWorktreeDirty(worktreePath);
    const unmanagedArtifacts = await findUnmanagedEphemeralArtifacts(
      inspectedLease,
      worktreePath,
    );
    const isReentry =
      (await hasPostCleanupArchiveAuthority(lease, identity)) &&
      (await inspectTerminalArchive(lease, identity, leaseFile)) === "equal";
    return {
      lease_file: leaseFile,
      worktree_path: worktreePath,
      state: lease.state,
      classification: isReentry
        ? "reentry"
        : ["created", "reviewed", "gated", "failed"].includes(lease.state)
          ? "resumable"
          : "terminal",
      worktree_dirty: worktreeDirty,
      unmanaged_ephemeral_artifacts: unmanagedArtifacts.length > 0,
    };
  } catch {
    return discoveryInvalidCandidate(leaseFile);
  }
}

function discoveryInvalidCandidate(leaseFile: string): DiscoveryCandidate {
  return {
    lease_file: leaseFile,
    worktree_path: null,
    state: null,
    classification: "invalid",
    worktree_dirty: null,
    unmanaged_ephemeral_artifacts: null,
  };
}

async function readDiscoveryDirectory(primaryRoot: string): Promise<string[]> {
  try {
    return (await readdir(path.join(primaryRoot, ".ephemeral")))
      .filter((entry) => !entry.includes(path.sep))
      .sort(compareDiscoveryEntries);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

function compareDiscoveryEntries(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
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
  options: ReductionOptions = {},
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
      return base;
    case "LC-18":
      if ((previous?.preparation_failures?.length ?? 0) > 0)
        throw new PrReviewLeaseError(
          "terminal recreation cannot erase preparation failure history",
        );
      return base;
    case "LC-19":
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
      requireInput("RESULT_SHA256", inputs.resultSha256);
      return {
        ...base,
        state: "reviewed",
        artifacts: {
          ...base.artifacts,
          handoff_file:
            inputs.handoffFile ?? previous?.artifacts.handoff_file ?? null,
          result_file: inputs.resultFile,
        },
        validation: validResultValidation(
          inputs.updatedAt,
          inputs.resultSha256,
        ),
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
      requireInput(
        "VALIDATED_REVIEW_PAYLOAD_FILE",
        inputs.validatedPayloadFile,
      );
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
      return applyFailure(row, base, previous, inputs, options);
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

interface ReductionOptions {
  allowMissingGatedPresentationTimestamp?: boolean;
  allowMissingGatedPresentationStatus?: boolean;
}

async function writeLease(
  options: PrReviewLeasesCommandOptions,
): Promise<string> {
  const identity = await readIdentity(true);
  const validationContext =
    options.validationContext ??
    (await createPrReviewResultValidationContext({
      worktreeRoot: identity.worktreePath,
    }));
  const previous = await readExistingLease(identity.leaseFile);
  assertExistingLeaseIdentity(previous, identity);
  const inputs = await readInputsForWrite(previous, identity.worktreePath);
  const archive = archivePathIfNeeded(previous, identity, inputs);
  const row = transitionId(previous, inputs);
  let reduced = reducePrReviewLease(previous, identity, inputs);
  if (row === "LC-19") {
    requiredEnv("HEAD_SHA");
    if (await isWorktreeDirty(identity.worktreePath))
      throw new PrReviewLeaseError(
        "preparation recovery requires clean worktree source",
      );
    if (
      previous === null ||
      inputs.baseRef !== previous.base_ref ||
      inputs.headRef !== previous.head_ref
    )
      throw new PrReviewLeaseError("preparation recovery ref mismatch");
    if (Date.parse(inputs.updatedAt) <= Date.parse(previous.updated_at))
      throw new PrReviewLeaseError(
        "preparation recovery UPDATED_AT must advance",
      );
    if (
      inputs.resultFile !== undefined ||
      inputs.approvedReviewFile !== undefined ||
      inputs.validatedPayloadFile !== undefined ||
      inputs.presentedAt !== undefined ||
      inputs.presentationStatus !== undefined ||
      inputs.githubPostAttempted === true ||
      inputs.githubPostedAt !== undefined
    )
      throw new PrReviewLeaseError(
        "preparation recovery cannot accept review result or post evidence",
      );
    await validatePreparationHandoff(reduced, identity.worktreePath);
  }
  const suppliedDirectories = readPreparationFailureDirectories();
  if (suppliedDirectories.length > 0) {
    if (
      row !== "LC-19" &&
      !(
        inputs.state === "failed" &&
        inputs.failurePhase === "handoff-validation" &&
        (previous?.state === "created" || eligiblePreparationRecovery(previous))
      )
    )
      throw new PrReviewLeaseError(
        "preparation failure custody requires pre-handoff preparation",
      );
    requiredEnv("HEAD_SHA");
    const handoffFile = inputs.handoffFile;
    if (handoffFile === undefined)
      throw new PrReviewLeaseError(
        "HANDOFF_FILE is required for preparation failure custody",
      );
    const custodyLease = {
      ...reduced,
      artifacts: { ...reduced.artifacts, handoff_file: handoffFile },
    };
    const handoff = await validatePreparationHandoff(
      custodyLease,
      identity.worktreePath,
    );
    const scope = await preparationScope(handoff, identity.worktreePath);
    const records = [...(previous?.preparation_failures ?? [])];
    for (const directory of suppliedDirectories)
      records.push(
        await validatePreparationFailureDirectory(
          directory,
          scope,
          identity.worktreePath,
        ),
      );
    validatePreparationFailureRecords(records);
    reduced = { ...reduced, preparation_failures: records };
    // A validated correction supplied for custody is not a failure's accepted handoff.
    if (inputs.state === "failed" && previous?.artifacts.handoff_file === null)
      reduced.artifacts.handoff_file = null;
  }
  if ((reduced.preparation_failures?.length ?? 0) > 0)
    await validatePreparationFailures(
      reduced,
      identity.worktreePath,
      inputs.handoffFile,
    );

  if (previous !== null && inputs.state === "failed") {
    reduced = await clearInvalidFailureRecoveryArtifacts(
      reduced,
      previous,
      identity.primaryRoot,
      identity.worktreePath,
      recoveryPolicyForPreviousState(previous.state),
      validationContext,
    );
  } else {
    validateLeaseShape(reduced);
    await validateReferencedArtifacts(reduced, identity.worktreePath, {
      validateResultAuthority: true,
      policy: policyForLifecycleWrite(row),
      validationContext,
    });
    if (
      archive !== null &&
      !(await hasPostCleanupArchiveAuthority(previous, identity))
    ) {
      if (previous === null) {
        throw new PrReviewLeaseError("archived lease missing");
      }
      validateLeaseShape(previous);
      await validateReferencedArtifacts(previous, identity.worktreePath, {
        validateResultAuthority: true,
        policy: "validate-stored-lease",
        validationContext,
      });
    }
  }
  validateLeaseShape(reduced);
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
    await writeTerminalArchive(
      target,
      path.join(identity.primaryRoot, archive),
    );
  }
  await writeTextAtomically(target, content);
  return identity.leaseFile;
}

async function writeTerminalArchive(
  target: string,
  archive: string,
  content?: Buffer,
): Promise<void> {
  const expected = content ?? (await readFile(target));
  try {
    await writeFile(archive, expected, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      throw err;
    }
    const existing = await readFile(archive);
    if (!existing.equals(expected)) {
      throw new PrReviewLeaseError("archived lease collision");
    }
  }
}

async function inspectTerminalArchive(
  lease: PrReviewLease,
  identity: DiscoveryIdentity,
  leaseFile: string,
): Promise<"absent" | "equal" | "divergent"> {
  const archivePath = path.join(
    identity.primaryRoot,
    terminalArchivePath(lease, identity.prNumber),
  );
  try {
    await lstat(archivePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "absent";
    }
    throw err;
  }
  const archive = await readFile(archivePath);
  const active = await readFile(path.join(identity.primaryRoot, leaseFile));
  return archive.equals(active) ? "equal" : "divergent";
}

async function recordAuditFailure(
  options: PrReviewLeasesCommandOptions,
): Promise<string> {
  const { identity, previous } = await readAuditFailureIdentity();
  const inputs = readInputs();
  if (!isPostGatedPreviewRenderFailure(previous, inputs)) {
    throw new PrReviewLeaseError(
      "record-audit-failure requires gated preview-render failure",
    );
  }
  if (inputs.expectedState !== "gated") {
    throw new PrReviewLeaseError("EXPECTED_STATE must be gated");
  }

  let reduced = reducePrReviewLease(previous, identity, inputs, {
    allowMissingGatedPresentationTimestamp: true,
    allowMissingGatedPresentationStatus: true,
  });
  reduced = await clearInvalidFailureRecoveryArtifacts(
    reduced,
    previous,
    identity.primaryRoot,
    identity.worktreePath,
    "preserve-gated-recovery",
    options.validationContext,
  );
  validateLeaseShape(reduced);

  await assertWritableDirectChild(
    identity.primaryRoot,
    identity.leaseFile,
    "lease",
  );
  await writeTextAtomically(
    path.join(identity.primaryRoot, identity.leaseFile),
    `${JSON.stringify(reduced, null, 2)}\n`,
  );
  return identity.leaseFile;
}

async function validateLeaseCommand(
  options: PrReviewLeasesCommandOptions,
): Promise<void> {
  const identity = await readIdentity(true);
  const validationContext =
    options.validationContext ??
    (await createPrReviewResultValidationContext({
      worktreeRoot: identity.worktreePath,
    }));
  const lease = await readRequiredJson<PrReviewLease>(
    identity.primaryRoot,
    identity.leaseFile,
    "lease file",
  );
  validateLeaseShape(lease);
  if (lease.repository !== identity.repository) {
    throw new PrReviewLeaseError("lease repository mismatch");
  }
  if (lease.pr_number !== identity.prNumber) {
    throw new PrReviewLeaseError("lease PR number mismatch");
  }
  if (lease.worktree_path !== identity.worktreePath) {
    throw new PrReviewLeaseError("lease worktree path mismatch");
  }
  if (lease.worktree_digest !== identity.worktreeDigest) {
    throw new PrReviewLeaseError("lease worktree digest mismatch");
  }
  if (lease.lease_file !== identity.leaseFile) {
    throw new PrReviewLeaseError("lease file identity mismatch");
  }
  await validateReferencedArtifacts(lease, identity.worktreePath, {
    validateResultAuthority: true,
    policy: "validate-stored-lease",
    validationContext,
  });
}

async function readStatus(
  options: PrReviewLeasesCommandOptions,
): Promise<string> {
  const identity = await readIdentity(true);
  await assertReadableWorktree(identity.worktreePath);
  const lease = await readRequiredJson<PrReviewLease>(
    identity.primaryRoot,
    identity.leaseFile,
    "lease file",
  );
  validateLeaseShape(lease);
  assertExistingLeaseIdentity(lease, identity);
  if (lease.state !== "gated") {
    throw new PrReviewLeaseError("read-status requires gated lease");
  }
  if (
    !(await isRegisteredWorktree(identity.primaryRoot, identity.worktreePath))
  ) {
    throw new PrReviewLeaseError(
      "worktree path is not registered for the primary repository",
    );
  }
  const worktreeDirty = await isWorktreeDirty(identity.worktreePath);
  const validationContext =
    options.validationContext ??
    (await createPrReviewResultValidationContext({
      worktreeRoot: identity.worktreePath,
    }));

  const resultFile = requiredEnv("RESULT_FILE");
  validateDirectChild("result", resultFile, DIRECT_SUFFIXES.result);
  if (resultFile !== lease.artifacts.result_file) {
    throw new PrReviewLeaseError("RESULT_FILE must match gated lease result");
  }
  const headSha = requiredEnv("HEAD_SHA");
  if (!SHA_RE.test(headSha)) {
    throw new PrReviewLeaseError(
      "HEAD_SHA must be a lowercase 40-character SHA",
    );
  }

  const resultSha256 = await sha256DirectChild(
    identity.worktreePath,
    resultFile,
    "result file",
  );
  const result = await readRequiredJson<JsonObject>(
    identity.worktreePath,
    resultFile,
    "result file",
  );
  validateResultIdentity(result, lease);
  if (stringField(result, "review_head_sha") !== headSha) {
    throw new PrReviewLeaseError("result review head mismatch");
  }
  const resultPresentationStatus = presentationStatusFromResult(result);
  if (lease.presentation.status !== resultPresentationStatus) {
    throw new PrReviewLeaseError("presentation status mismatch");
  }
  if (lease.presentation.presented_at === null) {
    throw new PrReviewLeaseError("presentation timestamp missing");
  }
  if (lease.validation.result_manifest.status !== "valid") {
    throw new PrReviewLeaseError("result manifest validation missing");
  }
  if (lease.validation.result_manifest.sha256 === null) {
    throw new PrReviewLeaseError("result manifest digest missing");
  }
  if (lease.validation.result_manifest.sha256 !== resultSha256) {
    throw new PrReviewLeaseError("result manifest digest mismatch");
  }
  if (lease.validation.result_manifest.validated_at !== lease.updated_at) {
    throw new PrReviewLeaseError("result manifest validation is stale");
  }
  await validateReferencedArtifacts(lease, identity.worktreePath, {
    validateResultAuthority: true,
    policy: "validate-live-gated-status",
    validationContext,
  });

  return JSON.stringify({
    lease_state: lease.state,
    worktree_path: identity.worktreePath,
    worktree_digest: identity.worktreeDigest,
    worktree_exists: true,
    worktree_registered: true,
    worktree_dirty: worktreeDirty,
    identity_match: true,
    result_file: resultFile,
    result_sha256: resultSha256,
    result_validated_at: lease.validation.result_manifest.validated_at,
    lease_updated_at: lease.updated_at,
    presentation_status: lease.presentation.status,
    presented_at: lease.presentation.presented_at,
  });
}

async function inspectWorktree(): Promise<string> {
  const identity = await readCleanupIdentity();
  const decision = await classifyCleanup(identity);
  if (shouldRecordCleanupMetadata(decision)) {
    await recordCleanupMetadata(
      identity,
      decision.leaseState,
      "",
      shouldValidateCleanupMetadataArtifacts(decision),
    );
  }
  return cleanupOutput("inspect", decision);
}

async function cleanupWorktree(): Promise<string> {
  const identity = await readCleanupIdentity();
  const decision = await classifyCleanup(identity);
  if (!decision.canRemove) {
    const outcome =
      decision.metadataOutcome === "skipped" ? "skipped" : "retained";
    if (shouldRecordCleanupMetadata(decision)) {
      await recordCleanupMetadata(
        identity,
        decision.leaseState,
        outcome,
        shouldValidateCleanupMetadataArtifacts(decision),
      );
      decision.metadataOutcome = outcome;
    }
    return cleanupOutput(outcome, decision);
  }

  const args = ["-C", identity.primaryRoot, "worktree", "remove"];
  if (decision.forceRemoveAllowed) {
    args.push("-f");
  }
  args.push(identity.worktreePath);
  try {
    await execFileAsync("git", args);
  } catch {
    if (shouldRecordCleanupMetadata(decision)) {
      await recordCleanupMetadata(
        identity,
        decision.leaseState,
        "failed",
        false,
      );
    }
    return cleanupOutput("failed", {
      ...decision,
      metadataOutcome: "failed",
      message: "git worktree remove failed",
    });
  }

  if (shouldRecordCleanupMetadata(decision)) {
    await recordCleanupMetadata(
      identity,
      decision.leaseState,
      "removed",
      false,
    );
    decision.metadataOutcome = "removed";
  }
  return cleanupOutput("removed", {
    ...decision,
    metadataOutcome: "removed",
    message: "worktree removed",
  });
}

function shouldRecordCleanupMetadata(
  decision: CleanupDecision,
): decision is CleanupDecision & { leaseState: LeaseState } {
  return (
    decision.identityMatch &&
    decision.leaseState !== "" &&
    decision.refusalReason !== "invalid-lease"
  );
}

function shouldValidateCleanupMetadataArtifacts(
  decision: CleanupDecision,
): boolean {
  return (
    decision.refusalReason !== "missing-worktree" &&
    decision.refusalReason !== "not-registered-worktree"
  );
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
    lease = await readRequiredJson<PrReviewLease>(
      identity.primaryRoot,
      identity.leaseFile,
      "lease file",
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
    await validateReferencedArtifacts(lease, identity.worktreePath, {
      validateResultAuthority: true,
      policy: "validate-stored-lease",
    });
    if ((lease.preparation_failures?.length ?? 0) > 0)
      return {
        ...base,
        refusalReason: "preparation-failure-history",
        message:
          "preserved preparation failure history requires retaining worktree",
      };
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

  try {
    base.dirty = await isWorktreeDirty(identity.worktreePath);
  } catch {
    return {
      ...base,
      refusalReason: "status-inspection-failed",
      message: "git status inspection failed; preserving worktree",
    };
  }
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
      ["--no-optional-locks", "-C", worktreePath, "status", "--porcelain"],
      { maxBuffer: 1024 * 1024 },
    );
    return stdout.length > 0;
  } catch {
    throw new PrReviewLeaseError("git status inspection failed for worktree");
  }
}

async function recordCleanupMetadata(
  identity: LeaseIdentity,
  state: LeaseState,
  outcome: "" | "removed" | "retained" | "skipped" | "failed",
  validateArtifacts: boolean,
): Promise<void> {
  const lease = await readRequiredJson<PrReviewLease>(
    identity.primaryRoot,
    identity.leaseFile,
    "lease file",
  );
  assertExistingLeaseIdentity(lease, identity);
  if (state !== lease.state) {
    throw new PrReviewLeaseError(
      "lease state changed during cleanup metadata write",
    );
  }
  const observedAt = nowTimestamp();
  const next: PrReviewLease = {
    ...lease,
    cleanup: {
      last_outcome:
        outcome === "" ? (lease.cleanup?.last_outcome ?? null) : outcome,
      last_checked_at: observedAt,
      removed_at:
        outcome === "removed"
          ? observedAt
          : (lease.cleanup?.removed_at ?? null),
    },
  };
  validateLeaseShape(next);
  if (validateArtifacts) {
    await validateReferencedArtifacts(next, identity.worktreePath, {
      validateResultAuthority: true,
      policy: "validate-cleanup-metadata",
    });
  }
  await writeTextAtomically(
    path.join(identity.primaryRoot, identity.leaseFile),
    `${JSON.stringify(next, null, 2)}\n`,
  );
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

async function readDiscoveryIdentity(): Promise<DiscoveryIdentity> {
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
  return { repository, prNumber, primaryRoot };
}

async function readAuditFailureIdentity(): Promise<{
  identity: LeaseIdentity;
  previous: PrReviewLease;
}> {
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
  const leaseFile = requiredEnv("LEASE_FILE");
  validateDirectChild("lease", leaseFile, DIRECT_SUFFIXES.lease);
  const previous = await readRequiredJson<PrReviewLease>(
    primaryRoot,
    leaseFile,
    "lease file",
  );
  validateLeaseShape(previous, {
    allowMissingGatedPresentationTimestamp: true,
    allowMissingGatedRecoveryDigest: true,
  });
  if (previous.repository !== repository) {
    throw new PrReviewLeaseError("lease repository mismatch");
  }
  if (previous.pr_number !== prNumber) {
    throw new PrReviewLeaseError("lease PR number mismatch");
  }
  if (previous.lease_file !== leaseFile) {
    throw new PrReviewLeaseError("lease file identity mismatch");
  }
  if (previous.worktree_digest !== digestPath(previous.worktree_path)) {
    throw new PrReviewLeaseError("lease worktree digest mismatch");
  }
  const expected = `.ephemeral/pr-${prNumber}-${previous.worktree_digest}-lease.json`;
  if (leaseFile !== expected) {
    throw new PrReviewLeaseError(`lease path mismatch: ${leaseFile}`);
  }
  return {
    identity: {
      repository,
      prNumber,
      primaryRoot,
      worktreePath: previous.worktree_path,
      worktreeDigest: previous.worktree_digest,
      leaseFile,
    },
    previous,
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
  const resolvedWorktree = await resolveCleanupWorktreePath(
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

async function resolveCleanupWorktreePath(
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

async function resolveDiscoveryWorktreePath(
  worktreePath: string,
): Promise<{ path: string; exists: boolean }> {
  try {
    return { path: await realpath(worktreePath), exists: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
    const lexicalPath = path.resolve(worktreePath);
    const missingSegments: string[] = [];
    let existingAncestor = lexicalPath;
    while (true) {
      try {
        const ancestorStat = await lstat(existingAncestor);
        if (!ancestorStat.isDirectory()) {
          throw new PrReviewLeaseError(
            "missing worktree path has no physical directory ancestor",
          );
        }
        return {
          path: path.join(await realpath(existingAncestor), ...missingSegments),
          exists: false,
        };
      } catch (ancestorError) {
        const ancestorCode = (ancestorError as NodeJS.ErrnoException).code;
        if (ancestorCode !== "ENOENT") {
          throw ancestorError;
        }
        missingSegments.unshift(path.basename(existingAncestor));
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) {
          throw err;
        }
        existingAncestor = parent;
      }
    }
  }
}

async function isRegisteredWorktree(
  primaryRoot: string,
  worktreePath: string,
): Promise<boolean> {
  return (
    (await registeredWorktreeState(primaryRoot, worktreePath)) === "present"
  );
}

async function registeredWorktreeState(
  primaryRoot: string,
  worktreePath: string,
): Promise<"present" | "absent" | "unverifiable"> {
  try {
    const registrations = await listRegisteredWorktrees(primaryRoot);
    const expected = normalizeComparablePath(worktreePath);
    return registrations.some(
      (entry) => normalizeComparablePath(entry) === expected,
    )
      ? "present"
      : "absent";
  } catch {
    return "unverifiable";
  }
}

async function listRegisteredWorktrees(primaryRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", primaryRoot, "worktree", "list", "--porcelain", "-z"],
      { maxBuffer: 1024 * 1024 },
    );
    return stdout
      .split("\0")
      .filter((entry) => entry.startsWith("worktree "))
      .map((entry) => entry.slice(9));
  } catch {
    throw new PrReviewLeaseError("git worktree registration inspection failed");
  }
}

function readInputs(): LeaseInputs {
  const state = parseState(requiredEnv("STATE"));
  const updatedAt = process.env.UPDATED_AT ?? nowTimestamp();
  const terminal =
    state === "posted" || state === "aborted" || state === "failed";
  return {
    state,
    baseRef: requiredEnv("BASE_REF"),
    headRef: requiredEnv("HEAD_REF"),
    createdAt: process.env.CREATED_AT ?? updatedAt,
    updatedAt,
    handoffFile: optionalEnv("HANDOFF_FILE"),
    resultFile: optionalEnv("RESULT_FILE"),
    approvedReviewFile: optionalEnv("APPROVED_REVIEW_FILE"),
    validatedPayloadFile:
      optionalEnv("VALIDATED_REVIEW_PAYLOAD_FILE") ??
      optionalEnv("VALIDATED_PAYLOAD_FILE"),
    presentedAt:
      state === "gated" ? (process.env.PRESENTED_AT ?? updatedAt) : undefined,
    presentationStatus:
      state === "gated"
        ? parseOptionalPresentation(optionalEnv("PRESENTATION_STATUS"))
        : undefined,
    finishedAt: terminal ? (process.env.FINISHED_AT ?? updatedAt) : undefined,
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

async function readInputsForWrite(
  previous: PrReviewLease | null,
  worktreePath: string,
): Promise<LeaseInputs> {
  const inputs = readInputs();
  const resultFile = resultFileForLifecycleValidation(previous, inputs);
  if (resultFile !== null) {
    validateDirectChild("result", resultFile, DIRECT_SUFFIXES.result);
    inputs.resultSha256 = await sha256DirectChild(
      worktreePath,
      resultFile,
      "result file",
    );
  }
  return inputs;
}

function resultFileForLifecycleValidation(
  previous: PrReviewLease | null,
  inputs: LeaseInputs,
): string | null {
  if (inputs.state === "reviewed" || inputs.state === "gated") {
    return inputs.resultFile ?? previous?.artifacts.result_file ?? null;
  }
  return null;
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
    ...(previous?.preparation_failures === undefined
      ? {}
      : { preparation_failures: previous.preparation_failures }),
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
  requireInput("RESULT_SHA256", inputs.resultSha256);
  return {
    ...base,
    state: "gated",
    artifacts: {
      ...base.artifacts,
      handoff_file: previous?.artifacts.handoff_file ?? null,
      result_file: resultFile,
    },
    validation: validResultValidation(inputs.updatedAt, inputs.resultSha256),
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
  options: ReductionOptions = {},
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
  if (inputs.failurePhase === "preview-render" && previous?.state === "gated") {
    validatePostGatedPreviewRenderFailure(previous, {
      allowMissingPresentationTimestamp:
        options.allowMissingGatedPresentationTimestamp === true,
      allowMissingPresentationStatus:
        options.allowMissingGatedPresentationStatus === true,
    });
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
      row === "LC-11" || row === "LC-12" || row === "LC-13" || row === "LC-16"
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
    const current = previous?.artifacts.result_file ?? null;
    if (inputs.resultFile !== undefined && inputs.resultFile !== current) {
      throw new PrReviewLeaseError(
        "RESULT_FILE must match existing failed result",
      );
    }
    return current;
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

function isPostGatedPreviewRenderFailure(
  previous: PrReviewLease | null,
  inputs: LeaseInputs,
): boolean {
  return (
    previous?.state === "gated" &&
    inputs.state === "failed" &&
    inputs.failurePhase === "preview-render"
  );
}

function validatePostGatedPreviewRenderFailure(
  previous: PrReviewLease,
  options: {
    allowMissingPresentationTimestamp?: boolean;
    allowMissingPresentationStatus?: boolean;
  } = {},
): void {
  if (previous.state !== "gated") {
    throw new PrReviewLeaseError("preview-render failure requires gated lease");
  }
  if (previous.artifacts.result_file === null) {
    throw new PrReviewLeaseError(
      "preview-render failure requires prior result pointer",
    );
  }
  if (
    (previous.presentation.status === null &&
      options.allowMissingPresentationStatus !== true) ||
    (previous.presentation.presented_at === null &&
      options.allowMissingPresentationTimestamp !== true)
  ) {
    throw new PrReviewLeaseError(
      "preview-render failure requires prior presentation evidence",
    );
  }
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
  | "LC-18"
  | "LC-19";

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
  if (
    previousState === "failed" &&
    inputs.state === "created" &&
    eligiblePreparationRecovery(previous)
  )
    return "LC-19";
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
    previous !== null &&
    eligiblePreparationRecovery(previous) &&
    (inputs.state === "created" ||
      (inputs.state === "failed" &&
        inputs.failurePhase === "handoff-validation"))
  ) {
    return terminalArchivePath(previous, identity.prNumber);
  }
  if (
    inputs.state !== "created" ||
    (previous?.state !== "posted" && previous?.state !== "aborted")
  ) {
    return null;
  }
  return terminalArchivePath(previous, identity.prNumber);
}

function terminalArchivePath(lease: PrReviewLease, prNumber: number): string {
  const stamp = (lease.terminal.finished_at ?? lease.updated_at).replace(
    /[-:Z]/gu,
    "",
  );
  return `.ephemeral/pr-${prNumber}-${lease.worktree_digest}-${stamp}-${lease.state}-archived-lease.json`;
}

function policyForLifecycleWrite(row: TransitionId | null): EvidencePolicy {
  switch (row) {
    case "LC-03":
      return "accept-reviewed-result";
    case "LC-04":
    case "LC-05":
    case "LC-14":
      return "accept-gated-result";
    case "LC-08":
      return "accept-post-success";
    case "LC-17":
      return "validate-post-retry";
    default:
      return "validate-stored-lease";
  }
}

function recoveryPolicyForPreviousState(state: LeaseState): EvidencePolicy {
  switch (state) {
    case "created":
      return "preserve-created-recovery";
    case "reviewed":
      return "preserve-reviewed-recovery";
    case "gated":
      return "preserve-gated-recovery";
    case "failed":
      return "preserve-failed-recovery";
    default:
      return "validate-stored-lease";
  }
}

function preservesGatePresentation(
  policy: EvidencePolicy,
  lease: PrReviewLease,
): boolean {
  return (
    policy === "preserve-gated-recovery" ||
    (policy === "preserve-failed-recovery" &&
      lease.presentation.presented_at !== null &&
      lease.presentation.status !== null)
  );
}

interface LeaseShapeOptions {
  allowMissingGatedPresentationTimestamp?: boolean;
  allowMissingGatedRecoveryDigest?: boolean;
}

function validateLeaseShape(
  lease: PrReviewLease,
  options: LeaseShapeOptions = {},
): void {
  assertLeaseObjectShape(lease);
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
  validateCleanupMetadata(lease.cleanup);
  validatePreparationFailureRecords(lease.preparation_failures);
  if (
    lease.validation.result_manifest.sha256 !== null &&
    !SHA256_RE.test(lease.validation.result_manifest.sha256)
  ) {
    throw new PrReviewLeaseError(
      "validation.result_manifest.sha256 must be a lowercase 64-character sha256 or null",
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
  validateStateInvariants(lease, options);
  validateTerminalCleanupChronology(lease);
}

function validateStateInvariants(
  lease: PrReviewLease,
  options: LeaseShapeOptions = {},
): void {
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
      lease.validation.result_manifest.validated_at !== null ||
      lease.validation.result_manifest.sha256 !== null
    ) {
      throw new PrReviewLeaseError("lease schema mismatch");
    }
  } else if (
    lease.validation.result_manifest.status !== "valid" ||
    lease.validation.result_manifest.validated_at === null
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  } else if (
    lease.validation.result_manifest.sha256 === null &&
    !(options.allowMissingGatedRecoveryDigest && lease.state === "gated")
  ) {
    throw new PrReviewLeaseError("result manifest digest missing");
  }
  if (
    lease.state === "gated" &&
    lease.presentation.presented_at === null &&
    !options.allowMissingGatedPresentationTimestamp
  ) {
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
    (lease.artifacts.approved_review_file === null ||
      lease.artifacts.validated_payload_file === null)
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (lease.state === "failed" && lease.failure.phase === null) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
}

function validateTerminalCleanupChronology(lease: PrReviewLease): void {
  if (lease.state !== "posted" && lease.state !== "aborted") return;

  const finishedAt = lease.terminal.finished_at;
  if (finishedAt === null || lease.cleanup === undefined) return;

  const { last_checked_at: lastCheckedAt } = lease.cleanup;
  if (
    lastCheckedAt !== null &&
    compareTimestamps(lastCheckedAt, finishedAt) < 0
  ) {
    throw new PrReviewLeaseError(
      "cleanup.last_checked_at cannot precede terminal.finished_at",
    );
  }

  if (!("removed_at" in lease.cleanup) || lease.cleanup.removed_at === null) {
    return;
  }

  const removedAt = lease.cleanup.removed_at;
  if (lastCheckedAt === null) {
    throw new PrReviewLeaseError(
      "cleanup.removed_at requires cleanup.last_checked_at",
    );
  }
  if (compareTimestamps(removedAt, finishedAt) < 0) {
    throw new PrReviewLeaseError(
      "cleanup.removed_at cannot precede terminal.finished_at",
    );
  }
  if (compareTimestamps(removedAt, lastCheckedAt) > 0) {
    throw new PrReviewLeaseError(
      "cleanup.removed_at cannot follow cleanup.last_checked_at",
    );
  }
}

function clearPreviewRenderRecoveryArtifacts(
  lease: PrReviewLease,
): PrReviewLease {
  return {
    ...lease,
    artifacts: {
      handoff_file: null,
      result_file: null,
      approved_review_file: null,
      validated_payload_file: null,
    },
    validation: emptyValidation(),
    presentation: emptyPresentation(),
  };
}

async function clearInvalidFailureRecoveryArtifacts(
  reduced: PrReviewLease,
  previous: PrReviewLease,
  primaryRoot: string,
  worktreePath: string,
  policy: EvidencePolicy,
  validationContext?: PrReviewResultValidationContext,
): Promise<PrReviewLease> {
  if (
    !(await isPlainDirectory(worktreePath)) ||
    !(await isRegisteredWorktree(primaryRoot, worktreePath))
  ) {
    const cleared = clearPreviewRenderRecoveryArtifacts(reduced);
    validateLeaseShape(cleared);
    return cleared;
  }
  const rootedValidationContext =
    validationContext ??
    (await createPrReviewResultValidationContext({
      worktreeRoot: worktreePath,
    }));
  return classifyRecoveryEvidence(
    reduced,
    previous,
    worktreePath,
    policy,
    rootedValidationContext,
  );
}

async function classifyRecoveryEvidence(
  reduced: PrReviewLease,
  previous: PrReviewLease,
  worktreePath: string,
  policy: EvidencePolicy,
  validationContext: PrReviewResultValidationContext,
): Promise<PrReviewLease> {
  const freshnessTimestamp =
    policy === "preserve-gated-recovery" ? previous.updated_at : undefined;
  let sanitized = clearPreviewRenderRecoveryArtifacts(reduced);

  if (reduced.artifacts.handoff_file !== null) {
    const handoffCandidate: PrReviewLease = {
      ...sanitized,
      artifacts: {
        ...sanitized.artifacts,
        handoff_file: reduced.artifacts.handoff_file,
      },
    };
    try {
      validateLeaseShape(handoffCandidate);
      await validateReferencedArtifacts(handoffCandidate, worktreePath, {
        policy,
        validationContext,
      });
      sanitized = handoffCandidate;
    } catch {
      sanitized = clearPreviewRenderRecoveryArtifacts(reduced);
    }
  }

  if (reduced.artifacts.result_file === null) {
    validateLeaseShape(sanitized);
    return sanitized;
  }

  const resultPresentation = preservesGatePresentation(policy, reduced)
    ? reduced.presentation
    : emptyPresentation();
  const resultCandidate: PrReviewLease = {
    ...sanitized,
    artifacts: {
      ...sanitized.artifacts,
      result_file: reduced.artifacts.result_file,
    },
    validation: reduced.validation,
    presentation: resultPresentation,
  };
  try {
    validateLeaseShape(resultCandidate);
    await validateReferencedArtifacts(resultCandidate, worktreePath, {
      validateResultAuthority: true,
      policy,
      freshnessTimestamp,
      validationContext,
    });
    sanitized = resultCandidate;
  } catch {
    validateLeaseShape(sanitized);
    return sanitized;
  }

  if (reduced.artifacts.approved_review_file === null) {
    validateLeaseShape(sanitized);
    return sanitized;
  }

  const approvalCandidate: PrReviewLease = {
    ...sanitized,
    artifacts: {
      ...sanitized.artifacts,
      approved_review_file: reduced.artifacts.approved_review_file,
      validated_payload_file: null,
    },
  };
  try {
    validateLeaseShape(approvalCandidate);
    await validateReferencedArtifacts(approvalCandidate, worktreePath, {
      validateResultAuthority: true,
      policy,
      freshnessTimestamp,
      validationContext,
    });
    sanitized = approvalCandidate;
  } catch {
    validateLeaseShape(sanitized);
    return sanitized;
  }

  if (reduced.artifacts.validated_payload_file === null) {
    validateLeaseShape(sanitized);
    return sanitized;
  }

  const payloadCandidate: PrReviewLease = {
    ...sanitized,
    artifacts: {
      ...sanitized.artifacts,
      validated_payload_file: reduced.artifacts.validated_payload_file,
    },
  };
  try {
    validateLeaseShape(payloadCandidate);
    await validateReferencedArtifacts(payloadCandidate, worktreePath, {
      validateResultAuthority: true,
      policy,
      freshnessTimestamp,
      validationContext,
    });
    sanitized = payloadCandidate;
  } catch {
    validateLeaseShape(sanitized);
    return sanitized;
  }

  validateLeaseShape(sanitized);
  return sanitized;
}

function reviewHeadShaFromResultFile(resultFile: string): string {
  const match = /^\.ephemeral\/pr-[0-9]+-([0-9a-f]{40})-result\.json$/u.exec(
    resultFile,
  );
  if (match === null) {
    throw new PrReviewLeaseError("result path mismatch");
  }
  return match[1];
}

function inheritedHelperEnv(): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "ComSpec",
    "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
    "DEVCANON_RUNTIME_DIR",
  ]) {
    const value = process.env[key];
    if (value !== undefined) {
      inherited[key] = value;
    }
  }
  return inherited;
}

async function isPlainDirectory(value: string): Promise<boolean> {
  try {
    const stat = await lstat(value);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function validateReferencedArtifacts(
  lease: PrReviewLease,
  worktreePath: string,
  options: {
    validateResultAuthority?: boolean;
    policy?: EvidencePolicy;
    freshnessTimestamp?: string;
    validationContext?: PrReviewResultValidationContext;
  } = {},
): Promise<void> {
  const validationContext =
    options.validationContext ??
    (await createPrReviewResultValidationContext({
      worktreeRoot: worktreePath,
    }));
  const policy = options.policy ?? "validate-stored-lease";
  if ((lease.preparation_failures?.length ?? 0) > 0)
    await validatePreparationFailures(lease, worktreePath);
  let resultReviewHead: string | null = null;
  let resultArtifact: JsonObject | null = null;
  if (lease.artifacts.handoff_file !== null) {
    const handoff = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.handoff_file,
      "handoff file",
    );
    validateHandoffIdentity(handoff, lease, worktreePath);
  }
  if (lease.artifacts.result_file !== null) {
    await validateResultDigest(
      lease,
      worktreePath,
      lease.artifacts.result_file,
    );
    const result = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.result_file,
      "result file",
    );
    validateResultIdentity(result, lease);
    validateResultFreshness(lease, policy, options.freshnessTimestamp);
    validateResultPresentation(result, lease, policy);
    resultReviewHead = stringField(result, "review_head_sha");
    resultArtifact = result;
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
    if (resultArtifact === null) {
      throw new PrReviewLeaseError("approved review result binding missing");
    }
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
    await validateResultCommandAuthority(
      lease,
      worktreePath,
      validationContext,
    );
    const scopeBaseRef = await scopeBaseRefFromValidatedResult(
      resultArtifact,
      worktreePath,
    );
    await validateApprovedReviewOwnership(
      lease,
      worktreePath,
      approvedReviewHead,
      scopeBaseRef,
    );
  }
  if (options.validateResultAuthority === true) {
    await validateResultCommandAuthority(
      lease,
      worktreePath,
      validationContext,
    );
  }
}

function validateResultFreshness(
  lease: PrReviewLease,
  policy: EvidencePolicy,
  freshnessTimestamp?: string,
): void {
  if (lease.validation.result_manifest.status !== "valid") {
    throw new PrReviewLeaseError("result manifest validation missing");
  }
  if (lease.validation.result_manifest.validated_at === null) {
    throw new PrReviewLeaseError("result manifest validation missing");
  }
  if (lease.validation.result_manifest.sha256 === null) {
    throw new PrReviewLeaseError("result manifest digest missing");
  }
  if (hasStaleResultValidation(lease, policy, freshnessTimestamp)) {
    throw new PrReviewLeaseError("result manifest validation is stale");
  }
}

function hasStaleResultValidation(
  lease: PrReviewLease,
  policy: EvidencePolicy,
  freshnessTimestamp?: string,
): boolean {
  const expectedTimestamp = freshnessTimestamp ?? lease.updated_at;
  if (
    policy === "accept-gated-result" ||
    policy === "validate-live-gated-status" ||
    policy === "preserve-gated-recovery"
  ) {
    return lease.validation.result_manifest.validated_at !== expectedTimestamp;
  }
  return (
    policy === "validate-stored-lease" &&
    lease.state === "gated" &&
    lease.validation.result_manifest.validated_at !== expectedTimestamp
  );
}

function validateResultPresentation(
  result: JsonObject,
  lease: PrReviewLease,
  policy: EvidencePolicy,
): void {
  const status = presentationStatusFromResult(result, {
    allowNotPresented: allowsNotPresentedResult(policy, lease),
  });
  if (
    !requiresLeasePresentation(policy, lease) &&
    lease.presentation.status === null &&
    lease.presentation.presented_at === null
  ) {
    return;
  }
  if (status === "not-presented") {
    throw new PrReviewLeaseError("result presentation mismatch");
  }
  if (lease.presentation.status === null) {
    throw new PrReviewLeaseError("presentation status missing");
  }
  if (lease.presentation.presented_at === null) {
    throw new PrReviewLeaseError("presentation timestamp missing");
  }
  if (lease.presentation.status !== status) {
    throw new PrReviewLeaseError("presentation status mismatch");
  }
}

function allowsNotPresentedResult(
  policy: EvidencePolicy,
  lease: PrReviewLease,
): boolean {
  return (
    policy === "accept-reviewed-result" ||
    policy === "preserve-reviewed-recovery" ||
    (policy === "validate-stored-lease" &&
      hasStoredReviewedResultWithoutPresentation(lease)) ||
    (policy === "validate-cleanup-metadata" &&
      hasStoredReviewedResultWithoutPresentation(lease)) ||
    (policy === "preserve-failed-recovery" &&
      lease.presentation.status === null)
  );
}

function hasStoredReviewedResultWithoutPresentation(
  lease: PrReviewLease,
): boolean {
  return (
    lease.artifacts.result_file !== null &&
    lease.presentation.presented_at === null &&
    lease.presentation.status === null &&
    (lease.state === "reviewed" ||
      lease.state === "aborted" ||
      lease.state === "failed")
  );
}

function requiresLeasePresentation(
  policy: EvidencePolicy,
  lease: PrReviewLease,
): boolean {
  return (
    policy === "accept-gated-result" ||
    policy === "accept-post-success" ||
    policy === "validate-live-gated-status" ||
    policy === "preserve-gated-recovery" ||
    policy === "validate-post-retry" ||
    (policy === "validate-stored-lease" &&
      (lease.state === "gated" || lease.state === "posted")) ||
    (policy === "preserve-failed-recovery" &&
      lease.presentation.status !== null)
  );
}

async function validateResultDigest(
  lease: PrReviewLease,
  worktreePath: string,
  resultFile: string,
): Promise<void> {
  if (lease.validation.result_manifest.sha256 === null) {
    throw new PrReviewLeaseError("result manifest digest missing");
  }
  const resultSha256 = await sha256DirectChild(
    worktreePath,
    resultFile,
    "result file",
  );
  if (lease.validation.result_manifest.sha256 !== resultSha256) {
    throw new PrReviewLeaseError("result manifest digest mismatch");
  }
}

async function validateResultCommandAuthority(
  lease: PrReviewLease,
  worktreePath: string,
  validationContext: PrReviewResultValidationContext,
): Promise<void> {
  if (
    lease.artifacts.result_file === null ||
    lease.validation.result_manifest.status !== "valid"
  ) {
    return;
  }
  await validatePrReviewResultCommandAuthority({
    worktreeRoot: worktreePath,
    resultFile: lease.artifacts.result_file,
    resultIdentityPath: lease.artifacts.result_file,
    repository: lease.repository,
    prNumber: lease.pr_number,
    reviewHeadSha: reviewHeadShaFromResultFile(lease.artifacts.result_file),
    leaseBaseRef: lease.base_ref,
    leaseHeadRef: lease.head_ref,
    prReviewDir: optionalEnv("PR_REVIEW_DIR"),
    prReviewManifestHelperScript: optionalEnv(
      "PR_REVIEW_MANIFEST_HELPER_SCRIPT",
    ),
    prReviewLeaseHelperScript: optionalEnv("PR_REVIEW_LEASE_HELPER_SCRIPT"),
    playReviewHelper: optionalEnv("PLAY_REVIEW_HELPER"),
    helperEnv: inheritedHelperEnv(),
    validationContext,
  });
}

interface ApprovedReviewOwnership {
  reviewBodyFile: string;
  reviewPayloadFile: string;
}

async function validateApprovedReviewOwnership(
  lease: PrReviewLease,
  worktreePath: string,
  reviewHeadSha: string,
  scopeBaseRef: string,
): Promise<ApprovedReviewOwnership> {
  const approvedReviewFile = lease.artifacts.approved_review_file;
  if (approvedReviewFile === null) {
    throw new PrReviewLeaseError("approved review file missing");
  }
  const helper = await resolveApprovedReviewHelper();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "bash",
      [helper, "inspect-approved-review-ownership"],
      {
        cwd: worktreePath,
        env: {
          ...inheritedHelperEnv(),
          PR_NUMBER: String(lease.pr_number),
          HEAD_SHA: reviewHeadSha,
          BASE_REF: scopeBaseRef,
          APPROVED_REVIEW_FILE: approvedReviewFile,
        },
        maxBuffer: 1024 * 1024,
      },
    ));
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr).trim()
        : "";
    throw new PrReviewLeaseError(
      stderr.length > 0 ? stderr : "approved review validation helper failed",
    );
  }
  let ownership: unknown;
  try {
    ownership = JSON.parse(stdout);
  } catch {
    throw new PrReviewLeaseError("approved review ownership output malformed");
  }
  if (
    !isObject(ownership) ||
    Object.keys(ownership).length !== 2 ||
    typeof ownership.review_body_file !== "string" ||
    typeof ownership.review_payload_file !== "string"
  ) {
    throw new PrReviewLeaseError("approved review ownership output malformed");
  }
  const expectedBody = `.ephemeral/pr-${lease.pr_number}-${reviewHeadSha}-review-body.md`;
  if (ownership.review_body_file !== expectedBody) {
    throw new PrReviewLeaseError(
      `review body path mismatch: ${ownership.review_body_file}`,
    );
  }
  validateDirectChild(
    "review payload",
    ownership.review_payload_file,
    "-review-payload.json",
  );
  return {
    reviewBodyFile: ownership.review_body_file,
    reviewPayloadFile: ownership.review_payload_file,
  };
}

async function scopeBaseRefFromValidatedResult(
  result: JsonObject,
  worktreePath: string,
): Promise<string> {
  const artifacts = result.artifacts;
  if (!isObject(artifacts)) {
    throw new PrReviewLeaseError("result artifacts metadata missing");
  }
  const scopeDecision = await readRequiredJson<JsonObject>(
    worktreePath,
    stringField(artifacts, "scope_decision_file"),
    "scope decision file",
  );
  const scopeArtifacts = scopeDecision.artifacts;
  if (!isObject(scopeArtifacts)) {
    throw new PrReviewLeaseError("scope decision artifacts missing");
  }
  const providerEvidence = await readRequiredJson<JsonObject>(
    worktreePath,
    stringField(scopeArtifacts, "provider_scope_evidence_file"),
    "provider scope evidence file",
  );
  return stringField(providerEvidence, "provider_pr_diff_base_sha");
}

async function resolveApprovedReviewHelper(): Promise<string> {
  const candidates: string[] = [];
  const configuredDir = optionalEnv("PR_REVIEW_DIR");
  if (configuredDir !== undefined) candidates.push(configuredDir);
  for (const script of [
    optionalEnv("PR_REVIEW_MANIFEST_HELPER_SCRIPT"),
    optionalEnv("PR_REVIEW_LEASE_HELPER_SCRIPT"),
  ]) {
    if (script === undefined) continue;
    candidates.push(path.dirname(path.dirname(script)));
    try {
      candidates.push(path.dirname(path.dirname(await realpath(script))));
    } catch {
      // The executable check below reports the missing helper.
    }
  }
  for (const candidate of candidates) {
    const helper = path.join(candidate, "scripts/approved-review-artifacts.sh");
    try {
      const stat = await lstat(helper);
      if (
        stat.isFile() &&
        (process.platform === "win32" || (stat.mode & 0o111) !== 0)
      ) {
        return helper;
      }
    } catch {
      // Try the next configured location.
    }
  }
  throw new PrReviewLeaseError(
    "approved review artifact helper missing or not executable",
  );
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
  if ((lease.preparation_failures?.length ?? 0) > 0) {
    await validatePreparationFailures(lease, worktreePath);
    for (const record of lease.preparation_failures ?? [])
      owned.add(record.directory);
  }
  addOwnedPath(owned, lease.artifacts.handoff_file);
  addOwnedPath(owned, lease.artifacts.result_file);

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
    const sharedContext = await validateSharedContextFamilyBinding({
      headSha: stringField(result, "review_head_sha"),
      findingsFile: stringField(result, "findings_file"),
      worktreeRoot: worktreePath,
    });
    addOwnedPath(owned, sharedContext.input_file);
    addOwnedPath(owned, sharedContext.context_file);
    collectResultArtifactPaths(owned, result);
    const auditFile = `.ephemeral/pr-${lease.pr_number}-${stringField(result, "review_head_sha")}-phase5-audit.md`;
    const auditStat = await lstat(path.join(worktreePath, auditFile)).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return null;
        throw err;
      },
    );
    if (auditStat?.isFile()) addOwnedPath(owned, auditFile);
  }
  if (lease.artifacts.approved_review_file !== null) {
    const result = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.result_file ?? "",
      "result file",
    );
    const approved = await readRequiredJson<JsonObject>(
      worktreePath,
      lease.artifacts.approved_review_file,
      "approved review file",
    );
    const ownership = await validateApprovedReviewOwnership(
      lease,
      worktreePath,
      validateApprovedIdentity(
        approved,
        lease,
        stringField(result, "review_head_sha"),
      ),
      await scopeBaseRefFromValidatedResult(result, worktreePath),
    );
    addOwnedPath(owned, lease.artifacts.approved_review_file);
    addOwnedPath(owned, ownership.reviewBodyFile);
    addOwnedPath(owned, ownership.reviewPayloadFile);
    addOwnedPath(owned, lease.artifacts.validated_payload_file);
  }

  return owned;
}

function eligiblePreparationRecovery(lease: PrReviewLease | null): boolean {
  return (
    lease !== null &&
    lease.state === "failed" &&
    lease.failure.phase === "handoff-validation" &&
    lease.failure.recoverability === "recoverable" &&
    Object.values(lease.artifacts).every((value) => value === null) &&
    lease.presentation.presented_at === null &&
    lease.presentation.status === null &&
    lease.validation.result_manifest.status === null &&
    !lease.github.github_post_attempted &&
    lease.github.github_post_result === "not-attempted" &&
    lease.github.github_posted_at === null
  );
}

function readPreparationFailureDirectories(): string[] {
  const text = optionalEnv("PREPARATION_FAILURE_DIRS");
  if (text === undefined) return [];
  const directories: unknown = JSON.parse(text);
  if (
    !Array.isArray(directories) ||
    directories.some((value) => typeof value !== "string") ||
    new Set(directories).size !== directories.length
  )
    throw new PrReviewLeaseError(
      "PREPARATION_FAILURE_DIRS must be distinct directory strings",
    );
  return directories;
}

function validatePreparationFailureRecords(
  records: PrReviewLease["preparation_failures"],
): void {
  if (records === undefined) return;
  if (!Array.isArray(records))
    throw new PrReviewLeaseError("preparation_failures must be an array");
  const directories = new Set<string>();
  const candidates = new Set<string>();
  for (const record of records) {
    if (
      !isObject(record) ||
      Object.keys(record).sort().join(",") !==
        (record.second_pair === undefined
          ? "diagnostics_sha256,directory,scope_sha256"
          : "diagnostics_sha256,directory,scope_sha256,second_pair") ||
      typeof record.directory !== "string" ||
      typeof record.scope_sha256 !== "string" ||
      typeof record.diagnostics_sha256 !== "string" ||
      !SHA256_RE.test(record.scope_sha256) ||
      !SHA256_RE.test(record.diagnostics_sha256)
    )
      throw new PrReviewLeaseError("preparation failure record mismatch");
    validateDirectChild("preparation failure directory", record.directory);
    if (
      !path.posix
        .basename(record.directory)
        .startsWith("provider-scope-capture.")
    )
      throw new PrReviewLeaseError(
        "preparation failure directory family mismatch",
      );
    if (
      record.second_pair !== undefined &&
      (!isObject(record.second_pair) ||
        Object.keys(record.second_pair).sort().join(",") !==
          "diagnostics_sha256,scope_sha256" ||
        typeof record.second_pair.scope_sha256 !== "string" ||
        typeof record.second_pair.diagnostics_sha256 !== "string" ||
        !SHA256_RE.test(record.second_pair.scope_sha256) ||
        !SHA256_RE.test(record.second_pair.diagnostics_sha256))
    )
      throw new PrReviewLeaseError("preparation failure second_pair mismatch");
    if (directories.has(record.directory))
      throw new PrReviewLeaseError(
        "duplicate preparation failure directory or candidate digest",
      );
    directories.add(record.directory);
    for (const pair of [
      record,
      ...(record.second_pair === undefined ? [] : [record.second_pair]),
    ]) {
      if (candidates.has(pair.scope_sha256))
        throw new PrReviewLeaseError(
          "duplicate preparation failure directory or candidate digest",
        );
      candidates.add(pair.scope_sha256);
    }
  }
}

async function validatePreparationHandoff(
  lease: PrReviewLease,
  worktreePath: string,
): Promise<JsonObject> {
  const handoffFile = lease.artifacts.handoff_file;
  if (handoffFile === null)
    throw new PrReviewLeaseError(
      "HANDOFF_FILE is required for preparation recovery",
    );
  const { stdout } = await execFileAsync("git", [
    "-C",
    worktreePath,
    "rev-parse",
    "HEAD",
  ]);
  const head = optionalEnv("HEAD_SHA") ?? stdout.trim();
  if (!SHA_RE.test(head))
    throw new PrReviewLeaseError("HEAD_SHA must be a full commit SHA");
  if (stdout.trim() !== head)
    throw new PrReviewLeaseError("preparation recovery worktree head mismatch");
  if (
    !(await isRegisteredWorktree(
      requiredEnv("PRIMARY_REPOSITORY_ROOT"),
      worktreePath,
    ))
  )
    throw new PrReviewLeaseError(
      "preparation recovery worktree is not registered",
    );
  return validatePrReviewPreparationHandoff({
    worktreeRoot: worktreePath,
    handoffFile,
    repository: lease.repository,
    prNumber: lease.pr_number,
    reviewHeadSha: head,
    leaseBaseRef: lease.base_ref,
    leaseHeadRef: lease.head_ref,
  });
}

async function preparationScope(
  handoff: JsonObject,
  worktreePath: string,
): Promise<JsonObject> {
  if (!isObject(handoff.artifacts))
    throw new PrReviewLeaseError("handoff artifacts missing");
  return readRequiredJson<JsonObject>(
    worktreePath,
    stringField(handoff.artifacts, "scope_decision_file"),
    "scope decision file",
  );
}

async function validatePreparationFailureDirectory(
  directory: string,
  scope: JsonObject,
  worktreePath: string,
): Promise<NonNullable<PrReviewLease["preparation_failures"]>[number]> {
  validateDirectChild("preparation failure directory", directory);
  if (!path.posix.basename(directory).startsWith("provider-scope-capture."))
    throw new PrReviewLeaseError(
      "preparation failure directory family mismatch",
    );
  await assertEphemeralDirectory(worktreePath);
  const full = path.join(worktreePath, directory);
  const info = await lstat(full);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new PrReviewLeaseError(
      "preparation failure scratch must be a real directory",
    );
  const entries = (await readdir(full)).sort().join(",");
  const hasSecondPair =
    entries ===
    "failed-scope.json,second-failed-scope.json,second-validator.stderr,validator.stderr";
  if (!hasSecondPair && entries !== "failed-scope.json,validator.stderr")
    throw new PrReviewLeaseError(
      "preparation failure scratch entries mismatch",
    );
  const pairs = hasSecondPair
    ? ([
        ["failed-scope.json", "validator.stderr"],
        ["second-failed-scope.json", "second-validator.stderr"],
      ] as const)
    : ([["failed-scope.json", "validator.stderr"]] as const);
  const digests: { scope_sha256: string; diagnostics_sha256: string }[] = [];
  for (const pair of pairs) {
    const bytes: Buffer[] = [];
    for (const name of pair) {
      const stat = await lstat(path.join(full, name));
      if (stat.isSymbolicLink() || !stat.isFile())
        throw new PrReviewLeaseError(
          "preparation failure evidence must be regular nonsymlink files",
        );
      bytes.push(await readFile(path.join(full, name)));
    }
    const [candidateBytes, diagnostics] = bytes as [Buffer, Buffer];
    if (diagnostics.toString("utf8").trim().length === 0)
      throw new PrReviewLeaseError(
        "preparation failure diagnostics must be nonempty",
      );
    const candidate: unknown = JSON.parse(candidateBytes.toString("utf8"));
    if (
      !isObject(candidate) ||
      !isObject(candidate.semantic_decision) ||
      !isObject(scope.semantic_decision) ||
      typeof candidate.semantic_decision.notes !== "string" ||
      typeof scope.semantic_decision.notes !== "string"
    )
      throw new PrReviewLeaseError(
        "preparation failure candidate scope mismatch",
      );
    const correctableDifference =
      !isDeepStrictEqual(
        candidate.semantic_decision.checked,
        scope.semantic_decision.checked,
      ) || !isDeepStrictEqual(candidate.language_hints, scope.language_hints);
    const corrected = {
      ...candidate,
      language_hints: scope.language_hints,
      semantic_decision: {
        ...candidate.semantic_decision,
        checked: scope.semantic_decision.checked,
        notes: scope.semantic_decision.notes,
      },
    };
    if (!correctableDifference || !isDeepStrictEqual(corrected, scope))
      throw new PrReviewLeaseError(
        "preparation failure candidate exceeds mechanical custody family",
      );
    digests.push({
      scope_sha256: createHash("sha256").update(candidateBytes).digest("hex"),
      diagnostics_sha256: createHash("sha256")
        .update(diagnostics)
        .digest("hex"),
    });
  }
  const first = digests[0];
  if (first === undefined)
    throw new PrReviewLeaseError("preparation failure first pair missing");
  return {
    directory,
    ...first,
    ...(hasSecondPair ? { second_pair: digests[1] } : {}),
  };
}

async function validatePreparationFailures(
  lease: PrReviewLease,
  worktreePath: string,
  suppliedHandoff?: string,
): Promise<void> {
  const handoffFile =
    lease.artifacts.handoff_file ??
    suppliedHandoff ??
    optionalEnv("HANDOFF_FILE");
  const custodyLease = {
    ...lease,
    artifacts: { ...lease.artifacts, handoff_file: handoffFile ?? null },
  };
  const handoff = await validatePreparationHandoff(custodyLease, worktreePath);
  const scope = await preparationScope(handoff, worktreePath);
  for (const record of lease.preparation_failures ?? []) {
    const actual = await validatePreparationFailureDirectory(
      record.directory,
      scope,
      worktreePath,
    );
    if (!isDeepStrictEqual(actual, record))
      throw new PrReviewLeaseError(
        "preparation failure evidence digest mismatch",
      );
  }
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
  addOwnedPath(owned, stringField(artifacts, "provider_scope_evidence_file"));
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
  addOwnedPath(owned, stringField(artifacts, "provider_scope_evidence_file"));
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
  if (lease.state === "gated") {
    const status = presentationStatusFromResult(result);
    if (status !== lease.presentation.status) {
      throw new PrReviewLeaseError("presentation status mismatch");
    }
  }
}

function presentationStatusFromResult(result: JsonObject): PresentationStatus;
function presentationStatusFromResult(
  result: JsonObject,
  options: { allowNotPresented: true },
): ResultPresentationStatus;
function presentationStatusFromResult(
  result: JsonObject,
  options: { allowNotPresented?: boolean },
): ResultPresentationStatus;
function presentationStatusFromResult(
  result: JsonObject,
  options: { allowNotPresented?: boolean } = {},
): ResultPresentationStatus {
  if (!isObject(result.presentation)) {
    throw new PrReviewLeaseError("result presentation missing");
  }
  const status = result.presentation.status;
  if (status === "not-presented" && options.allowNotPresented === true) {
    return status;
  }
  if (status !== "preview-current" && status !== "edited") {
    throw new PrReviewLeaseError("result presentation mismatch");
  }
  return status;
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
    await lstat(path.join(process.cwd(), file));
    const lease = await readRequiredJson<PrReviewLease>(
      process.cwd(),
      file,
      "lease file",
    );
    validateLeaseShape(lease);
    return lease;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function assertLeaseObjectShape(lease: PrReviewLease): void {
  if (!isObject(lease)) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (!isObject(lease.artifacts)) {
    throw new PrReviewLeaseError("lease artifacts metadata missing");
  }
  if (!isObject(lease.validation)) {
    throw new PrReviewLeaseError("lease validation metadata missing");
  }
  if (!isObject(lease.validation.result_manifest)) {
    throw new PrReviewLeaseError("lease result_manifest metadata missing");
  }
  if (!("sha256" in lease.validation.result_manifest)) {
    throw new PrReviewLeaseError("result manifest digest missing");
  }
  if (!isObject(lease.presentation)) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (!isObject(lease.terminal)) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (!isObject(lease.failure)) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (!isObject(lease.github)) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (lease.cleanup !== undefined && !isObject(lease.cleanup)) {
    throw new PrReviewLeaseError("lease cleanup metadata mismatch");
  }
}

function validateCleanupMetadata(cleanup: PrReviewLease["cleanup"]): void {
  if (cleanup === undefined) return;
  const keys = Object.keys(cleanup).sort();
  const isLegacyCleanup =
    keys.length === 2 &&
    keys[0] === "last_checked_at" &&
    keys[1] === "last_outcome";
  const isCurrentCleanup =
    keys.length === 3 &&
    keys[0] === "last_checked_at" &&
    keys[1] === "last_outcome" &&
    keys[2] === "removed_at";
  if (!isLegacyCleanup && !isCurrentCleanup) {
    throw new PrReviewLeaseError("lease cleanup metadata mismatch");
  }
  if (
    cleanup.last_outcome !== null &&
    cleanup.last_outcome !== "removed" &&
    cleanup.last_outcome !== "retained" &&
    cleanup.last_outcome !== "skipped" &&
    cleanup.last_outcome !== "failed"
  ) {
    throw new PrReviewLeaseError("lease cleanup outcome mismatch");
  }
  if (cleanup.last_checked_at !== null) {
    validateTimestamp("cleanup.last_checked_at", cleanup.last_checked_at);
  }
  if (isCurrentCleanup && cleanup.removed_at !== null) {
    validateTimestamp("cleanup.removed_at", cleanup.removed_at);
  }
}

async function canonicalPrReviewWorktreePath(
  identity: Pick<LeaseIdentity, "primaryRoot" | "prNumber">,
): Promise<string> {
  const lexicalPath = path.join(
    identity.primaryRoot,
    ".worktrees",
    `pr-${identity.prNumber}-review`,
  );
  try {
    return await realpath(lexicalPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw err;
    }
  }
  try {
    return path.join(
      await realpath(path.dirname(lexicalPath)),
      path.basename(lexicalPath),
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw err;
    }
    return lexicalPath;
  }
}

async function hasPostCleanupArchiveAuthority(
  previous: PrReviewLease | null,
  identity: Pick<LeaseIdentity, "primaryRoot" | "prNumber">,
): Promise<boolean> {
  const canonicalWorktreePath = await canonicalPrReviewWorktreePath(identity);
  return (
    previous !== null &&
    (previous.state === "posted" || previous.state === "aborted") &&
    typeof previous.cleanup?.removed_at === "string" &&
    normalizeComparablePath(previous.worktree_path) ===
      normalizeComparablePath(canonicalWorktreePath)
  );
}

function assertExistingLeaseIdentity(
  lease: PrReviewLease | null,
  identity: LeaseIdentity,
): void {
  if (lease === null) {
    return;
  }
  if (lease.repository !== identity.repository) {
    throw new PrReviewLeaseError("lease repository mismatch");
  }
  if (lease.pr_number !== identity.prNumber) {
    throw new PrReviewLeaseError("lease PR number mismatch");
  }
  if (lease.worktree_path !== identity.worktreePath) {
    throw new PrReviewLeaseError("lease worktree path mismatch");
  }
  if (lease.worktree_digest !== identity.worktreeDigest) {
    throw new PrReviewLeaseError("lease worktree digest mismatch");
  }
  if (lease.lease_file !== identity.leaseFile) {
    throw new PrReviewLeaseError("lease file identity mismatch");
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

async function assertReadableWorktree(worktreePath: string): Promise<void> {
  try {
    const stat = await lstat(worktreePath);
    if (!stat.isDirectory()) {
      throw new PrReviewLeaseError("WORKTREE_PATH must be a directory");
    }
    await access(worktreePath, constants.R_OK | constants.X_OK);
  } catch (err) {
    if (err instanceof PrReviewLeaseError) throw err;
    throw new PrReviewLeaseError("WORKTREE_PATH is not readable");
  }
}

async function sha256DirectChild(
  root: string,
  relPath: string,
  label: string,
): Promise<string> {
  await assertReadableDirectChild(root, relPath, label);
  return createHash("sha256")
    .update(await readFile(path.join(root, relPath)))
    .digest("hex");
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
      sha256: null,
    },
  };
}

function validResultValidation(
  validatedAt: string,
  sha256: string,
): PrReviewLease["validation"] {
  return {
    result_manifest: {
      status: "valid",
      validated_at: validatedAt,
      sha256,
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
  const wholeSeconds = value.replace(/\.\d+Z$/u, "Z");
  if (
    !TIMESTAMP_RE.test(value) ||
    Number.isNaN(Date.parse(wholeSeconds)) ||
    new Date(wholeSeconds).toISOString().replace(/\.\d{3}Z$/u, "Z") !==
      wholeSeconds
  ) {
    throw new PrReviewLeaseError(
      `${label} must be a UTC RFC3339 timestamp ending in Z`,
    );
  }
}

function compareTimestamps(left: string, right: string): number {
  // Shape validation precedes chronology. Fixed calendar fields sort by instant;
  // zero-padding decimal tails retains precision beyond JavaScript milliseconds.
  const leftSeconds = left.slice(0, 19);
  const rightSeconds = right.slice(0, 19);
  if (leftSeconds !== rightSeconds) return leftSeconds < rightSeconds ? -1 : 1;
  const leftFraction = left.includes(".") ? left.slice(20, -1) : "";
  const rightFraction = right.includes(".") ? right.slice(20, -1) : "";
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftPadded = leftFraction.padEnd(width, "0");
  const rightPadded = rightFraction.padEnd(width, "0");
  return leftPadded < rightPadded ? -1 : leftPadded > rightPadded ? 1 : 0;
}

function validateKnownLeaseState(value: unknown): asserts value is LeaseState {
  if (typeof value !== "string") {
    throw new PrReviewLeaseError("lease state must be a string");
  }
  parseState(value);
}

function nowTimestamp(): string {
  return new Date().toISOString();
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
