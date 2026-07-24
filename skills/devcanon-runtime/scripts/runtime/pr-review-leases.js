import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, realpath, rename, } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
import { requireDirectEphemeralChild } from "./paths.js";
import { validateSharedContextFamilyBinding } from "./play-review-shared-context.js";
import { validatePrReviewHandoffEvidence, validatePrReviewResultCommandAuthority, validatePrReviewResultEvidence, } from "./pr-review-result-validation.js";
import { PR_REVIEW_GOVERNED_PATH_PATTERN, PR_REVIEW_MAX_NARROW_CHANGED_FILES, jsonEqual, validateCanonicalApprovedReviewArtifacts, } from "./review-artifacts.js";
const execFileAsync = promisify(execFile);
const SHA_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const DIRECT_SUFFIXES = {
    handoff: "-handoff.json",
    result: "-result.json",
    approved: "-approved-review.json",
    payload: "-validated-review-payload.json",
    lease: "-lease.json",
};
export async function runPrReviewLeasesCommand(args) {
    try {
        const [commandName] = args;
        switch (commandName) {
            case "derive-path":
                return ok(`${(await readIdentity(false)).leaseFile}\n`);
            case "write":
                return ok(`${await writeLease()}\n`);
            case "record-audit-failure":
                return ok(`${await recordAuditFailure()}\n`);
            case "validate":
                await validateLeaseCommand();
                return ok("");
            case "read-status":
                return ok(`${await readStatus()}\n`);
            case "discover":
                return ok(`${await discoverReviewLeases()}\n`);
            case "inspect-worktree":
                return ok(await inspectWorktree());
            case "cleanup-worktree":
                return ok(await cleanupWorktree());
            default:
                throw new PrReviewLeaseError("usage: review-leases.sh derive-path|write|record-audit-failure|validate|read-status|discover|inspect-worktree|cleanup-worktree");
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: `${message}\n` };
    }
}
export function reducePrReviewLease(previous, identity, inputs, options = {}) {
    const previousState = previous?.state ?? "none";
    const row = transitionId(previous, inputs);
    if (row === null) {
        throw invalidTransition(previousState, inputs.state);
    }
    if (inputs.expectedState !== undefined &&
        inputs.expectedState !== previous?.state) {
        throw new PrReviewLeaseError(`EXPECTED_STATE mismatch: ${previous?.state ?? "none"}`);
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
                    handoff_file: inputs.handoffFile ?? previous?.artifacts.handoff_file ?? null,
                    result_file: inputs.resultFile,
                },
                validation: validResultValidation(inputs.updatedAt, inputs.resultSha256),
            };
        case "LC-04":
        case "LC-14":
            return applyGated(base, previous, inputs);
        case "LC-05":
            if (inputs.resultFile === undefined &&
                inputs.presentedAt === undefined &&
                inputs.presentationStatus === undefined) {
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
                presentation: row === "LC-07"
                    ? (previous?.presentation ?? emptyPresentation())
                    : emptyPresentation(),
                terminal: {
                    finished_at: inputs.finishedAt,
                    reason: inputs.terminalReason,
                },
            };
        case "LC-08":
            requireInput("APPROVED_REVIEW_FILE", inputs.approvedReviewFile);
            requireInput("VALIDATED_REVIEW_PAYLOAD_FILE", inputs.validatedPayloadFile);
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
                throw new PrReviewLeaseError("invalid lease transition: failed -> posted requires github-post failure");
            }
            if (inputs.approvedReviewFile !== undefined &&
                inputs.approvedReviewFile !== previous.artifacts.approved_review_file) {
                throw new PrReviewLeaseError("APPROVED_REVIEW_FILE must match existing failed approved-review");
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
async function writeLease() {
    const identity = await readIdentity(true);
    const previous = await readExistingLease(identity.leaseFile);
    assertExistingLeaseIdentity(previous, identity);
    const inputs = await readInputsForWrite(previous, identity.physicalWorktreePath);
    const archive = archivePathIfNeeded(previous, identity, inputs);
    const row = transitionId(previous, inputs);
    let reduced = reducePrReviewLease(previous, identity, inputs);
    if (previous !== null && inputs.state === "failed") {
        reduced = await clearInvalidFailureRecoveryArtifacts(reduced, previous, identity.primaryRoot, identity.physicalWorktreePath, recoveryPolicyForPreviousState(previous.state));
    }
    else {
        validateLeaseShape(reduced);
        await validateReferencedArtifacts(reduced, identity.physicalWorktreePath, {
            validateResultAuthority: true,
            policy: policyForLifecycleWrite(row),
        });
        if (archive !== null && !hasPostCleanupArchiveAuthority(previous)) {
            if (previous === null) {
                throw new PrReviewLeaseError("archived lease missing");
            }
            validateLeaseShape(previous);
            await validateReferencedArtifacts(previous, identity.physicalWorktreePath, {
                validateResultAuthority: true,
                policy: "validate-stored-lease",
            });
        }
    }
    validateLeaseShape(reduced);
    await assertWritableDirectChild(identity.primaryRoot, identity.leaseFile, "lease");
    const target = path.join(identity.primaryRoot, identity.leaseFile);
    const content = `${JSON.stringify(reduced, null, 2)}\n`;
    if (archive !== null) {
        await assertWritableDirectChild(identity.primaryRoot, archive, "archived lease");
        await rename(target, path.join(identity.primaryRoot, archive));
    }
    await writeTextAtomically(target, content);
    return identity.leaseFile;
}
async function recordAuditFailure() {
    const { identity, previous } = await readAuditFailureIdentity();
    const inputs = readInputs();
    if (!isPostGatedPreviewRenderFailure(previous, inputs)) {
        throw new PrReviewLeaseError("record-audit-failure requires gated preview-render failure");
    }
    if (inputs.expectedState !== "gated") {
        throw new PrReviewLeaseError("EXPECTED_STATE must be gated");
    }
    let reduced = reducePrReviewLease(previous, identity, inputs, {
        allowMissingGatedPresentationTimestamp: true,
        allowMissingGatedPresentationStatus: true,
    });
    reduced = await clearInvalidFailureRecoveryArtifacts(reduced, previous, identity.primaryRoot, identity.physicalWorktreePath, "preserve-gated-recovery");
    validateLeaseShape(reduced);
    await assertWritableDirectChild(identity.primaryRoot, identity.leaseFile, "lease");
    await writeTextAtomically(path.join(identity.primaryRoot, identity.leaseFile), `${JSON.stringify(reduced, null, 2)}\n`);
    return identity.leaseFile;
}
async function validateLeaseCommand() {
    const identity = await readIdentity(true);
    const lease = await readRequiredJson(identity.primaryRoot, identity.leaseFile, "lease file");
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
    await validateReferencedArtifacts(lease, identity.physicalWorktreePath, {
        validateResultAuthority: true,
        policy: "validate-stored-lease",
    });
}
async function readStatus() {
    const identity = await readIdentity(true);
    await assertReadableWorktree(identity.physicalWorktreePath);
    const lease = await readRequiredJson(identity.primaryRoot, identity.leaseFile, "lease file");
    validateLeaseShape(lease);
    assertExistingLeaseIdentity(lease, identity);
    if (lease.state !== "gated") {
        throw new PrReviewLeaseError("read-status requires gated lease");
    }
    if (!(await isRegisteredWorktree(identity.primaryRoot, identity.physicalWorktreePath))) {
        throw new PrReviewLeaseError("worktree path is not registered for the primary repository");
    }
    const resultFile = requiredEnv("RESULT_FILE");
    validateDirectChild("result", resultFile, DIRECT_SUFFIXES.result);
    if (resultFile !== lease.artifacts.result_file) {
        throw new PrReviewLeaseError("RESULT_FILE must match gated lease result");
    }
    const headSha = requiredEnv("HEAD_SHA");
    if (!SHA_RE.test(headSha)) {
        throw new PrReviewLeaseError("HEAD_SHA must be a lowercase 40-character SHA");
    }
    const resultSha256 = await sha256DirectChild(identity.physicalWorktreePath, resultFile, "result file");
    const result = await readRequiredJson(identity.physicalWorktreePath, resultFile, "result file");
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
    await validateReferencedArtifacts(lease, identity.physicalWorktreePath, {
        validateResultAuthority: true,
        policy: "validate-live-gated-status",
    });
    return JSON.stringify({
        lease_state: lease.state,
        worktree_path: identity.worktreePath,
        worktree_digest: identity.worktreeDigest,
        worktree_exists: true,
        worktree_registered: true,
        worktree_dirty: await isWorktreeDirty(identity.physicalWorktreePath),
        identity_match: true,
        result_file: resultFile,
        result_sha256: resultSha256,
        result_validated_at: lease.validation.result_manifest.validated_at,
        lease_updated_at: lease.updated_at,
        presentation_status: lease.presentation.status,
        presented_at: lease.presentation.presented_at,
    });
}
async function discoverReviewLeases() {
    const identity = await readDiscoveryIdentity();
    const registrations = await listRegisteredWorktrees(identity.primaryRoot);
    const registrationSet = new Set(registrations.map(normalizeComparablePath));
    const canonicalInspection = await inspectDiscoveryWorktreeEntry(identity.canonicalWorktreePath, registrationSet, true);
    const inspectedCanonicalWorktree = canonicalInspection.worktree;
    const scanned = await scanDiscoveryLeaseFiles(identity, registrationSet);
    const activeLeases = scanned.active.sort((left, right) => left.lease_file.localeCompare(right.lease_file));
    const archivedLeases = scanned.archived.sort((left, right) => left.archived_lease_file.localeCompare(right.archived_lease_file));
    const invalidLeaseFiles = scanned.invalid.sort((left, right) => left.lease_file.localeCompare(right.lease_file));
    const resumable = activeLeases.filter((lease) => lease.status === "resumable");
    const canonicalResumableLease = resumable.find((lease) => lease.worktree_path === identity.canonicalWorktreePath &&
        lease.worktree.exists &&
        lease.worktree.registered &&
        !canonicalInspection.isSymbolicLink);
    const canonicalWorktree = canonicalResumableLease === undefined
        ? inspectedCanonicalWorktree
        : { ...inspectedCanonicalWorktree, status: "registered" };
    const canonicalTargetRequiresCleanup = (canonicalWorktree.exists || canonicalWorktree.registered) &&
        canonicalResumableLease === undefined;
    const invalid = invalidLeaseFiles.length > 0 ||
        activeLeases.some((lease) => lease.status === "invalid") ||
        archivedLeases.some((lease) => lease.status === "invalid");
    const cleanupLease = activeLeases.find((lease) => {
        if (lease.status === "cleanup-required")
            return true;
        if (lease.status !== "terminal")
            return false;
        // A helper-recorded removal is archive authority only after both the
        // recorded terminal worktree and the fresh canonical target are absent.
        // Retaining occupancy as cleanup-required prevents discovery from
        // masking a file, symlink, or unmanaged worktree at the canonical path.
        return !(scanned.postCleanupArchiveLeaseFiles.has(lease.lease_file) &&
            lease.worktree_path === identity.canonicalWorktreePath &&
            !lease.worktree.exists &&
            !lease.worktree.registered &&
            !canonicalWorktree.exists &&
            !canonicalWorktree.registered);
    });
    const disposition = invalid
        ? "invalid"
        : resumable.length > 1
            ? "ambiguous"
            : cleanupLease !== undefined || canonicalTargetRequiresCleanup
                ? "cleanup-required"
                : resumable.length === 1
                    ? "resume"
                    : "create";
    return JSON.stringify({
        schema: "pr-review/discovery/v1",
        repository: identity.repository,
        pr_number: identity.prNumber,
        primary_repository_root: identity.primaryRoot,
        canonical_worktree: canonicalWorktree,
        worktree_registrations: registrations,
        active_leases: activeLeases,
        archived_leases: archivedLeases,
        invalid_lease_files: invalidLeaseFiles,
        disposition,
        resume: disposition === "resume"
            ? {
                lease_file: resumable[0].lease_file,
                worktree_path: resumable[0].worktree_path,
            }
            : null,
        cleanup: disposition === "cleanup-required" && cleanupLease !== undefined
            ? {
                lease_file: cleanupLease.lease_file,
                worktree_path: cleanupLease.worktree_path,
                reason: cleanupLease.reason ?? "terminal-lease",
            }
            : null,
    });
}
async function readDiscoveryIdentity() {
    const repository = requiredEnv("REPOSITORY");
    if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
        throw new PrReviewLeaseError("REPOSITORY must be owner/name");
    }
    const prNumber = parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
    const primaryRoot = await realpath(requiredEnv("PRIMARY_REPOSITORY_ROOT"));
    if (canonicalLeaseIdentityPath(primaryRoot) !==
        canonicalLeaseIdentityPath(await realpath(process.cwd()))) {
        throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must match the primary repository root");
    }
    return {
        repository,
        prNumber,
        primaryRoot,
        canonicalWorktreePath: canonicalLeaseIdentityPath(path.join(primaryRoot, ".worktrees", `pr-${prNumber}-review`)),
    };
}
async function listRegisteredWorktrees(primaryRoot) {
    const { stdout } = await execFileAsync("git", [
        "--no-optional-locks",
        "-C",
        primaryRoot,
        "worktree",
        "list",
        "--porcelain",
        "-z",
    ], { maxBuffer: 1024 * 1024 });
    return stdout
        .split("\0")
        .filter((entry) => entry.startsWith("worktree "))
        .map((entry) => canonicalLeaseIdentityPath(entry.slice(9)))
        .sort((left, right) => left.localeCompare(right));
}
async function inspectDiscoveryWorktree(worktreePath, registrationSet, canonical) {
    return (await inspectDiscoveryWorktreeEntry(worktreePath, registrationSet, canonical)).worktree;
}
async function inspectDiscoveryWorktreeEntry(worktreePath, registrationSet, canonical) {
    let exists = false;
    let isSymbolicLink = false;
    try {
        const stat = await lstat(physicalPathForIo(worktreePath));
        // Any occupied canonical path blocks creation. In particular, a symlink or
        // regular file must never be treated as an absent review worktree.
        exists = true;
        isSymbolicLink = stat.isSymbolicLink();
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
    }
    const registered = registrationSet.has(canonicalLeaseIdentityPath(worktreePath));
    let dirty = null;
    if (exists && registered && !isSymbolicLink) {
        try {
            dirty = await isWorktreeDirty(physicalPathForIo(worktreePath));
        }
        catch {
            dirty = null;
        }
    }
    return {
        worktree: {
            path: worktreePath,
            exists,
            registered,
            dirty,
            status: !exists
                ? "absent"
                : canonical
                    ? "unleased-canonical"
                    : registered
                        ? "registered"
                        : "unregistered",
        },
        isSymbolicLink,
    };
}
async function scanDiscoveryLeaseFiles(identity, registrationSet) {
    const empty = {
        active: [],
        archived: [],
        invalid: [],
        postCleanupArchiveLeaseFiles: new Set(),
    };
    const ephemeral = path.join(identity.primaryRoot, ".ephemeral");
    let entries;
    try {
        const stat = await lstat(ephemeral);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            empty.invalid.push({
                lease_file: ".ephemeral",
                reason: "ephemeral-directory-invalid",
            });
            return empty;
        }
        entries = await readdir(ephemeral, { withFileTypes: true });
    }
    catch (err) {
        if (err.code === "ENOENT")
            return empty;
        throw err;
    }
    const prefix = `pr-${identity.prNumber}-`;
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const leaseFile = `.ephemeral/${entry.name}`;
        if (!entry.name.startsWith(prefix))
            continue;
        if (entry.name.endsWith("-archived-lease.json")) {
            empty.archived.push(await inspectArchivedDiscoveryLease(identity, leaseFile));
            continue;
        }
        if (!entry.name.endsWith("-lease.json"))
            continue;
        const activeName = new RegExp(`^pr-${identity.prNumber}-([0-9a-f]{64})-lease\\.json$`, "u");
        const match = activeName.exec(entry.name);
        if (match === null) {
            empty.invalid.push({
                lease_file: leaseFile,
                reason: "malformed-lease-path",
            });
            continue;
        }
        const inspected = await inspectActiveDiscoveryLease(identity, leaseFile, match[1], registrationSet);
        empty.active.push(inspected.lease);
        if (inspected.postCleanupArchiveAuthorized) {
            empty.postCleanupArchiveLeaseFiles.add(leaseFile);
        }
    }
    return empty;
}
async function inspectActiveDiscoveryLease(identity, leaseFile, filenameDigest, registrationSet) {
    const invalid = (reason) => ({
        lease: {
            lease_file: leaseFile,
            worktree_path: null,
            worktree_digest: null,
            state: null,
            status: "invalid",
            reason,
            worktree: {
                exists: false,
                registered: false,
                dirty: null,
                unmanaged_ephemeral_artifacts: [],
            },
        },
        postCleanupArchiveAuthorized: false,
    });
    let lease;
    try {
        const stat = await lstat(path.join(identity.primaryRoot, leaseFile));
        if (stat.isSymbolicLink())
            return invalid("lease-file-symlink");
        if (!stat.isFile())
            return invalid("lease-file-not-regular");
        lease = JSON.parse(await readFile(path.join(identity.primaryRoot, leaseFile), "utf8"));
        validateLeaseShape(lease);
        if (lease.repository !== identity.repository ||
            lease.pr_number !== identity.prNumber ||
            lease.lease_file !== leaseFile ||
            !isAbsoluteLeaseIdentityPath(lease.worktree_path) ||
            lease.worktree_path ===
                canonicalLeaseIdentityPath(identity.primaryRoot) ||
            lease.worktree_digest !== filenameDigest ||
            lease.worktree_digest !== digestPath(lease.worktree_path)) {
            return invalid("lease-identity-mismatch");
        }
    }
    catch {
        return invalid("invalid-lease");
    }
    const inspection = await inspectDiscoveryWorktreeEntry(lease.worktree_path, registrationSet, false);
    const observed = inspection.worktree;
    let unmanaged = [];
    if (observed.exists && observed.registered && !inspection.isSymbolicLink) {
        try {
            unmanaged = await findUnmanagedEphemeralArtifacts(lease, physicalPathForIo(lease.worktree_path), { discovery: true });
        }
        catch {
            return {
                lease: {
                    ...invalid("invalid-lease").lease,
                    worktree_path: lease.worktree_path,
                    worktree_digest: lease.worktree_digest,
                    state: lease.state,
                    worktree: {
                        exists: observed.exists,
                        registered: observed.registered,
                        dirty: observed.dirty,
                        unmanaged_ephemeral_artifacts: [],
                    },
                },
                postCleanupArchiveAuthorized: false,
            };
        }
    }
    const terminal = lease.state === "posted" || lease.state === "aborted";
    const reason = !observed.exists
        ? "missing-worktree"
        : inspection.isSymbolicLink
            ? "symlink-worktree"
            : !observed.registered
                ? "unregistered-worktree"
                : observed.dirty === null
                    ? "status-inspection-failed"
                    : observed.dirty === true
                        ? "dirty"
                        : unmanaged.length > 0
                            ? "unmanaged-ephemeral-artifacts"
                            : terminal
                                ? "terminal-lease"
                                : null;
    return {
        lease: {
            lease_file: leaseFile,
            worktree_path: lease.worktree_path,
            worktree_digest: lease.worktree_digest,
            state: lease.state,
            status: terminal
                ? "terminal"
                : reason === null
                    ? "resumable"
                    : "cleanup-required",
            reason,
            worktree: {
                exists: observed.exists,
                registered: observed.registered,
                dirty: observed.dirty,
                unmanaged_ephemeral_artifacts: unmanaged,
            },
        },
        postCleanupArchiveAuthorized: terminal && hasPostCleanupArchiveAuthority(lease),
    };
}
async function inspectArchivedDiscoveryLease(identity, archivedLeaseFile) {
    const invalid = (reason) => ({
        archived_lease_file: archivedLeaseFile,
        state: null,
        status: "invalid",
        reason,
    });
    try {
        const filename = path.basename(archivedLeaseFile);
        const filenameMatch = new RegExp(`^pr-${identity.prNumber}-([0-9a-f]{64})-(\\d{8}T\\d{6})-(posted|aborted)-archived-lease\\.json$`, "u").exec(filename);
        if (filenameMatch === null)
            return invalid("malformed-archived-lease-path");
        const stat = await lstat(path.join(identity.primaryRoot, archivedLeaseFile));
        if (stat.isSymbolicLink())
            return invalid("lease-file-symlink");
        if (!stat.isFile())
            return invalid("lease-file-not-regular");
        const lease = JSON.parse(await readFile(path.join(identity.primaryRoot, archivedLeaseFile), "utf8"));
        validateLeaseShape(lease);
        const expectedLeaseFile = `.ephemeral/pr-${identity.prNumber}-${lease.worktree_digest}-lease.json`;
        if (lease.repository !== identity.repository ||
            lease.pr_number !== identity.prNumber ||
            lease.lease_file !== expectedLeaseFile ||
            !isAbsoluteLeaseIdentityPath(lease.worktree_path) ||
            lease.worktree_digest !== digestPath(lease.worktree_path) ||
            lease.worktree_digest !== filenameMatch[1] ||
            lease.state !== filenameMatch[3] ||
            (lease.terminal.finished_at ?? lease.updated_at).replace(/[-:Z]/gu, "") !== filenameMatch[2] ||
            (lease.state !== "posted" && lease.state !== "aborted")) {
            return invalid("lease-identity-mismatch");
        }
        return {
            archived_lease_file: archivedLeaseFile,
            state: lease.state,
            status: "valid",
            reason: null,
        };
    }
    catch {
        return invalid("invalid-lease");
    }
}
async function inspectWorktree() {
    const identity = await readCleanupIdentity();
    const decision = await classifyCleanup(identity);
    if (shouldRecordCleanupMetadata(decision)) {
        await recordCleanupMetadata(identity, decision.leaseState, "", shouldValidateCleanupMetadataArtifacts(decision));
    }
    return cleanupOutput("inspect", decision);
}
async function cleanupWorktree() {
    const identity = await readCleanupIdentity();
    const decision = await classifyCleanup(identity);
    if (!decision.canRemove) {
        const outcome = decision.metadataOutcome === "skipped" ? "skipped" : "retained";
        if (shouldRecordCleanupMetadata(decision)) {
            await recordCleanupMetadata(identity, decision.leaseState, outcome, shouldValidateCleanupMetadataArtifacts(decision));
            decision.metadataOutcome = outcome;
        }
        return cleanupOutput(outcome, decision);
    }
    const args = ["-C", identity.primaryRoot, "worktree", "remove"];
    if (decision.forceRemoveAllowed) {
        args.push("-f");
    }
    args.push(identity.physicalWorktreePath);
    try {
        await execFileAsync("git", args);
    }
    catch {
        if (shouldRecordCleanupMetadata(decision)) {
            await recordCleanupMetadata(identity, decision.leaseState, "failed", false);
        }
        return cleanupOutput("failed", {
            ...decision,
            metadataOutcome: "failed",
            message: "git worktree remove failed",
        });
    }
    if (shouldRecordCleanupMetadata(decision)) {
        await recordCleanupMetadata(identity, decision.leaseState, "removed", false);
        decision.metadataOutcome = "removed";
    }
    return cleanupOutput("removed", {
        ...decision,
        metadataOutcome: "removed",
        message: "worktree removed",
    });
}
function shouldRecordCleanupMetadata(decision) {
    return (decision.identityMatch &&
        decision.leaseState !== "" &&
        decision.refusalReason !== "invalid-lease");
}
function shouldValidateCleanupMetadataArtifacts(decision) {
    return (decision.refusalReason !== "missing-worktree" &&
        decision.refusalReason !== "not-registered-worktree");
}
async function classifyCleanup(identity) {
    const base = {
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
    let lease;
    try {
        lease = await readRequiredJson(identity.primaryRoot, identity.leaseFile, "lease file");
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
        if (!(await isRegisteredWorktree(identity.primaryRoot, identity.physicalWorktreePath))) {
            return {
                ...base,
                refusalReason: "not-registered-worktree",
                metadataOutcome: "skipped",
                message: "worktree path is not registered for the primary repository",
            };
        }
        await validateReferencedArtifacts(lease, identity.physicalWorktreePath, {
            validateResultAuthority: true,
            policy: "validate-stored-lease",
        });
        const unmanagedArtifacts = await findUnmanagedEphemeralArtifacts(lease, identity.physicalWorktreePath);
        if (unmanagedArtifacts.length > 0) {
            return {
                ...base,
                refusalReason: "unmanaged-ephemeral-artifacts",
                message: `unmanaged .ephemeral artifacts: ${unmanagedArtifacts.join(", ")}`,
            };
        }
    }
    catch {
        return {
            ...base,
            refusalReason: "invalid-lease",
            message: "lease is invalid; preserving worktree",
        };
    }
    try {
        base.dirty = await isWorktreeDirty(identity.physicalWorktreePath);
    }
    catch {
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
async function isWorktreeDirty(worktreePath) {
    try {
        const { stdout } = await execFileAsync("git", ["--no-optional-locks", "-C", worktreePath, "status", "--porcelain"], { maxBuffer: 1024 * 1024 });
        return stdout.length > 0;
    }
    catch {
        throw new PrReviewLeaseError("git status inspection failed for worktree");
    }
}
async function recordCleanupMetadata(identity, state, outcome, validateArtifacts) {
    const lease = await readRequiredJson(identity.primaryRoot, identity.leaseFile, "lease file");
    assertExistingLeaseIdentity(lease, identity);
    if (state !== lease.state) {
        throw new PrReviewLeaseError("lease state changed during cleanup metadata write");
    }
    const observedAt = nowTimestamp();
    const next = {
        ...lease,
        cleanup: {
            last_outcome: outcome === "" ? (lease.cleanup?.last_outcome ?? null) : outcome,
            last_checked_at: observedAt,
            removed_at: outcome === "removed"
                ? observedAt
                : (lease.cleanup?.removed_at ?? null),
        },
    };
    validateLeaseShape(next);
    if (validateArtifacts) {
        await validateReferencedArtifacts(next, identity.physicalWorktreePath, {
            validateResultAuthority: true,
            policy: "validate-cleanup-metadata",
        });
    }
    await writeTextAtomically(path.join(identity.primaryRoot, identity.leaseFile), `${JSON.stringify(next, null, 2)}\n`);
}
function cleanupOutput(outcome, decision) {
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
async function readIdentity(requireLeaseFile) {
    const repository = requiredEnv("REPOSITORY");
    if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
        throw new PrReviewLeaseError("REPOSITORY must be owner/name");
    }
    const prNumber = parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
    const primaryRoot = await realpath(requiredEnv("PRIMARY_REPOSITORY_ROOT"));
    const cwd = await realpath(process.cwd());
    if (canonicalLeaseIdentityPath(primaryRoot) !== canonicalLeaseIdentityPath(cwd)) {
        throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must match the primary repository root");
    }
    const physicalWorktreePath = await resolveWorktreePathForIdentity(requiredEnv("WORKTREE_PATH"), requireLeaseFile);
    const worktreePath = canonicalLeaseIdentityPath(physicalWorktreePath);
    if (canonicalLeaseIdentityPath(physicalWorktreePath) ===
        canonicalLeaseIdentityPath(primaryRoot)) {
        throw new PrReviewLeaseError("WORKTREE_PATH must be a review worktree, not the primary repository root");
    }
    const worktreeDigest = digestLeaseIdentityPath(worktreePath);
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
        physicalWorktreePath,
        worktreeDigest,
        leaseFile,
    };
}
async function resolveWorktreePathForIdentity(worktreePath, requirePhysicalTarget) {
    if (!isAbsoluteLeaseIdentityPath(worktreePath)) {
        throw new PrReviewLeaseError("WORKTREE_PATH must be absolute");
    }
    if (requirePhysicalTarget) {
        return await realpath(worktreePath);
    }
    try {
        return await realpath(worktreePath);
    }
    catch (err) {
        const code = err.code;
        if (code !== "ENOENT" && code !== "ENOTDIR") {
            throw err;
        }
        return path.resolve(worktreePath);
    }
}
async function readAuditFailureIdentity() {
    const repository = requiredEnv("REPOSITORY");
    if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
        throw new PrReviewLeaseError("REPOSITORY must be owner/name");
    }
    const prNumber = parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
    const primaryRoot = await realpath(requiredEnv("PRIMARY_REPOSITORY_ROOT"));
    const cwd = await realpath(process.cwd());
    if (canonicalLeaseIdentityPath(primaryRoot) !== canonicalLeaseIdentityPath(cwd)) {
        throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must match the primary repository root");
    }
    const leaseFile = requiredEnv("LEASE_FILE");
    validateDirectChild("lease", leaseFile, DIRECT_SUFFIXES.lease);
    const previous = await readRequiredJson(primaryRoot, leaseFile, "lease file");
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
    if (previous.worktree_digest !== digestLeaseIdentityPath(previous.worktree_path)) {
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
            physicalWorktreePath: physicalPathForIo(previous.worktree_path),
            worktreeDigest: previous.worktree_digest,
            leaseFile,
        },
        previous,
    };
}
async function readCleanupIdentity() {
    const repository = requiredEnv("REPOSITORY");
    if (!/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
        throw new PrReviewLeaseError("REPOSITORY must be owner/name");
    }
    const prNumber = parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
    const primaryRoot = await realpath(requiredEnv("PRIMARY_REPOSITORY_ROOT"));
    const cwd = await realpath(process.cwd());
    if (canonicalLeaseIdentityPath(primaryRoot) !== canonicalLeaseIdentityPath(cwd)) {
        throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must match the primary repository root");
    }
    const resolvedWorktree = await resolveWorktreePathForCleanup(requiredEnv("WORKTREE_PATH"));
    const worktreePath = canonicalLeaseIdentityPath(resolvedWorktree.path);
    if (worktreePath === canonicalLeaseIdentityPath(primaryRoot)) {
        throw new PrReviewLeaseError("WORKTREE_PATH must be a review worktree, not the primary repository root");
    }
    const worktreeDigest = digestLeaseIdentityPath(worktreePath);
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
        worktreePath,
        physicalWorktreePath: resolvedWorktree.path,
        worktreeDigest,
        leaseFile,
        worktreeExists: resolvedWorktree.exists,
    };
}
async function resolveWorktreePathForCleanup(worktreePath) {
    try {
        return { path: await realpath(worktreePath), exists: true };
    }
    catch (err) {
        const code = err.code;
        if (code !== "ENOENT" && code !== "ENOTDIR") {
            throw err;
        }
        return { path: path.resolve(worktreePath), exists: false };
    }
}
async function isRegisteredWorktree(primaryRoot, worktreePath) {
    try {
        const { stdout } = await execFileAsync("git", ["-C", primaryRoot, "worktree", "list", "--porcelain", "-z"], { maxBuffer: 1024 * 1024 });
        const expected = normalizeComparablePath(worktreePath);
        return stdout
            .split("\0")
            .filter((entry) => entry.startsWith("worktree "))
            .some((entry) => normalizeComparablePath(entry.slice(9)) === expected);
    }
    catch {
        return false;
    }
}
function readInputs() {
    return {
        state: parseState(requiredEnv("STATE")),
        baseRef: requiredEnv("BASE_REF"),
        headRef: requiredEnv("HEAD_REF"),
        createdAt: process.env.CREATED_AT ?? process.env.UPDATED_AT ?? "",
        updatedAt: requiredEnv("UPDATED_AT"),
        handoffFile: optionalEnv("HANDOFF_FILE"),
        resultFile: optionalEnv("RESULT_FILE"),
        approvedReviewFile: optionalEnv("APPROVED_REVIEW_FILE"),
        validatedPayloadFile: optionalEnv("VALIDATED_REVIEW_PAYLOAD_FILE") ??
            optionalEnv("VALIDATED_PAYLOAD_FILE"),
        presentedAt: optionalEnv("PRESENTED_AT"),
        presentationStatus: parseOptionalPresentation(optionalEnv("PRESENTATION_STATUS")),
        finishedAt: optionalEnv("FINISHED_AT"),
        terminalReason: optionalEnv("TERMINAL_REASON"),
        failurePhase: parseOptionalFailurePhase(optionalEnv("FAILURE_PHASE")),
        failureReason: optionalEnv("FAILURE_REASON"),
        failureRecoverability: parseOptionalRecoverability(optionalEnv("FAILURE_RECOVERABILITY")),
        githubPostAttempted: parseOptionalBoolean(optionalEnv("GITHUB_POST_ATTEMPTED")),
        githubPostResult: parseOptionalGitHubResult(optionalEnv("GITHUB_POST_RESULT")),
        githubPostedAt: optionalEnv("GITHUB_POSTED_AT"),
        expectedState: parseOptionalState(optionalEnv("EXPECTED_STATE")),
    };
}
async function readInputsForWrite(previous, worktreePath) {
    const inputs = readInputs();
    const resultFile = resultFileForLifecycleValidation(previous, inputs);
    if (resultFile !== null) {
        validateDirectChild("result", resultFile, DIRECT_SUFFIXES.result);
        inputs.resultSha256 = await sha256DirectChild(worktreePath, resultFile, "result file");
    }
    return inputs;
}
function resultFileForLifecycleValidation(previous, inputs) {
    if (inputs.state === "reviewed" || inputs.state === "gated") {
        return inputs.resultFile ?? previous?.artifacts.result_file ?? null;
    }
    return null;
}
function buildBaseLease(previous, identity, inputs, row) {
    const createdAt = row === "LC-01" || row === "LC-18"
        ? inputs.createdAt
        : (previous?.created_at ?? inputs.createdAt);
    return {
        schema: "pr-review/lease/v1",
        repository: identity.repository,
        pr_number: identity.prNumber,
        state: inputs.state,
        base_ref: row === "LC-01" || row === "LC-18"
            ? inputs.baseRef
            : (previous?.base_ref ?? inputs.baseRef),
        head_ref: row === "LC-01" || row === "LC-18"
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
function applyGated(base, previous, inputs) {
    const resultFile = inputs.resultFile ?? previous?.artifacts.result_file ?? null;
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
function applyFailure(row, base, previous, inputs, options = {}) {
    requireInput("FINISHED_AT", inputs.finishedAt);
    requireInput("FAILURE_PHASE", inputs.failurePhase);
    requireInput("FAILURE_REASON", inputs.failureReason);
    requireInput("FAILURE_RECOVERABILITY", inputs.failureRecoverability);
    if (inputs.failurePhase === "github-post") {
        if (row !== "LC-13" && row !== "LC-16") {
            throw new PrReviewLeaseError("github-post failure requires gated lease");
        }
        if (inputs.githubPostAttempted !== true) {
            throw new PrReviewLeaseError("GITHUB_POST_ATTEMPTED must be true for github-post failure");
        }
        if (inputs.githubPostResult !== "failed") {
            throw new PrReviewLeaseError("GITHUB_POST_RESULT must be failed for github-post failure");
        }
    }
    if (inputs.failurePhase === "preview-render" && previous?.state === "gated") {
        validatePostGatedPreviewRenderFailure(previous, {
            allowMissingPresentationTimestamp: options.allowMissingGatedPresentationTimestamp === true,
            allowMissingPresentationStatus: options.allowMissingGatedPresentationStatus === true,
        });
    }
    const resultFile = failureResultFile(row, previous, inputs);
    const approvedReviewFile = inputs.failurePhase === "approval-freeze" ||
        inputs.failurePhase === "github-post"
        ? (inputs.approvedReviewFile ??
            previous?.artifacts.approved_review_file ??
            null)
        : null;
    if (inputs.failurePhase === "github-post" && approvedReviewFile === null) {
        throw new PrReviewLeaseError("APPROVED_REVIEW_FILE is required for github-post failure");
    }
    return {
        ...base,
        state: "failed",
        artifacts: {
            handoff_file: previous?.artifacts.handoff_file ?? null,
            result_file: resultFile,
            approved_review_file: approvedReviewFile,
            validated_payload_file: approvedReviewFile === null
                ? null
                : (inputs.validatedPayloadFile ??
                    previous?.artifacts.validated_payload_file ??
                    null),
        },
        validation: previous?.validation ?? emptyValidation(),
        presentation: row === "LC-11" || row === "LC-12" || row === "LC-13" || row === "LC-16"
            ? (previous?.presentation ?? emptyPresentation())
            : emptyPresentation(),
        terminal: { finished_at: inputs.finishedAt, reason: null },
        failure: {
            phase: inputs.failurePhase,
            reason: inputs.failureReason,
            recoverability: inputs.failureRecoverability,
        },
        github: inputs.failurePhase === "github-post"
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
function failureResultFile(row, previous, inputs) {
    if (row === "LC-09") {
        return null;
    }
    if (row === "LC-16") {
        const current = previous?.artifacts.result_file ?? null;
        if (inputs.resultFile !== undefined && inputs.resultFile !== current) {
            throw new PrReviewLeaseError("RESULT_FILE must match existing failed result");
        }
        return current;
    }
    const current = previous?.artifacts.result_file ?? null;
    if (current === null) {
        throw new PrReviewLeaseError("failed transition requires existing result pointer");
    }
    if (inputs.resultFile !== undefined && inputs.resultFile !== current) {
        throw new PrReviewLeaseError(`RESULT_FILE must match existing ${previous?.state} result`);
    }
    return current;
}
function isPostGatedPreviewRenderFailure(previous, inputs) {
    return (previous?.state === "gated" &&
        inputs.state === "failed" &&
        inputs.failurePhase === "preview-render");
}
function validatePostGatedPreviewRenderFailure(previous, options = {}) {
    if (previous.state !== "gated") {
        throw new PrReviewLeaseError("preview-render failure requires gated lease");
    }
    if (previous.artifacts.result_file === null) {
        throw new PrReviewLeaseError("preview-render failure requires prior result pointer");
    }
    if ((previous.presentation.status === null &&
        options.allowMissingPresentationStatus !== true) ||
        (previous.presentation.presented_at === null &&
            options.allowMissingPresentationTimestamp !== true)) {
        throw new PrReviewLeaseError("preview-render failure requires prior presentation evidence");
    }
}
function transitionId(previous, inputs) {
    const previousState = previous?.state ?? "none";
    if (previousState === "none" && inputs.state === "created")
        return "LC-01";
    if ((previousState === "posted" || previousState === "aborted") &&
        inputs.state === "created") {
        return "LC-18";
    }
    if (previousState === "created" && inputs.state === "created")
        return "LC-02";
    if (previousState === "created" && inputs.state === "reviewed")
        return "LC-03";
    if (previousState === "reviewed" && inputs.state === "gated")
        return "LC-04";
    if (previousState === "gated" && inputs.state === "gated")
        return "LC-05";
    if (previousState === "reviewed" && inputs.state === "aborted")
        return "LC-06";
    if (previousState === "gated" && inputs.state === "aborted")
        return "LC-07";
    if (previousState === "gated" && inputs.state === "posted")
        return "LC-08";
    if (previousState === "created" && inputs.state === "failed")
        return "LC-09";
    if (previousState === "reviewed" && inputs.state === "failed")
        return "LC-10";
    if (previousState === "gated" && inputs.state === "failed") {
        if (inputs.failurePhase === "approval-freeze")
            return "LC-12";
        if (inputs.failurePhase === "github-post")
            return "LC-13";
        return "LC-11";
    }
    if (previousState === "failed" && inputs.state === "gated")
        return "LC-14";
    if (previousState === "failed" && inputs.state === "aborted")
        return "LC-15";
    if (previousState === "failed" && inputs.state === "failed")
        return "LC-16";
    if (previousState === "failed" && inputs.state === "posted")
        return "LC-17";
    return null;
}
function archivePathIfNeeded(previous, identity, inputs) {
    if (inputs.state !== "created" ||
        (previous?.state !== "posted" && previous?.state !== "aborted")) {
        return null;
    }
    // LC-18 authority is meaningful only for a fully valid stored terminal
    // lease. Validate its complete closed shape before consulting cleanup data.
    validateLeaseShape(previous);
    if (!hasPostCleanupArchiveAuthority(previous)) {
        throw new PrReviewLeaseError("LC-18 requires recorded post-cleanup archive authority");
    }
    const stamp = (previous.terminal.finished_at ?? previous.updated_at).replace(/[-:Z]/gu, "");
    return `.ephemeral/pr-${identity.prNumber}-${identity.worktreeDigest}-${stamp}-${previous.state}-archived-lease.json`;
}
function policyForLifecycleWrite(row) {
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
function recoveryPolicyForPreviousState(state) {
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
function preservesGatePresentation(policy, lease) {
    return (policy === "preserve-gated-recovery" ||
        (policy === "preserve-failed-recovery" &&
            lease.presentation.presented_at !== null &&
            lease.presentation.status !== null));
}
function validateLeaseShape(lease, options = {}) {
    assertLeaseObjectShape(lease);
    if (lease.schema !== "pr-review/lease/v1") {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (!isCanonicalLeaseIdentityPath(lease.worktree_path)) {
        throw new PrReviewLeaseError("lease worktree path is not canonical");
    }
    if (lease.worktree_digest !== digestLeaseIdentityPath(lease.worktree_path)) {
        throw new PrReviewLeaseError("lease worktree digest mismatch");
    }
    if (lease.lease_file !==
        `.ephemeral/pr-${lease.pr_number}-${lease.worktree_digest}-lease.json`) {
        throw new PrReviewLeaseError("lease file identity mismatch");
    }
    validateKnownLeaseState(lease.state);
    validateTimestamp("created_at", lease.created_at);
    validateTimestamp("updated_at", lease.updated_at);
    if (lease.presentation.presented_at !== null) {
        validateTimestamp("presentation.presented_at", lease.presentation.presented_at);
    }
    if (lease.terminal.finished_at !== null) {
        validateTimestamp("terminal.finished_at", lease.terminal.finished_at);
    }
    if (lease.github.github_posted_at !== null) {
        validateTimestamp("github.github_posted_at", lease.github.github_posted_at);
    }
    if (lease.validation.result_manifest.validated_at !== null) {
        validateTimestamp("validation.result_manifest.validated_at", lease.validation.result_manifest.validated_at);
    }
    validateCleanupMetadata(lease.cleanup);
    if (lease.validation.result_manifest.sha256 !== null &&
        !SHA256_RE.test(lease.validation.result_manifest.sha256)) {
        throw new PrReviewLeaseError("validation.result_manifest.sha256 must be a lowercase 64-character sha256 or null");
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
    ]) {
        if (value !== null)
            validateDirectChild(label, value, suffix);
    }
    validateStateInvariants(lease, options);
}
function validateStateInvariants(lease, options = {}) {
    if (lease.state === "created" && lease.artifacts.result_file !== null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if ((lease.state === "reviewed" ||
        lease.state === "gated" ||
        lease.state === "posted") &&
        lease.artifacts.result_file === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.artifacts.result_file === null) {
        if (lease.validation.result_manifest.status !== null ||
            lease.validation.result_manifest.validated_at !== null ||
            lease.validation.result_manifest.sha256 !== null) {
            throw new PrReviewLeaseError("lease schema mismatch");
        }
    }
    else if (lease.validation.result_manifest.status !== "valid" ||
        lease.validation.result_manifest.validated_at === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    else if (lease.validation.result_manifest.sha256 === null &&
        !(options.allowMissingGatedRecoveryDigest && lease.state === "gated")) {
        throw new PrReviewLeaseError("result manifest digest missing");
    }
    if (lease.state === "gated" &&
        lease.presentation.presented_at === null &&
        !options.allowMissingGatedPresentationTimestamp) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if ((lease.state === "posted" ||
        lease.state === "aborted" ||
        lease.state === "failed") &&
        lease.terminal.finished_at === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if ((lease.state === "created" ||
        lease.state === "reviewed" ||
        lease.state === "gated") &&
        lease.terminal.finished_at !== null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if ((lease.state === "aborted" &&
        (lease.terminal.reason === null || lease.terminal.reason.length === 0)) ||
        (lease.state !== "aborted" && lease.terminal.reason !== null)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.state === "posted" &&
        (lease.artifacts.approved_review_file === null ||
            lease.artifacts.validated_payload_file === null)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.state === "failed" && lease.failure.phase === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    validateFailureAndGitHubTuple(lease);
}
function validateFailureAndGitHubTuple(lease) {
    const noFailure = lease.failure.phase === null &&
        lease.failure.reason === null &&
        lease.failure.recoverability === null;
    const noGitHubPost = lease.github.github_post_attempted === false &&
        lease.github.github_post_result === "not-attempted" &&
        lease.github.github_posted_at === null;
    if (lease.state === "failed") {
        if (lease.failure.phase === null ||
            lease.failure.reason === null ||
            lease.failure.reason.length === 0 ||
            lease.failure.recoverability === null) {
            throw new PrReviewLeaseError("lease schema mismatch");
        }
        if (lease.failure.phase === "github-post") {
            if (lease.github.github_post_attempted !== true ||
                lease.github.github_post_result !== "failed" ||
                lease.github.github_posted_at !== null) {
                throw new PrReviewLeaseError("lease schema mismatch");
            }
            return;
        }
        if (!noGitHubPost) {
            throw new PrReviewLeaseError("lease schema mismatch");
        }
        return;
    }
    if (!noFailure) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.state === "posted") {
        if (lease.github.github_post_attempted !== true ||
            lease.github.github_post_result !== "succeeded" ||
            lease.github.github_posted_at === null) {
            throw new PrReviewLeaseError("lease schema mismatch");
        }
        return;
    }
    if (!noGitHubPost) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
}
function clearPreviewRenderRecoveryArtifacts(lease) {
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
async function clearInvalidFailureRecoveryArtifacts(reduced, previous, primaryRoot, worktreePath, policy) {
    if (!(await isPlainDirectory(worktreePath)) ||
        !(await isRegisteredWorktree(primaryRoot, worktreePath))) {
        const cleared = clearPreviewRenderRecoveryArtifacts(reduced);
        validateLeaseShape(cleared);
        return cleared;
    }
    return classifyRecoveryEvidence(reduced, previous, worktreePath, policy);
}
async function classifyRecoveryEvidence(reduced, previous, worktreePath, policy) {
    const freshnessTimestamp = policy === "preserve-gated-recovery" ? previous.updated_at : undefined;
    let sanitized = clearPreviewRenderRecoveryArtifacts(reduced);
    if (reduced.artifacts.handoff_file !== null) {
        const handoffCandidate = {
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
        }
        catch {
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
    const resultCandidate = {
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
    }
    catch {
        validateLeaseShape(sanitized);
        return sanitized;
    }
    if (reduced.artifacts.approved_review_file === null) {
        validateLeaseShape(sanitized);
        return sanitized;
    }
    const approvalCandidate = {
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
    }
    catch {
        validateLeaseShape(sanitized);
        return sanitized;
    }
    if (reduced.artifacts.validated_payload_file === null) {
        validateLeaseShape(sanitized);
        return sanitized;
    }
    const payloadCandidate = {
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
    }
    catch {
        validateLeaseShape(sanitized);
        return sanitized;
    }
    validateLeaseShape(sanitized);
    return sanitized;
}
function reviewHeadShaFromResultFile(resultFile) {
    const match = /^\.ephemeral\/pr-[0-9]+-([0-9a-f]{40})-result\.json$/u.exec(resultFile);
    if (match === null) {
        throw new PrReviewLeaseError("result path mismatch");
    }
    return match[1];
}
function reviewHeadShaFromHandoffFile(handoffFile) {
    const match = /^\.ephemeral\/pr-[0-9]+-([0-9a-f]{40})-handoff\.json$/u.exec(handoffFile);
    if (match === null) {
        throw new PrReviewLeaseError("handoff path mismatch");
    }
    return match[1];
}
function inheritedHelperEnv() {
    const inherited = {};
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
async function isPlainDirectory(value) {
    try {
        const stat = await lstat(value);
        return stat.isDirectory() && !stat.isSymbolicLink();
    }
    catch {
        return false;
    }
}
async function validateReferencedArtifacts(lease, worktreePath, options = {}) {
    const policy = options.policy ?? "validate-stored-lease";
    let resultReviewHead = null;
    let resultArtifact = null;
    if (lease.artifacts.handoff_file !== null) {
        const handoff = await readRequiredJson(worktreePath, lease.artifacts.handoff_file, "handoff file");
        validateHandoffIdentity(handoff, lease, worktreePath);
    }
    if (lease.artifacts.result_file !== null) {
        await validateResultDigest(lease, worktreePath, lease.artifacts.result_file);
        const result = await readRequiredJson(worktreePath, lease.artifacts.result_file, "result file");
        validateResultIdentity(result, lease);
        validateResultFreshness(lease, policy, options.freshnessTimestamp);
        validateResultPresentation(result, lease, policy);
        resultReviewHead = stringField(result, "review_head_sha");
        resultArtifact = result;
    }
    if (lease.artifacts.approved_review_file !== null) {
        const approved = await readRequiredJson(worktreePath, lease.artifacts.approved_review_file, "approved review file");
        const approvedReviewHead = validateApprovedIdentity(approved, lease, resultReviewHead);
        if (resultArtifact === null) {
            throw new PrReviewLeaseError("approved review result binding missing");
        }
        if (lease.artifacts.validated_payload_file !== null) {
            const expectedPayloadFile = expectedValidatedPayloadPath(lease.pr_number, approvedReviewHead);
            if (lease.artifacts.validated_payload_file !== expectedPayloadFile) {
                throw new PrReviewLeaseError("validated payload path mismatch");
            }
            const payload = await readRequiredJson(worktreePath, lease.artifacts.validated_payload_file, "validated payload file");
            if (!jsonEqual(payload, approved.payload)) {
                throw new PrReviewLeaseError("validated payload approved-review mismatch");
            }
        }
        await validateResultCommandAuthority(lease, worktreePath);
        const scopeBaseRef = await scopeBaseRefFromValidatedResult(resultArtifact, worktreePath);
        await validateApprovedReviewOwnership(lease, worktreePath, approvedReviewHead, scopeBaseRef);
    }
    if (options.validateResultAuthority === true) {
        await validateResultCommandAuthority(lease, worktreePath);
    }
}
function validateResultFreshness(lease, policy, freshnessTimestamp) {
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
function hasStaleResultValidation(lease, policy, freshnessTimestamp) {
    const expectedTimestamp = freshnessTimestamp ?? lease.updated_at;
    if (policy === "accept-gated-result" ||
        policy === "validate-live-gated-status" ||
        policy === "preserve-gated-recovery") {
        return lease.validation.result_manifest.validated_at !== expectedTimestamp;
    }
    return (policy === "validate-stored-lease" &&
        lease.state === "gated" &&
        lease.validation.result_manifest.validated_at !== expectedTimestamp);
}
function validateResultPresentation(result, lease, policy) {
    const status = presentationStatusFromResult(result, {
        allowNotPresented: allowsNotPresentedResult(policy, lease),
    });
    if (!requiresLeasePresentation(policy, lease) &&
        lease.presentation.status === null &&
        lease.presentation.presented_at === null) {
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
function allowsNotPresentedResult(policy, lease) {
    return (policy === "accept-reviewed-result" ||
        policy === "preserve-reviewed-recovery" ||
        (policy === "validate-stored-lease" &&
            hasStoredReviewedResultWithoutPresentation(lease)) ||
        (policy === "validate-cleanup-metadata" &&
            hasStoredReviewedResultWithoutPresentation(lease)) ||
        (policy === "preserve-failed-recovery" &&
            lease.presentation.status === null));
}
function hasStoredReviewedResultWithoutPresentation(lease) {
    return (lease.artifacts.result_file !== null &&
        lease.presentation.presented_at === null &&
        lease.presentation.status === null &&
        (lease.state === "reviewed" ||
            lease.state === "aborted" ||
            lease.state === "failed"));
}
function requiresLeasePresentation(policy, lease) {
    return (policy === "accept-gated-result" ||
        policy === "accept-post-success" ||
        policy === "validate-live-gated-status" ||
        policy === "preserve-gated-recovery" ||
        policy === "validate-post-retry" ||
        (policy === "validate-stored-lease" &&
            (lease.state === "gated" || lease.state === "posted")) ||
        (policy === "preserve-failed-recovery" &&
            lease.presentation.status !== null));
}
async function validateResultDigest(lease, worktreePath, resultFile) {
    if (lease.validation.result_manifest.sha256 === null) {
        throw new PrReviewLeaseError("result manifest digest missing");
    }
    const resultSha256 = await sha256DirectChild(worktreePath, resultFile, "result file");
    if (lease.validation.result_manifest.sha256 !== resultSha256) {
        throw new PrReviewLeaseError("result manifest digest mismatch");
    }
}
async function validateResultCommandAuthority(lease, worktreePath) {
    if (lease.artifacts.result_file === null ||
        lease.validation.result_manifest.status !== "valid") {
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
        prReviewManifestHelperScript: optionalEnv("PR_REVIEW_MANIFEST_HELPER_SCRIPT"),
        prReviewLeaseHelperScript: optionalEnv("PR_REVIEW_LEASE_HELPER_SCRIPT"),
        playReviewHelper: optionalEnv("PLAY_REVIEW_HELPER"),
        helperEnv: inheritedHelperEnv(),
    });
}
async function validateApprovedReviewOwnership(lease, worktreePath, reviewHeadSha, scopeBaseRef) {
    const approvedReviewFile = lease.artifacts.approved_review_file;
    if (approvedReviewFile === null) {
        throw new PrReviewLeaseError("approved review file missing");
    }
    const helper = await resolveApprovedReviewHelper();
    let stdout;
    try {
        ({ stdout } = await execFileAsync("bash", [helper, "inspect-approved-review-ownership"], {
            cwd: worktreePath,
            env: {
                ...inheritedHelperEnv(),
                PR_NUMBER: String(lease.pr_number),
                HEAD_SHA: reviewHeadSha,
                BASE_REF: scopeBaseRef,
                APPROVED_REVIEW_FILE: approvedReviewFile,
            },
            maxBuffer: 1024 * 1024,
        }));
    }
    catch (err) {
        const stderr = err && typeof err === "object" && "stderr" in err
            ? String(err.stderr).trim()
            : "";
        throw new PrReviewLeaseError(stderr.length > 0 ? stderr : "approved review validation helper failed");
    }
    let ownership;
    try {
        ownership = JSON.parse(stdout);
    }
    catch {
        throw new PrReviewLeaseError("approved review ownership output malformed");
    }
    if (!isObject(ownership) ||
        Object.keys(ownership).length !== 2 ||
        typeof ownership.review_body_file !== "string" ||
        typeof ownership.review_payload_file !== "string") {
        throw new PrReviewLeaseError("approved review ownership output malformed");
    }
    const expectedBody = `.ephemeral/pr-${lease.pr_number}-${reviewHeadSha}-review-body.md`;
    if (ownership.review_body_file !== expectedBody) {
        throw new PrReviewLeaseError(`review body path mismatch: ${ownership.review_body_file}`);
    }
    validateDirectChild("review payload", ownership.review_payload_file, "-review-payload.json");
    return {
        reviewBodyFile: ownership.review_body_file,
        reviewPayloadFile: ownership.review_payload_file,
    };
}
async function scopeBaseRefFromValidatedResult(result, worktreePath) {
    const artifacts = result.artifacts;
    if (!isObject(artifacts)) {
        throw new PrReviewLeaseError("result artifacts metadata missing");
    }
    const scopeDecision = await readRequiredJson(worktreePath, stringField(artifacts, "scope_decision_file"), "scope decision file");
    const scopeArtifacts = scopeDecision.artifacts;
    if (!isObject(scopeArtifacts)) {
        throw new PrReviewLeaseError("scope decision artifacts missing");
    }
    const providerEvidence = await readRequiredJson(worktreePath, stringField(scopeArtifacts, "provider_scope_evidence_file"), "provider scope evidence file");
    return stringField(providerEvidence, "provider_pr_diff_base_sha");
}
async function resolveApprovedReviewHelper() {
    const candidates = [];
    const configuredDir = optionalEnv("PR_REVIEW_DIR");
    if (configuredDir !== undefined)
        candidates.push(configuredDir);
    for (const script of [
        optionalEnv("PR_REVIEW_MANIFEST_HELPER_SCRIPT"),
        optionalEnv("PR_REVIEW_LEASE_HELPER_SCRIPT"),
    ]) {
        if (script === undefined)
            continue;
        candidates.push(path.dirname(path.dirname(script)));
        try {
            candidates.push(path.dirname(path.dirname(await realpath(script))));
        }
        catch {
            // The executable check below reports the missing helper.
        }
    }
    for (const candidate of candidates) {
        const helper = path.join(candidate, "scripts/approved-review-artifacts.sh");
        try {
            const stat = await lstat(helper);
            if (stat.isFile() &&
                (process.platform === "win32" || (stat.mode & 0o111) !== 0)) {
                return helper;
            }
        }
        catch {
            // Try the next configured location.
        }
    }
    throw new PrReviewLeaseError("approved review artifact helper missing or not executable");
}
async function findUnmanagedEphemeralArtifacts(lease, worktreePath, options = {}) {
    const ephemeralPath = path.join(worktreePath, ".ephemeral");
    // Validate every declared artifact family before treating a missing directory
    // as empty. Otherwise a lease can appear resumable merely because the
    // directory holding the evidence disappeared.
    const owned = await collectOwnedEphemeralArtifacts(lease, worktreePath, options);
    let entries;
    try {
        entries = await readdir(ephemeralPath, { withFileTypes: true });
    }
    catch (err) {
        if (err.code === "ENOENT") {
            if (owned.size === 0)
                return [];
            throw new PrReviewLeaseError("owned ephemeral artifacts missing");
        }
        throw err;
    }
    return entries
        .map((entry) => `.ephemeral/${entry.name}`)
        .filter((entryPath) => !owned.has(entryPath))
        .sort();
}
async function collectOwnedEphemeralArtifacts(lease, worktreePath, options = {}) {
    const owned = new Set();
    if (lease.artifacts.result_file !== null) {
        const { result, handoff } = await validateDiscoveryResultArtifacts(lease, worktreePath);
        const resultHandoffFile = stringField(isObject(result.artifacts) ? result.artifacts : {}, "handoff_file");
        if (lease.artifacts.handoff_file !== null &&
            lease.artifacts.handoff_file !== resultHandoffFile) {
            throw new PrReviewLeaseError("result handoff mismatch");
        }
        addOwnedPath(owned, lease.artifacts.result_file);
        addOwnedPath(owned, resultHandoffFile);
        addOwnedPath(owned, stringField(result, "findings_file"));
        addOwnedPath(owned, nullableStringField(result, "review_body_file"));
        const sharedContext = await validateSharedContextFamilyBinding({
            headSha: stringField(result, "review_head_sha"),
            findingsFile: stringField(result, "findings_file"),
            worktreeRoot: worktreePath,
        });
        addOwnedPath(owned, sharedContext.input_file);
        addOwnedPath(owned, sharedContext.context_file);
        collectHandoffArtifactPaths(owned, handoff);
        collectResultArtifactPaths(owned, result);
    }
    else if (lease.artifacts.handoff_file !== null) {
        const handoff = await validateDiscoveryHandoffArtifacts(lease, worktreePath);
        addOwnedPath(owned, lease.artifacts.handoff_file);
        collectHandoffArtifactPaths(owned, handoff);
    }
    if (lease.artifacts.approved_review_file !== null) {
        if (options.discovery === true) {
            const result = await readRequiredJson(worktreePath, lease.artifacts.result_file ?? "", "result file");
            const approved = await readRequiredJson(worktreePath, lease.artifacts.approved_review_file, "approved review file");
            await validateDiscoveryApprovedReviewOwnership(lease, result, approved, worktreePath);
            addOwnedPath(owned, stringField(approved, "review_body_file"));
            addOwnedPath(owned, stringField(approved, "review_payload_file"));
            addOwnedPath(owned, lease.artifacts.approved_review_file);
            addOwnedPath(owned, lease.artifacts.validated_payload_file);
            return owned;
        }
        const result = await readRequiredJson(worktreePath, lease.artifacts.result_file ?? "", "result file");
        const approved = await readRequiredJson(worktreePath, lease.artifacts.approved_review_file, "approved review file");
        const ownership = await validateApprovedReviewOwnership(lease, worktreePath, validateApprovedIdentity(approved, lease, stringField(result, "review_head_sha")), await scopeBaseRefFromValidatedResult(result, worktreePath));
        addOwnedPath(owned, lease.artifacts.approved_review_file);
        addOwnedPath(owned, ownership.reviewBodyFile);
        addOwnedPath(owned, ownership.reviewPayloadFile);
        addOwnedPath(owned, lease.artifacts.validated_payload_file);
    }
    return owned;
}
async function validateDiscoveryResultArtifacts(lease, worktreePath) {
    const resultFile = lease.artifacts.result_file;
    if (resultFile === null) {
        throw new PrReviewLeaseError("result file missing");
    }
    const reviewHeadSha = reviewHeadShaFromResultFile(resultFile);
    await validateResultDigest(lease, worktreePath, resultFile);
    const evidence = await validatePrReviewResultEvidence({
        worktreeRoot: worktreePath,
        resultFile,
        resultIdentityPath: resultFile,
        repository: lease.repository,
        prNumber: lease.pr_number,
        reviewHeadSha,
        leaseBaseRef: lease.base_ref,
        leaseHeadRef: lease.head_ref,
    });
    if (lease.state === "gated") {
        validateResultFreshness(lease, "validate-stored-lease");
        validateResultPresentation(evidence.result, lease, "validate-stored-lease");
    }
    return evidence;
}
async function validateDiscoveryHandoffArtifacts(lease, worktreePath) {
    const handoffFile = lease.artifacts.handoff_file;
    if (handoffFile === null) {
        throw new PrReviewLeaseError("handoff file missing");
    }
    return validatePrReviewHandoffEvidence({
        worktreeRoot: worktreePath,
        handoffFile,
        handoffIdentityPath: handoffFile,
        repository: lease.repository,
        prNumber: lease.pr_number,
        reviewHeadSha: reviewHeadShaFromHandoffFile(handoffFile),
        leaseBaseRef: lease.base_ref,
        leaseHeadRef: lease.head_ref,
    });
}
async function validateDiscoveryApprovedReviewOwnership(lease, result, approved, worktreePath) {
    const resultFile = lease.artifacts.result_file;
    const approvedReviewFile = lease.artifacts.approved_review_file;
    const validatedPayloadFile = lease.artifacts.validated_payload_file;
    if (resultFile === null || approvedReviewFile === null) {
        throw new PrReviewLeaseError("approved review discovery ownership mismatch");
    }
    const requiresValidatedPayload = lease.state === "posted" || validatedPayloadFile !== null;
    if (!requiresValidatedPayload && lease.state !== "failed") {
        throw new PrReviewLeaseError("approved review discovery ownership mismatch");
    }
    const reviewHead = reviewHeadShaFromResultFile(resultFile);
    const expected = await discoveryApprovedReviewPaths(lease.pr_number, reviewHead, worktreePath);
    const expectedKeys = [
        "schema",
        "review_head_sha",
        "findings_file",
        "review_body_file",
        "review_payload_file",
        "scope_decision_file",
        "findings_sha256",
        "review_body_sha256",
        "review_payload_sha256",
        "scope_decision_sha256",
        "payload",
    ];
    if (Object.keys(approved).length !== expectedKeys.length ||
        expectedKeys.some((key) => !(key in approved)) ||
        approved.schema !== "pr-review/approved-review/v1" ||
        approvedReviewFile !== expected.approvedReviewFile ||
        (requiresValidatedPayload &&
            validatedPayloadFile !== expected.validatedPayloadFile) ||
        approved.review_head_sha !== reviewHead ||
        result.review_head_sha !== reviewHead ||
        approved.findings_file !== expected.findingsFile ||
        result.findings_file !== expected.findingsFile ||
        approved.review_body_file !== expected.reviewBodyFile ||
        result.review_body_file !== expected.reviewBodyFile ||
        approved.review_payload_file !== expected.reviewPayloadFile ||
        !isObject(approved.payload) ||
        !isObject(result.artifacts) ||
        approved.scope_decision_file !== expected.scopeDecisionFile ||
        result.artifacts.scope_decision_file !== expected.scopeDecisionFile) {
        throw new PrReviewLeaseError("approved review discovery ownership mismatch");
    }
    for (const [label, file, digest, expectedPath] of [
        [
            "findings",
            approved.findings_file,
            approved.findings_sha256,
            expected.findingsFile,
        ],
        [
            "review body",
            approved.review_body_file,
            approved.review_body_sha256,
            expected.reviewBodyFile,
        ],
        [
            "review payload",
            approved.review_payload_file,
            approved.review_payload_sha256,
            expected.reviewPayloadFile,
        ],
        [
            "scope decision",
            approved.scope_decision_file,
            approved.scope_decision_sha256,
            expected.scopeDecisionFile,
        ],
    ]) {
        if (typeof file !== "string" ||
            typeof digest !== "string" ||
            file !== expectedPath) {
            throw new PrReviewLeaseError("approved review discovery ownership mismatch");
        }
        validateDirectChild(label, file);
        if ((await sha256DirectChild(worktreePath, file, label)) !== digest) {
            throw new PrReviewLeaseError("approved review discovery digest mismatch");
        }
    }
    const payloadFile = stringField(approved, "review_payload_file");
    const payload = await readRequiredJson(worktreePath, payloadFile, "review payload file");
    const scope = await readRequiredJson(worktreePath, expected.scopeDecisionFile, "scope decision file");
    const scopeArtifacts = scope.artifacts;
    const priorContext = scope.prior_context;
    if (!isObject(scopeArtifacts) || !isObject(priorContext)) {
        throw new PrReviewLeaseError("approved review discovery ownership mismatch");
    }
    const fullRange = stringField(scope, "full_range");
    const baseMatch = /^([0-9a-f]{40})\.\./u.exec(fullRange);
    if (baseMatch === null) {
        throw new PrReviewLeaseError("approved review discovery ownership mismatch");
    }
    const expectedPayload = await validateCanonicalApprovedReviewArtifacts({
        worktreeRoot: worktreePath,
        options: {
            surface: "pr-review",
            headSha: reviewHead,
            baseRef: baseMatch[1],
            scopeDecision: expected.scopeDecisionFile,
            providerScopeEvidenceFile: stringField(scopeArtifacts, "provider_scope_evidence_file"),
            expectedSchema: "pr-review/scope-decision/v1",
            priorContextKind: stringField(priorContext, "kind"),
            priorContextPath: nullableStringField(priorContext, "path") ?? "null",
            governedPathPattern: PR_REVIEW_GOVERNED_PATH_PATTERN,
            configuredPathPattern: "^$",
            maxNarrowChangedFiles: PR_REVIEW_MAX_NARROW_CHANGED_FILES,
            allowAmbiguousFull: "true",
            findingsFile: expected.findingsFile,
            reviewBodyFile: expected.reviewBodyFile,
            reviewPayloadFile: expected.reviewPayloadFile,
            reviewEvent: stringField(approved.payload, "event"),
        },
    });
    if (!jsonEqual(payload, expectedPayload) ||
        !jsonEqual(approved.payload, expectedPayload)) {
        throw new PrReviewLeaseError("approved review discovery payload mismatch");
    }
    if (validatedPayloadFile !== null) {
        const validatedPayload = await readRequiredJson(worktreePath, validatedPayloadFile, "validated payload file");
        if (!jsonEqual(validatedPayload, expectedPayload)) {
            throw new PrReviewLeaseError("validated payload approved-review mismatch");
        }
    }
}
async function discoveryApprovedReviewPaths(prNumber, reviewHead, worktreePath) {
    const branchSlug = await discoveryBranchSlug(worktreePath);
    return {
        findingsFile: `.ephemeral/${branchSlug}-${reviewHead}-findings.json`,
        reviewBodyFile: `.ephemeral/pr-${prNumber}-${reviewHead}-review-body.md`,
        reviewPayloadFile: `.ephemeral/${branchSlug}-${reviewHead}-review-payload.json`,
        scopeDecisionFile: `.ephemeral/${branchSlug}-${reviewHead}-scope-decision.json`,
        approvedReviewFile: `.ephemeral/${branchSlug}-${reviewHead}-approved-review.json`,
        validatedPayloadFile: expectedValidatedPayloadPath(prNumber, reviewHead),
    };
}
async function discoveryBranchSlug(worktreePath) {
    const { stdout } = await execFileAsync("git", ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"], { maxBuffer: 1024 * 1024 });
    const branch = stdout.trim();
    if (branch === "HEAD")
        return "detached";
    const slug = branch.replaceAll("/", "-").replace(/[^A-Za-z0-9._-]/gu, "");
    return slug.length === 0 ||
        slug === "." ||
        slug === ".." ||
        slug.startsWith("-") ||
        slug.startsWith(".")
        ? "unnamed"
        : slug;
}
function collectHandoffArtifactPaths(owned, handoff) {
    const artifacts = handoff.artifacts;
    if (!isObject(artifacts)) {
        return;
    }
    addOwnedPath(owned, stringField(artifacts, "scope_decision_file"));
    addOwnedPath(owned, nullableStringField(artifacts, "prior_threads_file"));
    addOwnedPath(owned, stringField(artifacts, "provider_scope_evidence_file"));
}
function collectResultArtifactPaths(owned, result) {
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
function addOwnedPath(owned, value) {
    if (value === null) {
        return;
    }
    requireDirectEphemeralChild(value);
    owned.add(value);
}
function validateHandoffIdentity(handoff, lease, worktreePath) {
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
    if (execution !== undefined &&
        isObject(execution) &&
        execution.working_directory !== undefined &&
        normalizeComparablePath(String(execution.working_directory)) !==
            normalizeComparablePath(worktreePath)) {
        throw new PrReviewLeaseError("handoff worktree path mismatch");
    }
}
function validateResultIdentity(result, lease) {
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
    const handoffFile = isObject(result.artifacts) &&
        typeof result.artifacts.handoff_file === "string"
        ? result.artifacts.handoff_file
        : typeof result.handoff_file === "string"
            ? result.handoff_file
            : null;
    if (lease.artifacts.handoff_file !== null &&
        handoffFile !== null &&
        handoffFile !== lease.artifacts.handoff_file) {
        throw new PrReviewLeaseError("result handoff mismatch");
    }
    if (lease.state === "gated") {
        const status = presentationStatusFromResult(result);
        if (status !== lease.presentation.status) {
            throw new PrReviewLeaseError("presentation status mismatch");
        }
    }
}
function presentationStatusFromResult(result, options = {}) {
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
function validateApprovedIdentity(approved, lease, resultReviewHead) {
    const reviewHead = stringField(approved, "review_head_sha");
    if (!SHA_RE.test(reviewHead)) {
        throw new PrReviewLeaseError("approved review head mismatch");
    }
    if (resultReviewHead !== null && reviewHead !== resultReviewHead) {
        throw new PrReviewLeaseError("approved review result head mismatch");
    }
    if (isObject(approved.payload) &&
        typeof approved.payload.commit_id === "string" &&
        approved.payload.commit_id !== reviewHead) {
        throw new PrReviewLeaseError("approved review payload head mismatch");
    }
    if (lease.artifacts.result_file !== null &&
        typeof approved.review_body_file !== "string") {
        throw new PrReviewLeaseError("approved review result binding mismatch");
    }
    return reviewHead;
}
async function readExistingLease(file) {
    try {
        await lstat(path.join(process.cwd(), file));
        const lease = await readRequiredJson(process.cwd(), file, "lease file");
        validateLeaseShape(lease);
        return lease;
    }
    catch (err) {
        if (err.code === "ENOENT")
            return null;
        throw err;
    }
}
function assertLeaseObjectShape(lease) {
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
    assertExactLeaseObject(lease, [
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
    ], ["cleanup"], "lease schema");
    for (const key of [
        "schema",
        "repository",
        "state",
        "base_ref",
        "head_ref",
        "worktree_path",
        "worktree_digest",
        "lease_file",
        "created_at",
        "updated_at",
    ]) {
        assertStringLeaseField(lease, key, "lease schema");
    }
    if (!Number.isSafeInteger(lease.pr_number) || lease.pr_number <= 0) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertExactLeaseObject(lease.artifacts, [
        "handoff_file",
        "result_file",
        "approved_review_file",
        "validated_payload_file",
    ], [], "lease artifacts metadata");
    for (const key of [
        "handoff_file",
        "result_file",
        "approved_review_file",
        "validated_payload_file",
    ]) {
        assertNullableStringLeaseField(lease.artifacts, key, "lease artifacts metadata");
    }
    assertExactLeaseObject(lease.validation, ["result_manifest"], [], "lease validation metadata");
    assertExactLeaseObject(lease.validation.result_manifest, ["status", "validated_at", "sha256"], [], "lease result_manifest metadata");
    if (lease.validation.result_manifest.status !== null &&
        lease.validation.result_manifest.status !== "valid") {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertNullableStringLeaseField(lease.validation.result_manifest, "validated_at", "lease result_manifest metadata");
    assertNullableStringLeaseField(lease.validation.result_manifest, "sha256", "lease result_manifest metadata");
    assertExactLeaseObject(lease.presentation, ["presented_at", "status"], [], "lease presentation metadata");
    assertNullableStringLeaseField(lease.presentation, "presented_at", "lease presentation metadata");
    if (lease.presentation.status !== null &&
        lease.presentation.status !== "preview-current" &&
        lease.presentation.status !== "edited") {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertExactLeaseObject(lease.terminal, ["finished_at", "reason"], [], "lease terminal metadata");
    assertNullableStringLeaseField(lease.terminal, "finished_at", "lease terminal metadata");
    assertNullableStringLeaseField(lease.terminal, "reason", "lease terminal metadata");
    assertExactLeaseObject(lease.failure, ["phase", "reason", "recoverability"], [], "lease failure metadata");
    if (lease.failure.phase !== null &&
        ![
            "handoff-validation",
            "review",
            "result-validation",
            "preview-render",
            "approval-freeze",
            "stale-head",
            "github-post",
        ].includes(lease.failure.phase)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertNullableStringLeaseField(lease.failure, "reason", "lease failure metadata");
    if (lease.failure.recoverability !== null &&
        !["recoverable", "unrecoverable", "unknown"].includes(lease.failure.recoverability)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertExactLeaseObject(lease.github, ["github_post_attempted", "github_post_result", "github_posted_at"], [], "lease GitHub metadata");
    if (typeof lease.github.github_post_attempted !== "boolean") {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.github.github_post_result !== "succeeded" &&
        lease.github.github_post_result !== "failed" &&
        lease.github.github_post_result !== "not-attempted") {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertNullableStringLeaseField(lease.github, "github_posted_at", "lease GitHub metadata");
    if (lease.cleanup !== undefined) {
        assertExactLeaseObject(lease.cleanup, ["last_outcome", "last_checked_at"], ["removed_at"], "lease cleanup metadata");
    }
}
function assertExactLeaseObject(value, requiredKeys, optionalKeys, label) {
    if (!isObject(value)) {
        throw new PrReviewLeaseError(`${label} missing`);
    }
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    if (requiredKeys.some((key) => !(key in value)) ||
        Object.keys(value).some((key) => !allowed.has(key))) {
        throw new PrReviewLeaseError(`${label} mismatch`);
    }
}
function assertStringLeaseField(value, key, label) {
    if (typeof value[key] !== "string") {
        throw new PrReviewLeaseError(`${label} mismatch`);
    }
}
function assertNullableStringLeaseField(value, key, label) {
    if (value[key] !== null && typeof value[key] !== "string") {
        throw new PrReviewLeaseError(`${label} mismatch`);
    }
}
function validateCleanupMetadata(cleanup) {
    if (cleanup === undefined)
        return;
    const keys = Object.keys(cleanup).sort();
    const isLegacyCleanup = keys.length === 2 &&
        keys[0] === "last_checked_at" &&
        keys[1] === "last_outcome";
    const isCurrentCleanup = keys.length === 3 &&
        keys[0] === "last_checked_at" &&
        keys[1] === "last_outcome" &&
        keys[2] === "removed_at";
    if (!isLegacyCleanup && !isCurrentCleanup) {
        throw new PrReviewLeaseError("lease cleanup metadata mismatch");
    }
    if ((cleanup.last_outcome !== null &&
        typeof cleanup.last_outcome !== "string") ||
        (cleanup.last_checked_at !== null &&
            typeof cleanup.last_checked_at !== "string") ||
        (isCurrentCleanup &&
            cleanup.removed_at !== null &&
            typeof cleanup.removed_at !== "string")) {
        throw new PrReviewLeaseError("lease cleanup metadata mismatch");
    }
    if (cleanup.last_outcome !== null &&
        cleanup.last_outcome !== "removed" &&
        cleanup.last_outcome !== "retained" &&
        cleanup.last_outcome !== "skipped" &&
        cleanup.last_outcome !== "failed") {
        throw new PrReviewLeaseError("lease cleanup outcome mismatch");
    }
    if (cleanup.last_checked_at !== null) {
        validateTimestamp("cleanup.last_checked_at", cleanup.last_checked_at);
    }
    if (isCurrentCleanup && cleanup.removed_at !== null) {
        validateTimestamp("cleanup.removed_at", cleanup.removed_at);
    }
}
function hasPostCleanupArchiveAuthority(previous) {
    const cleanup = previous?.cleanup;
    return (previous !== null &&
        (previous.state === "posted" || previous.state === "aborted") &&
        typeof cleanup?.removed_at === "string" &&
        typeof cleanup.last_checked_at === "string" &&
        cleanup.removed_at <= cleanup.last_checked_at);
}
function assertExistingLeaseIdentity(lease, identity) {
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
async function readRequiredJson(root, relPath, label) {
    validateDirectChild(label.replace(" file", ""), relPath);
    await assertReadableDirectChild(root, relPath, label);
    return JSON.parse(await readFile(path.join(root, relPath), "utf8"));
}
async function assertReadableDirectChild(root, relPath, label) {
    const fullPath = path.join(root, relPath);
    await assertEphemeralDirectory(root);
    let stat;
    try {
        stat = await lstat(fullPath);
    }
    catch {
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
async function assertReadableWorktree(worktreePath) {
    try {
        const stat = await lstat(worktreePath);
        if (!stat.isDirectory()) {
            throw new PrReviewLeaseError("WORKTREE_PATH must be a directory");
        }
        await access(worktreePath, constants.R_OK | constants.X_OK);
    }
    catch (err) {
        if (err instanceof PrReviewLeaseError)
            throw err;
        throw new PrReviewLeaseError("WORKTREE_PATH is not readable");
    }
}
async function sha256DirectChild(root, relPath, label) {
    await assertReadableDirectChild(root, relPath, label);
    return createHash("sha256")
        .update(await readFile(path.join(root, relPath)))
        .digest("hex");
}
async function assertWritableDirectChild(root, relPath, label) {
    validateDirectChild(label, relPath);
    await assertEphemeralDirectory(root);
    await mkdir(path.join(root, ".ephemeral"), { recursive: true });
    try {
        const stat = await lstat(path.join(root, relPath));
        if (stat.isSymbolicLink()) {
            throw new PrReviewLeaseError(`${label} path must not be a symlink: ${relPath}`);
        }
        if (!stat.isFile()) {
            throw new PrReviewLeaseError(`${label} path exists but is not a regular file: ${relPath}`);
        }
    }
    catch (err) {
        if (err instanceof PrReviewLeaseError)
            throw err;
    }
}
async function assertEphemeralDirectory(root) {
    const ephemeral = path.join(root, ".ephemeral");
    try {
        const stat = await lstat(ephemeral);
        if (stat.isSymbolicLink()) {
            throw new PrReviewLeaseError(".ephemeral must be a directory, not a symlink");
        }
        if (!stat.isDirectory()) {
            throw new PrReviewLeaseError(".ephemeral must be a directory");
        }
    }
    catch (err) {
        if (err.code === "ENOENT")
            return;
        throw err;
    }
}
function validateDirectChild(label, value, suffix = "") {
    try {
        requireDirectEphemeralChild(value);
    }
    catch {
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
export function digestLeaseIdentityPath(value) {
    return createHash("sha256")
        .update(canonicalLeaseIdentityPath(value))
        .digest("hex");
}
function digestPath(value) {
    return digestLeaseIdentityPath(value);
}
function expectedValidatedPayloadPath(prNumber, reviewHead) {
    return `.ephemeral/pr-${prNumber}-${reviewHead}-validated-review-payload.json`;
}
/**
 * Canonical persisted lease identity. Windows drive paths compare
 * case-insensitively with slash-normalized separators; POSIX paths preserve
 * every byte, including a literal backslash in a filename.
 */
export function canonicalLeaseIdentityPath(value) {
    if (!/^[A-Za-z]:[\\/]/u.test(value))
        return value;
    return value.replace(/[\\/]+/gu, "/").toLowerCase();
}
export function normalizeComparablePath(value) {
    return canonicalLeaseIdentityPath(value);
}
function isAbsoluteLeaseIdentityPath(value) {
    return path.isAbsolute(value) || /^[a-z]:\//u.test(value);
}
function isCanonicalLeaseIdentityPath(value) {
    return (isAbsoluteLeaseIdentityPath(value) &&
        canonicalLeaseIdentityPath(value) === value);
}
function physicalPathForIo(identityPath) {
    // Win32 APIs accept canonical drive paths in most cases; the explicit
    // boundary conversion keeps persisted identity independent of that detail.
    return process.platform === "win32" && /^[a-z]:\//u.test(identityPath)
        ? identityPath.replace(/\//gu, "\\")
        : identityPath;
}
function emptyArtifacts() {
    return {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
    };
}
function emptyValidation() {
    return {
        result_manifest: {
            status: null,
            validated_at: null,
            sha256: null,
        },
    };
}
function validResultValidation(validatedAt, sha256) {
    return {
        result_manifest: {
            status: "valid",
            validated_at: validatedAt,
            sha256,
        },
    };
}
function emptyPresentation() {
    return { presented_at: null, status: null };
}
function requiredEnv(name) {
    const value = process.env[name];
    if (value === undefined || value.length === 0) {
        throw new PrReviewLeaseError(`${name} is required`);
    }
    return value;
}
function optionalEnv(name) {
    const value = process.env[name];
    return value === undefined || value.length === 0 ? undefined : value;
}
function requireInput(name, value) {
    if (value === undefined || value === null || value === "") {
        throw new PrReviewLeaseError(`${name} is required`);
    }
}
function parsePositiveInteger(name, value) {
    if (!/^[1-9][0-9]*$/u.test(value)) {
        throw new PrReviewLeaseError(`${name} must be a positive integer`);
    }
    return Number(value);
}
function validateTimestamp(label, value) {
    if (!TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
        throw new PrReviewLeaseError(`${label} must be a UTC RFC3339 timestamp ending in Z`);
    }
    if (new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z") !== value) {
        throw new PrReviewLeaseError(`${label} must be a UTC RFC3339 timestamp ending in Z`);
    }
}
function validateKnownLeaseState(value) {
    if (typeof value !== "string") {
        throw new PrReviewLeaseError("lease state must be a string");
    }
    parseState(value);
}
function nowTimestamp() {
    return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}
function parseState(value) {
    const parsed = parseOptionalState(value);
    if (parsed === undefined) {
        throw new PrReviewLeaseError(`unknown lease state: ${value}`);
    }
    return parsed;
}
function parseOptionalState(value) {
    if (value === "created" ||
        value === "reviewed" ||
        value === "gated" ||
        value === "posted" ||
        value === "aborted" ||
        value === "failed") {
        return value;
    }
    if (value === undefined)
        return undefined;
    throw new PrReviewLeaseError(`unknown lease state: ${value}`);
}
function parseOptionalPresentation(value) {
    if (value === undefined ||
        value === "preview-current" ||
        value === "edited") {
        return value;
    }
    throw new PrReviewLeaseError(`unknown presentation status: ${value}`);
}
function parseOptionalFailurePhase(value) {
    if (value === undefined ||
        value === "handoff-validation" ||
        value === "review" ||
        value === "result-validation" ||
        value === "preview-render" ||
        value === "approval-freeze" ||
        value === "stale-head" ||
        value === "github-post") {
        return value;
    }
    throw new PrReviewLeaseError(`unknown failure phase: ${value}`);
}
function parseOptionalRecoverability(value) {
    if (value === undefined ||
        value === "recoverable" ||
        value === "unrecoverable" ||
        value === "unknown") {
        return value;
    }
    throw new PrReviewLeaseError(`unknown failure recoverability: ${value}`);
}
function parseOptionalGitHubResult(value) {
    if (value === undefined ||
        value === "succeeded" ||
        value === "failed" ||
        value === "not-attempted") {
        return value;
    }
    throw new PrReviewLeaseError(`unknown GitHub post result: ${value}`);
}
function parseOptionalBoolean(value) {
    if (value === undefined)
        return undefined;
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    throw new PrReviewLeaseError(`expected boolean: ${value}`);
}
function stringField(object, key) {
    const value = object[key];
    if (typeof value !== "string") {
        throw new PrReviewLeaseError(`${key} is required`);
    }
    return value;
}
function nullableStringField(object, key) {
    const value = object[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new PrReviewLeaseError(`${key} is required`);
    }
    return value;
}
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalidTransition(previous, target) {
    return new PrReviewLeaseError(`invalid lease transition: ${previous} -> ${target}`);
}
function ok(stdout) {
    return { exitCode: 0, stdout, stderr: "" };
}
class PrReviewLeaseError extends Error {
    constructor(message) {
        super(message);
        this.name = "PrReviewLeaseError";
    }
}
