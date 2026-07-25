import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
import { requireDirectEphemeralChild } from "./paths.js";
import { validateSharedContextFamilyBinding } from "./play-review-shared-context.js";
import { validatePrReviewResultCommandAuthority } from "./pr-review-result-validation.js";

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

type DiscoveryClassification =
  | "resumable"
  | "terminal"
  | "unsupported"
  | "artifact-bearing"
  | "missing"
  | "unregistered"
  | "dirty"
  | "unmanaged"
  | "status-inspection-failed"
  | "invalid";

interface DiscoveryActiveLease {
  lease_file: string;
  worktree_path: string | null;
  state: LeaseState | null;
  classification: DiscoveryClassification;
  reason: string;
}

interface DiscoveryInvalidEntry {
  path: string;
  reason: string;
}

interface DiscoveryCanonicalTarget {
  worktree_path: string;
  status: "absent" | "directory" | "invalid";
  registered: boolean;
  parent_status: "absent" | "directory" | "invalid";
}

interface PrReviewDiscoveryInventory {
  repository: string;
  pr_number: number;
  primary_repository_root: string;
  canonical_target: DiscoveryCanonicalTarget;
  registrations: string[];
  active: DiscoveryActiveLease[];
  archived: string[];
  invalid: DiscoveryInvalidEntry[];
}

interface PrReviewDiscoveryReductionInput extends PrReviewDiscoveryInventory {
  comparison_platform: NodeJS.Platform;
}

interface PrReviewDiscoveryResult extends PrReviewDiscoveryInventory {
  schema: "pr-review/discovery/v1";
  disposition:
    | "create"
    | "resume"
    | "cleanup-required"
    | "ambiguous"
    | "invalid";
  resume: { lease_file: string; worktree_path: string } | null;
  cleanup: {
    lease_file: string | null;
    worktree_path: string;
    reason: string;
  } | null;
}

interface StableDiscoveryDirectory {
  entries: string[];
  entry_kinds: string[];
  identity: Awaited<ReturnType<typeof lstat>>;
}

interface StableDiscoveryFile {
  contents: string;
  sha256: string;
  identity: Awaited<ReturnType<typeof lstat>>;
}

interface StableDiscoveryPath {
  status: "absent" | "directory" | "file" | "invalid";
  identity: Awaited<ReturnType<typeof lstat>> | null;
}

interface DiscoveryLeaseInspection {
  entry: DiscoveryActiveLease;
  verifyFinal: () => Promise<DiscoveryActiveLease>;
}

const SHA_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
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
      case "discover":
        return ok(`${JSON.stringify(await discoverReviewSession())}\n`);
      case "write":
        return ok(`${await writeLease()}\n`);
      case "record-audit-failure":
        return ok(`${await recordAuditFailure()}\n`);
      case "validate":
        await validateLeaseCommand();
        return ok("");
      case "read-status":
        return ok(`${await readStatus()}\n`);
      case "inspect-worktree":
        return ok(await inspectWorktree());
      case "cleanup-worktree":
        return ok(await cleanupWorktree());
      default:
        throw new PrReviewLeaseError(
          "usage: review-leases.sh derive-path|discover|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree",
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
  }
}

export function reducePrReviewDiscovery(
  inventory: PrReviewDiscoveryReductionInput,
): PrReviewDiscoveryResult {
  const active = [...inventory.active].sort((left, right) =>
    ordinalCompare(left.lease_file, right.lease_file),
  );
  const archived = ordinalSort(inventory.archived);
  const invalid = [...inventory.invalid].sort((left, right) =>
    ordinalCompare(left.path, right.path),
  );
  const structuralClaims = active.filter(
    (entry) =>
      entry.classification !== "invalid" &&
      entry.classification !== "artifact-bearing",
  );
  const resumable = active.filter(
    (entry) => entry.classification === "resumable",
  );
  const blockers = active.filter(
    (entry) => entry.classification !== "resumable",
  );
  const canonicalKey = discoveryComparablePath(
    inventory.canonical_target.worktree_path,
    inventory.comparison_platform,
  );
  const canonicalClaimed = active.some(
    (entry) =>
      entry.worktree_path !== null &&
      discoveryComparablePath(
        entry.worktree_path,
        inventory.comparison_platform,
      ) === canonicalKey,
  );
  const canonicalBlocked =
    inventory.canonical_target.parent_status === "invalid" ||
    (inventory.canonical_target.status !== "absent" && !canonicalClaimed) ||
    (inventory.canonical_target.registered && !canonicalClaimed);

  let disposition: PrReviewDiscoveryResult["disposition"];
  let resume: PrReviewDiscoveryResult["resume"] = null;
  let cleanup: PrReviewDiscoveryResult["cleanup"] = null;
  if (
    invalid.length > 0 ||
    active.some((entry) => entry.classification === "invalid")
  ) {
    disposition = "invalid";
  } else if (structuralClaims.length > 1) {
    disposition = "ambiguous";
  } else if (blockers.length > 0 || canonicalBlocked) {
    disposition = "cleanup-required";
    const selected = blockers[0];
    cleanup =
      selected === undefined
        ? {
            lease_file: null,
            worktree_path: inventory.canonical_target.worktree_path,
            reason: inventory.canonical_target.registered
              ? "canonical-target-registered"
              : "canonical-target-occupied",
          }
        : {
            lease_file: selected.lease_file,
            worktree_path:
              selected.worktree_path ??
              inventory.canonical_target.worktree_path,
            reason: selected.reason,
          };
  } else if (resumable.length === 1) {
    disposition = "resume";
    resume = {
      lease_file: resumable[0].lease_file,
      worktree_path: resumable[0].worktree_path ?? "",
    };
  } else {
    disposition = "create";
  }

  return {
    schema: "pr-review/discovery/v1",
    repository: inventory.repository,
    pr_number: inventory.pr_number,
    primary_repository_root: inventory.primary_repository_root,
    canonical_target: inventory.canonical_target,
    registrations: ordinalSort(inventory.registrations),
    active,
    archived,
    invalid,
    disposition,
    resume,
    cleanup,
  };
}

async function discoverReviewSession(): Promise<PrReviewDiscoveryResult> {
  const repository = requiredEnv("REPOSITORY");
  if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    throw new PrReviewLeaseError("REPOSITORY must use owner/name form");
  }
  const prNumber = parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
  const requestedRoot = discoveryFilesystemPath(
    requiredEnv("PRIMARY_REPOSITORY_ROOT"),
  );
  const primaryRoot = await realpath(requestedRoot);
  const gitEnv = discoveryGitEnvironment();
  await assertDiscoveryPrimaryRoot(primaryRoot, gitEnv);

  const registrations = await readDiscoveryWorktreeRegistrations(
    primaryRoot,
    gitEnv,
  );
  const registrationKeys = new Set(
    registrations.map((entry) =>
      discoveryComparablePath(entry, process.platform),
    ),
  );
  const canonicalPath = path.join(
    primaryRoot,
    ".worktrees",
    `pr-${prNumber}-review`,
  );
  const parentSnapshot = await observeStableDiscoveryPathSnapshot(
    path.dirname(canonicalPath),
    true,
  );
  const parentObservation = parentSnapshot.status;
  const targetSnapshot =
    parentObservation === "directory"
      ? await observeStableDiscoveryPathSnapshot(canonicalPath, true)
      : { status: "absent" as const, identity: null };
  const targetObservation = targetSnapshot.status;
  const canonicalTarget: DiscoveryCanonicalTarget = {
    worktree_path: canonicalPath,
    status:
      targetObservation === "absent"
        ? "absent"
        : targetObservation === "directory"
          ? "directory"
          : "invalid",
    registered: registrationKeys.has(
      discoveryComparablePath(canonicalPath, process.platform),
    ),
    parent_status:
      parentObservation === "absent"
        ? "absent"
        : parentObservation === "directory"
          ? "directory"
          : "invalid",
  };

  const active: DiscoveryActiveLease[] = [];
  const activeInspections: DiscoveryLeaseInspection[] = [];
  const archived: string[] = [];
  const invalid: DiscoveryInvalidEntry[] = [];
  if (
    canonicalTarget.parent_status === "invalid" ||
    canonicalTarget.status === "invalid"
  ) {
    invalid.push({
      path: canonicalPath,
      reason: "invalid-canonical-target",
    });
  }

  const ephemeralPath = path.join(primaryRoot, ".ephemeral");
  let entries: string[] = [];
  let ephemeralSnapshot: StableDiscoveryDirectory | null = null;
  try {
    ephemeralSnapshot = await readStableDiscoveryDirectory(ephemeralPath);
    entries = ephemeralSnapshot?.entries ?? [];
  } catch {
    invalid.push({
      path: ".ephemeral",
      reason: "invalid-discovery-directory",
    });
  }

  const activeName = new RegExp(
    `^pr-${prNumber}-[0-9a-f]{64}-lease\\.json$`,
    "u",
  );
  const archiveName = new RegExp(
    `^pr-${prNumber}-[0-9a-f]{64}-([0-9]{8}T[0-9]{6})-(posted|aborted)-archived-lease\\.json$`,
    "u",
  );
  const prPrefix = `pr-${prNumber}-`;
  for (const entry of entries) {
    if (!entry.startsWith(prPrefix)) continue;
    const relativePath = `.ephemeral/${entry}`;
    const absolutePath = path.join(ephemeralPath, entry);
    const archiveMatch = entry.match(archiveName);
    if (archiveMatch !== null && isValidCompactUtcTimestamp(archiveMatch[1])) {
      if ((await observeStableDiscoveryPath(absolutePath, false)) === "file") {
        archived.push(relativePath);
      } else {
        invalid.push({ path: relativePath, reason: "invalid-archived-entry" });
      }
      continue;
    }
    if (activeName.test(entry)) {
      const inspection = await inspectDiscoveryLease({
        primaryRoot,
        relativePath,
        repository,
        prNumber,
        registrationKeys,
        gitEnv,
      });
      active.push(inspection.entry);
      activeInspections.push(inspection);
      continue;
    }
    if (entry.endsWith("-lease.json")) {
      invalid.push({ path: relativePath, reason: "invalid-lease-name" });
    }
  }
  try {
    if (ephemeralSnapshot === null) {
      if (
        (await observeStableDiscoveryPath(ephemeralPath, true)) !== "absent"
      ) {
        throw new PrReviewLeaseError(
          "discovery directory appeared during inspection",
        );
      }
    } else {
      await assertSameDiscoveryDirectory(ephemeralPath, ephemeralSnapshot);
    }
  } catch {
    if (!invalid.some((entry) => entry.path === ".ephemeral")) {
      invalid.push({
        path: ".ephemeral",
        reason: "invalid-discovery-directory",
      });
    }
  }

  let registrationsChanged = false;
  try {
    const finalRegistrations = await readDiscoveryWorktreeRegistrations(
      primaryRoot,
      gitEnv,
    );
    registrationsChanged = !sameOrdinalStringArray(
      discoveryRegistrationSnapshot(registrations, process.platform),
      discoveryRegistrationSnapshot(finalRegistrations, process.platform),
    );
  } catch {
    registrationsChanged = true;
  }
  if (
    registrationsChanged &&
    !invalid.some(
      (entry) =>
        entry.path === ".git/worktrees" &&
        entry.reason === "worktree-registrations-changed",
    )
  ) {
    invalid.push({
      path: ".git/worktrees",
      reason: "worktree-registrations-changed",
    });
  }

  try {
    if (ephemeralSnapshot === null) {
      if (
        (await observeStableDiscoveryPath(ephemeralPath, true)) !== "absent"
      ) {
        throw new PrReviewLeaseError(
          "discovery directory appeared during final inspection",
        );
      }
    } else {
      await assertSameDiscoveryDirectory(ephemeralPath, ephemeralSnapshot);
    }
  } catch {
    if (!invalid.some((entry) => entry.path === ".ephemeral")) {
      invalid.push({
        path: ".ephemeral",
        reason: "invalid-discovery-directory",
      });
    }
  }

  const finalParentSnapshot = await observeStableDiscoveryPathSnapshot(
    path.dirname(canonicalPath),
    true,
  );
  const finalTargetSnapshot =
    finalParentSnapshot.status === "directory"
      ? await observeStableDiscoveryPathSnapshot(canonicalPath, true)
      : { status: "absent" as const, identity: null };
  if (
    !sameStableDiscoveryPath(parentSnapshot, finalParentSnapshot) ||
    !sameStableDiscoveryPath(targetSnapshot, finalTargetSnapshot)
  ) {
    invalid.push({
      path: canonicalPath,
      reason: "canonical-target-changed",
    });
  }

  for (let index = 0; index < activeInspections.length; index += 1) {
    active[index] = await activeInspections[index].verifyFinal();
  }

  return reducePrReviewDiscovery({
    repository,
    pr_number: prNumber,
    primary_repository_root: primaryRoot,
    canonical_target: canonicalTarget,
    registrations,
    active,
    archived,
    invalid,
    comparison_platform: process.platform,
  });
}

function isValidCompactUtcTimestamp(value: string): boolean {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/u);
  if (match === null) return false;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return (
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().replace(/[-:]/gu, "").slice(0, 15) === value
  );
}

async function inspectDiscoveryLease({
  primaryRoot,
  relativePath,
  repository,
  prNumber,
  registrationKeys,
  gitEnv,
}: {
  primaryRoot: string;
  relativePath: string;
  repository: string;
  prNumber: number;
  registrationKeys: ReadonlySet<string>;
  gitEnv: NodeJS.ProcessEnv;
}): Promise<DiscoveryLeaseInspection> {
  const invalid = (
    reason: string,
    lease?: PrReviewLease,
  ): DiscoveryActiveLease => ({
    lease_file: relativePath,
    worktree_path: lease?.worktree_path ?? null,
    state: lease?.state ?? null,
    classification: "invalid",
    reason,
  });
  const fixed = (entry: DiscoveryActiveLease): DiscoveryLeaseInspection => ({
    entry,
    verifyFinal: async () => entry,
  });
  let lease: PrReviewLease;
  let leaseSnapshot: StableDiscoveryFile;
  const leasePath = path.join(primaryRoot, relativePath);
  try {
    leaseSnapshot = await readStableDiscoveryFile(leasePath);
  } catch {
    return fixed(invalid("invalid-lease"));
  }
  try {
    lease = parseDiscoveryLease(JSON.parse(leaseSnapshot.contents));
  } catch {
    const entry = invalid("invalid-lease");
    return {
      entry,
      verifyFinal: async () => {
        try {
          await assertSameDiscoveryFile(leasePath, leaseSnapshot);
          return entry;
        } catch {
          return invalid("lease-replaced");
        }
      },
    };
  }
  let verifyCandidateFinal = async (): Promise<void> => {};
  const finalize = async (
    entry: DiscoveryActiveLease,
  ): Promise<DiscoveryLeaseInspection> => {
    const verifyFinal = async (): Promise<DiscoveryActiveLease> => {
      try {
        await assertSameDiscoveryFile(leasePath, leaseSnapshot);
      } catch {
        return invalid("lease-replaced", lease);
      }
      try {
        await verifyCandidateFinal();
      } catch {
        return invalid("worktree-replaced", lease);
      }
      if (entry.classification === "resumable") {
        let finalDirty: boolean;
        try {
          finalDirty = await discoveryWorktreeDirty(
            discoveryFilesystemPath(lease.worktree_path),
            gitEnv,
          );
        } catch {
          return invalid("status-inspection-failed", lease);
        }
        try {
          await assertSameDiscoveryFile(leasePath, leaseSnapshot);
        } catch {
          return invalid("lease-replaced", lease);
        }
        try {
          await verifyCandidateFinal();
        } catch {
          return invalid("worktree-replaced", lease);
        }
        if (finalDirty) {
          return invalid("worktree-dirty-after-snapshot", lease);
        }
      }
      return entry;
    };
    const verified = await verifyFinal();
    return verified === entry ? { entry, verifyFinal } : fixed(verified);
  };

  const expectedLeaseFile = `.ephemeral/pr-${prNumber}-${lease.worktree_digest}-lease.json`;
  if (
    lease.repository !== repository ||
    lease.pr_number !== prNumber ||
    lease.lease_file !== relativePath ||
    lease.lease_file !== expectedLeaseFile
  ) {
    return finalize(invalid("lease-identity-mismatch", lease));
  }

  const filesystemPath = discoveryFilesystemPath(lease.worktree_path);
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(filesystemPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      verifyCandidateFinal = async () => {
        if (
          (await observeStableDiscoveryPath(filesystemPath, true)) !== "absent"
        ) {
          throw new PrReviewLeaseError(
            "candidate worktree appeared during inspection",
          );
        }
      };
      return finalize(discoveryEntry(lease, "missing", "worktree-missing"));
    }
    return finalize(invalid("worktree-inspection-failed", lease));
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    return finalize(invalid("invalid-worktree-entry", lease));
  }
  let physicalWorktree: string;
  try {
    physicalWorktree = await realpath(filesystemPath);
  } catch {
    return finalize(invalid("worktree-identity-unverifiable", lease));
  }
  if (
    discoveryComparablePath(physicalWorktree, process.platform) !==
      discoveryComparablePath(lease.worktree_path, process.platform) ||
    digestPath(physicalWorktree) !== lease.worktree_digest
  ) {
    return finalize(invalid("worktree-digest-mismatch", lease));
  }

  let ephemeralSnapshot: StableDiscoveryDirectory | null;
  try {
    ephemeralSnapshot = await readStableDiscoveryDirectory(
      path.join(filesystemPath, ".ephemeral"),
    );
    await assertSameDiscoveryDirectoryIdentity(filesystemPath, before);
  } catch {
    return finalize(invalid("invalid-ephemeral-directory", lease));
  }
  verifyCandidateFinal = async (): Promise<void> => {
    await assertSameDiscoveryDirectoryIdentity(filesystemPath, before);
    const finalPhysicalWorktree = await realpath(filesystemPath);
    if (
      discoveryComparablePath(finalPhysicalWorktree, process.platform) !==
        discoveryComparablePath(physicalWorktree, process.platform) ||
      discoveryComparablePath(finalPhysicalWorktree, process.platform) !==
        discoveryComparablePath(lease.worktree_path, process.platform) ||
      digestPath(finalPhysicalWorktree) !== lease.worktree_digest
    ) {
      throw new PrReviewLeaseError(
        "candidate worktree identity changed during inspection",
      );
    }
    const candidateEphemeral = path.join(filesystemPath, ".ephemeral");
    if (ephemeralSnapshot === null) {
      if (
        (await observeStableDiscoveryPath(candidateEphemeral, true)) !==
        "absent"
      ) {
        throw new PrReviewLeaseError(
          "candidate ephemeral directory appeared during inspection",
        );
      }
    } else {
      await assertSameDiscoveryDirectory(candidateEphemeral, ephemeralSnapshot);
    }
  };
  const verifyCandidateSnapshot = verifyCandidateFinal;
  if (
    !registrationKeys.has(
      discoveryComparablePath(lease.worktree_path, process.platform),
    )
  ) {
    try {
      await verifyCandidateSnapshot();
    } catch {
      return finalize(invalid("worktree-replaced", lease));
    }
    return finalize(
      discoveryEntry(lease, "unregistered", "worktree-unregistered"),
    );
  }
  if (
    Object.values(lease.artifacts).some((artifactPath) => artifactPath !== null)
  ) {
    try {
      await verifyCandidateSnapshot();
    } catch {
      return finalize(invalid("worktree-replaced", lease));
    }
    return finalize(
      discoveryEntry(lease, "artifact-bearing", "artifact-authority-required"),
    );
  }
  if ((ephemeralSnapshot?.entries ?? []).length > 0) {
    try {
      await verifyCandidateSnapshot();
    } catch {
      return finalize(invalid("worktree-replaced", lease));
    }
    return finalize(
      discoveryEntry(lease, "unmanaged", "unmanaged-ephemeral-artifacts"),
    );
  }

  let dirty: boolean;
  try {
    dirty = await discoveryWorktreeDirty(filesystemPath, gitEnv);
  } catch {
    try {
      await verifyCandidateSnapshot();
    } catch {
      return finalize(invalid("worktree-replaced", lease));
    }
    return finalize(
      discoveryEntry(
        lease,
        "status-inspection-failed",
        "status-inspection-failed",
      ),
    );
  }
  try {
    await verifyCandidateSnapshot();
  } catch {
    return finalize(invalid("worktree-replaced", lease));
  }
  if (dirty) {
    return finalize(discoveryEntry(lease, "dirty", "worktree-dirty"));
  }
  if (lease.state === "posted" || lease.state === "aborted") {
    return finalize(discoveryEntry(lease, "terminal", "terminal-lease"));
  }
  if (lease.state !== "created") {
    return finalize(
      discoveryEntry(lease, "unsupported", "unsupported-lease-state"),
    );
  }
  return finalize(discoveryEntry(lease, "resumable", "resumable"));
}

function discoveryEntry(
  lease: PrReviewLease,
  classification: DiscoveryClassification,
  reason: string,
): DiscoveryActiveLease {
  return {
    lease_file: lease.lease_file,
    worktree_path: lease.worktree_path,
    state: lease.state,
    classification,
    reason,
  };
}

export function parseDiscoveryLease(value: unknown): PrReviewLease {
  assertClosedLeasePrimitiveShape(value);
  validateLeaseShape(value);
  return value;
}

function assertClosedLeasePrimitiveShape(
  value: unknown,
): asserts value is PrReviewLease {
  if (!isObject(value)) throw new PrReviewLeaseError("lease schema mismatch");
  assertExactKeys(
    value,
    [
      "schema",
      "repository",
      "pr_number",
      "state",
      "base_ref",
      "head_ref",
      "worktree_path",
      "worktree_digest",
      "lease_file",
      "created_at",
      "updated_at",
      "artifacts",
      "validation",
      "presentation",
      "terminal",
      "failure",
      "github",
    ],
    ["cleanup"],
  );
  const lease = value as unknown as PrReviewLease;
  if (
    lease.schema !== "pr-review/lease/v1" ||
    typeof lease.repository !== "string" ||
    !/^[^/\s]+\/[^/\s]+$/u.test(lease.repository) ||
    !Number.isSafeInteger(lease.pr_number) ||
    lease.pr_number <= 0 ||
    typeof lease.base_ref !== "string" ||
    lease.base_ref.length === 0 ||
    typeof lease.head_ref !== "string" ||
    lease.head_ref.length === 0 ||
    typeof lease.worktree_path !== "string" ||
    !isAbsoluteLeasePath(lease.worktree_path) ||
    typeof lease.worktree_digest !== "string" ||
    !SHA256_RE.test(lease.worktree_digest) ||
    typeof lease.lease_file !== "string" ||
    typeof lease.created_at !== "string" ||
    typeof lease.updated_at !== "string"
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  validateKnownLeaseState(lease.state);
  assertExactObject(lease.artifacts, [
    "handoff_file",
    "result_file",
    "approved_review_file",
    "validated_payload_file",
  ]);
  for (const value of Object.values(lease.artifacts)) {
    if (value !== null && typeof value !== "string") {
      throw new PrReviewLeaseError("lease schema mismatch");
    }
  }
  assertExactObject(lease.validation, ["result_manifest"]);
  assertExactObject(lease.validation.result_manifest, [
    "status",
    "validated_at",
    "sha256",
  ]);
  if (
    (lease.validation.result_manifest.status !== null &&
      lease.validation.result_manifest.status !== "valid") ||
    !nullableString(lease.validation.result_manifest.validated_at) ||
    !nullableString(lease.validation.result_manifest.sha256)
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  assertExactObject(lease.presentation, ["presented_at", "status"]);
  if (
    !nullableString(lease.presentation.presented_at) ||
    (lease.presentation.status !== null &&
      lease.presentation.status !== "preview-current" &&
      lease.presentation.status !== "edited")
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  assertExactObject(lease.terminal, ["finished_at", "reason"]);
  if (
    !nullableString(lease.terminal.finished_at) ||
    !nullableString(lease.terminal.reason)
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  assertExactObject(lease.failure, ["phase", "reason", "recoverability"]);
  if (
    (lease.failure.phase !== null &&
      ![
        "handoff-validation",
        "review",
        "result-validation",
        "preview-render",
        "approval-freeze",
        "stale-head",
        "github-post",
      ].includes(lease.failure.phase)) ||
    !nullableString(lease.failure.reason) ||
    (lease.failure.recoverability !== null &&
      !["recoverable", "unrecoverable", "unknown"].includes(
        lease.failure.recoverability,
      ))
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  assertExactObject(lease.github, [
    "github_post_attempted",
    "github_post_result",
    "github_posted_at",
  ]);
  if (
    typeof lease.github.github_post_attempted !== "boolean" ||
    !["succeeded", "failed", "not-attempted"].includes(
      lease.github.github_post_result,
    ) ||
    !nullableString(lease.github.github_posted_at)
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
  if (lease.cleanup !== undefined) {
    assertExactKeys(
      lease.cleanup,
      ["last_outcome", "last_checked_at"],
      ["removed_at"],
    );
    if (
      (lease.cleanup.last_outcome !== null &&
        !["removed", "retained", "skipped", "failed"].includes(
          lease.cleanup.last_outcome,
        )) ||
      !nullableString(lease.cleanup.last_checked_at) ||
      !nullableString(lease.cleanup.removed_at ?? null)
    ) {
      throw new PrReviewLeaseError("lease schema mismatch");
    }
  }
}

function assertExactObject(
  value: unknown,
  required: readonly string[],
): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new PrReviewLeaseError("lease schema mismatch");
  assertExactKeys(value, required);
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const actual = Object.keys(value).sort(ordinalCompare);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    throw new PrReviewLeaseError("lease schema mismatch");
  }
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAbsoluteLeasePath(value: string): boolean {
  if (/^\/[A-Za-z]\//u.test(value) && process.platform === "win32") {
    return false;
  }
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    /^\\\\[^\\]+\\[^\\]+/u.test(value) ||
    /^\/\/[^/]+\/[^/]+/u.test(value)
  );
}

async function readStableDiscoveryFile(
  file: string,
): Promise<StableDiscoveryFile> {
  const before = await lstat(file);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new PrReviewLeaseError("discovery lease is not a real file");
  }
  const handle = await open(file, constants.O_RDONLY);
  try {
    const opened = await handle.stat();
    if (!sameDiscoveryIdentity(before, opened) || !opened.isFile()) {
      throw new PrReviewLeaseError("discovery lease changed during open");
    }
    const contents = await handle.readFile({ encoding: "utf8" });
    const after = await lstat(file);
    if (!sameDiscoveryIdentity(before, after) || after.isSymbolicLink()) {
      throw new PrReviewLeaseError("discovery lease changed during read");
    }
    return {
      contents,
      sha256: createHash("sha256").update(contents).digest("hex"),
      identity: before,
    };
  } finally {
    await handle.close();
  }
}

async function assertSameDiscoveryFile(
  file: string,
  expected: StableDiscoveryFile,
): Promise<void> {
  const actual = await readStableDiscoveryFile(file);
  if (
    !sameDiscoveryFileIdentity(expected.identity, actual.identity) ||
    expected.sha256 !== actual.sha256 ||
    expected.contents !== actual.contents
  ) {
    throw new PrReviewLeaseError("discovery lease changed during inspection");
  }
}

async function readStableDiscoveryDirectory(
  directory: string,
): Promise<StableDiscoveryDirectory | null> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new PrReviewLeaseError("discovery directory is not a real directory");
  }
  const entries = ordinalSort(await readdir(directory));
  const entryKinds = await readDiscoveryEntryKinds(directory, entries);
  const after = await lstat(directory);
  const finalEntries = ordinalSort(await readdir(directory));
  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    !sameDiscoveryIdentity(before, after) ||
    !sameOrdinalStringArray(entries, finalEntries)
  ) {
    throw new PrReviewLeaseError(
      "discovery directory changed during inspection",
    );
  }
  return { entries, entry_kinds: entryKinds, identity: before };
}

async function assertSameDiscoveryDirectory(
  directory: string,
  expected: StableDiscoveryDirectory,
): Promise<void> {
  const actual = await lstat(directory);
  if (
    actual.isSymbolicLink() ||
    !actual.isDirectory() ||
    !sameDiscoveryIdentity(expected.identity, actual)
  ) {
    throw new PrReviewLeaseError(
      "discovery worktree changed during inspection",
    );
  }
  const entries = ordinalSort(await readdir(directory));
  const entryKinds = await readDiscoveryEntryKinds(directory, entries);
  const after = await lstat(directory);
  const finalEntries = ordinalSort(await readdir(directory));
  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    !sameDiscoveryIdentity(expected.identity, after) ||
    !sameOrdinalStringArray(expected.entries, entries) ||
    !sameOrdinalStringArray(expected.entry_kinds, entryKinds) ||
    !sameOrdinalStringArray(entries, finalEntries)
  ) {
    throw new PrReviewLeaseError(
      "discovery directory entries changed during inspection",
    );
  }
}

async function readDiscoveryEntryKinds(
  directory: string,
  entries: readonly string[],
): Promise<string[]> {
  const kinds: string[] = [];
  for (const entry of entries) {
    const stat = await lstat(path.join(directory, entry));
    const kind = stat.isSymbolicLink()
      ? "symlink"
      : stat.isFile()
        ? "file"
        : stat.isDirectory()
          ? "directory"
          : "other";
    kinds.push(`${entry}\u0000${kind}`);
  }
  return kinds;
}

async function assertSameDiscoveryDirectoryIdentity(
  directory: string,
  expected: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  const actual = await lstat(directory);
  if (
    actual.isSymbolicLink() ||
    !actual.isDirectory() ||
    !sameDiscoveryIdentity(expected, actual)
  ) {
    throw new PrReviewLeaseError(
      "discovery worktree changed during inspection",
    );
  }
}

function sameDiscoveryIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
    return left.dev === right.dev && left.ino === right.ino;
  }
  return left.mode === right.mode && left.birthtimeMs === right.birthtimeMs;
}

function sameDiscoveryFileIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    sameDiscoveryIdentity(left, right) &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function observeStableDiscoveryPathSnapshot(
  target: string,
  directory: boolean,
): Promise<StableDiscoveryPath> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent", identity: null };
    }
    return { status: "invalid", identity: null };
  }
  if (
    before.isSymbolicLink() ||
    (directory ? !before.isDirectory() : !before.isFile())
  ) {
    return { status: "invalid", identity: before };
  }
  try {
    const after = await lstat(target);
    if (!sameDiscoveryIdentity(before, after) || after.isSymbolicLink()) {
      return { status: "invalid", identity: after };
    }
  } catch {
    return { status: "invalid", identity: null };
  }
  return {
    status: directory ? "directory" : "file",
    identity: before,
  };
}

function sameStableDiscoveryPath(
  left: StableDiscoveryPath,
  right: StableDiscoveryPath,
): boolean {
  if (left.status !== right.status) return false;
  if (left.identity === null || right.identity === null) {
    return left.identity === right.identity;
  }
  return sameDiscoveryIdentity(left.identity, right.identity);
}

async function observeStableDiscoveryPath(
  target: string,
  directory: boolean,
): Promise<"absent" | "directory" | "file" | "invalid"> {
  return (await observeStableDiscoveryPathSnapshot(target, directory)).status;
}

async function assertDiscoveryPrimaryRoot(
  primaryRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const before = await lstat(primaryRoot);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new PrReviewLeaseError(
      "PRIMARY_REPOSITORY_ROOT must be a real directory",
    );
  }
  try {
    const topLevel = (
      await runDiscoveryGit(primaryRoot, ["rev-parse", "--show-toplevel"], env)
    ).trim();
    const gitDirectory = (
      await runDiscoveryGit(
        primaryRoot,
        ["rev-parse", "--absolute-git-dir"],
        env,
      )
    ).trim();
    const commonDirectoryRaw = (
      await runDiscoveryGit(primaryRoot, ["rev-parse", "--git-common-dir"], env)
    ).trim();
    const commonDirectory = path.isAbsolute(commonDirectoryRaw)
      ? commonDirectoryRaw
      : path.resolve(primaryRoot, commonDirectoryRaw);
    if (
      discoveryComparablePath(await realpath(topLevel), process.platform) !==
        discoveryComparablePath(primaryRoot, process.platform) ||
      discoveryComparablePath(
        await realpath(gitDirectory),
        process.platform,
      ) !==
        discoveryComparablePath(
          await realpath(commonDirectory),
          process.platform,
        )
    ) {
      throw new PrReviewLeaseError(
        "PRIMARY_REPOSITORY_ROOT must be the primary Git worktree",
      );
    }
    await assertSameDiscoveryDirectoryIdentity(primaryRoot, before);
  } catch (err) {
    if (err instanceof PrReviewLeaseError) throw err;
    throw new PrReviewLeaseError(
      "PRIMARY_REPOSITORY_ROOT must be the primary Git worktree",
    );
  }
}

async function readDiscoveryWorktreeRegistrations(
  primaryRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const stdout = await runDiscoveryGit(
    primaryRoot,
    ["worktree", "list", "--porcelain", "-z"],
    env,
  );
  return stdout
    .split("\0")
    .filter((entry) => entry.startsWith("worktree "))
    .map((entry) => entry.slice(9));
}

async function discoveryWorktreeDirty(
  worktreePath: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const stdout = await runDiscoveryGit(
    worktreePath,
    ["status", "--porcelain", "--untracked-files=all"],
    env,
  );
  return stdout.length > 0;
}

async function runDiscoveryGit(
  root: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const { stdout } = await execFileAsync(
    "git",
    [
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.hooksPath=${nullDevice}`,
      "-c",
      "maintenance.auto=false",
      "-c",
      "gc.auto=0",
      "-C",
      root,
      ...args,
    ],
    { env, maxBuffer: 1024 * 1024 },
  );
  return stdout;
}

export function discoveryGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "TMPDIR",
    "TEMP",
    "TMP",
  ]) {
    const match = Object.entries(process.env).find(
      ([candidate]) => candidate.toUpperCase() === key.toUpperCase(),
    );
    if (match?.[1] !== undefined) env[key] = match[1];
  }
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = nullDevice;
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  env.LC_ALL = "C";
  env.LANG = "C";
  return env;
}

export function discoveryFilesystemPath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return value;
  const msys = value.match(/^\/([A-Za-z])(?:\/(.*))?$/u);
  if (msys !== null) {
    return `${msys[1].toLowerCase()}:/${msys[2] ?? ""}`;
  }
  return value;
}

function discoveryComparablePath(
  value: string,
  platform: NodeJS.Platform,
): string {
  const normalized = value.replace(/\\/gu, "/");
  return platform === "win32" ||
    /^[A-Za-z]:\//u.test(normalized) ||
    /^\/\/[^/]+\/[^/]+/u.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function sameOrdinalStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function discoveryRegistrationSnapshot(
  registrations: readonly string[],
  platform: NodeJS.Platform,
): string[] {
  return ordinalSort(
    registrations.map((entry) => discoveryComparablePath(entry, platform)),
  );
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordinalSort(values: readonly string[]): string[] {
  return [...values].sort(ordinalCompare);
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

async function writeLease(): Promise<string> {
  const identity = await readIdentity(true);
  const previous = await readExistingLease(identity.leaseFile);
  assertExistingLeaseIdentity(previous, identity);
  const inputs = await readInputsForWrite(previous, identity.worktreePath);
  const archive = archivePathIfNeeded(previous, identity, inputs);
  const row = transitionId(previous, inputs);
  let reduced = reducePrReviewLease(previous, identity, inputs);

  if (previous !== null && inputs.state === "failed") {
    reduced = await clearInvalidFailureRecoveryArtifacts(
      reduced,
      previous,
      identity.primaryRoot,
      identity.worktreePath,
      recoveryPolicyForPreviousState(previous.state),
    );
  } else {
    validateLeaseShape(reduced);
    await validateReferencedArtifacts(reduced, identity.worktreePath, {
      validateResultAuthority: true,
      policy: policyForLifecycleWrite(row),
    });
    if (archive !== null && !hasPostCleanupArchiveAuthority(previous)) {
      if (previous === null) {
        throw new PrReviewLeaseError("archived lease missing");
      }
      validateLeaseShape(previous);
      await validateReferencedArtifacts(previous, identity.worktreePath, {
        validateResultAuthority: true,
        policy: "validate-stored-lease",
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
    await rename(target, path.join(identity.primaryRoot, archive));
  }
  await writeTextAtomically(target, content);
  return identity.leaseFile;
}

async function recordAuditFailure(): Promise<string> {
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

async function validateLeaseCommand(): Promise<void> {
  const identity = await readIdentity(true);
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
  });
}

async function readStatus(): Promise<string> {
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
  });

  return JSON.stringify({
    lease_state: lease.state,
    worktree_path: identity.worktreePath,
    worktree_digest: identity.worktreeDigest,
    worktree_exists: true,
    worktree_registered: true,
    worktree_dirty: await isWorktreeDirty(identity.worktreePath),
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
  assertClosedLeasePrimitiveShape(lease);
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
): Promise<PrReviewLease> {
  if (
    !(await isPlainDirectory(worktreePath)) ||
    !(await isRegisteredWorktree(primaryRoot, worktreePath))
  ) {
    const cleared = clearPreviewRenderRecoveryArtifacts(reduced);
    validateLeaseShape(cleared);
    return cleared;
  }
  return classifyRecoveryEvidence(reduced, previous, worktreePath, policy);
}

async function classifyRecoveryEvidence(
  reduced: PrReviewLease,
  previous: PrReviewLease,
  worktreePath: string,
  policy: EvidencePolicy,
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
  } = {},
): Promise<void> {
  const policy = options.policy ?? "validate-stored-lease";
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
    await validateResultCommandAuthority(lease, worktreePath);
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
    await validateResultCommandAuthority(lease, worktreePath);
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

function hasPostCleanupArchiveAuthority(
  previous: PrReviewLease | null,
): boolean {
  return (
    previous !== null &&
    (previous.state === "posted" || previous.state === "aborted") &&
    typeof previous.cleanup?.removed_at === "string"
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
  if (!TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new PrReviewLeaseError(
      `${label} must be a UTC RFC3339 timestamp ending in Z`,
    );
  }
  if (new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z") !== value) {
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
