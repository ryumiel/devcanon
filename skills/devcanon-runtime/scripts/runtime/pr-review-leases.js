import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rename, } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
import { requireDirectEphemeralChild } from "./paths.js";
const execFileAsync = promisify(execFile);
const SHA_RE = /^[0-9a-f]{40}$/u;
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
            case "validate":
                await validateLeaseCommand();
                return ok("");
            case "inspect-worktree":
                return ok(await inspectWorktree());
            case "cleanup-worktree":
                return ok(await cleanupWorktree());
            default:
                throw new PrReviewLeaseError("usage: review-leases.sh derive-path|write|validate|inspect-worktree|cleanup-worktree");
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: `${message}\n` };
    }
}
export function reducePrReviewLease(previous, identity, inputs) {
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
            return {
                ...base,
                state: "reviewed",
                artifacts: {
                    ...base.artifacts,
                    handoff_file: inputs.handoffFile ?? previous?.artifacts.handoff_file ?? null,
                    result_file: inputs.resultFile,
                },
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
    const inputs = readInputs();
    const previous = await readExistingLease(identity.leaseFile);
    const archive = archivePathIfNeeded(previous, identity, inputs);
    const reduced = reducePrReviewLease(previous, identity, inputs);
    validateLeaseShape(reduced);
    await validateReferencedArtifacts(reduced, identity.worktreePath);
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
    await validateReferencedArtifacts(lease, identity.worktreePath);
}
async function inspectWorktree() {
    const identity = await readIdentity(true);
    const decision = await classifyCleanup(identity);
    if (decision.identityMatch && decision.leaseState !== "") {
        await recordCleanupMetadata(identity, decision.leaseState, "");
    }
    return cleanupOutput("inspect", decision);
}
async function cleanupWorktree() {
    const identity = await readIdentity(true);
    const decision = await classifyCleanup(identity);
    if (!decision.canRemove) {
        if (decision.identityMatch && decision.leaseState !== "") {
            await recordCleanupMetadata(identity, decision.leaseState, "retained");
            decision.metadataOutcome = "retained";
        }
        return cleanupOutput("retained", decision);
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
    }
    catch {
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
        await validateReferencedArtifacts(lease, identity.worktreePath);
    }
    catch {
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
async function isWorktreeDirty(worktreePath) {
    try {
        const { stdout } = await execFileAsync("git", ["-C", worktreePath, "status", "--porcelain"], { maxBuffer: 1024 * 1024 });
        return stdout.length > 0;
    }
    catch {
        return true;
    }
}
async function recordCleanupMetadata(identity, state, outcome) {
    const lease = await readRequiredJson(identity.primaryRoot, identity.leaseFile, "lease file");
    const next = {
        ...lease,
        cleanup: {
            last_outcome: outcome === "" ? (lease.cleanup?.last_outcome ?? null) : outcome,
            last_checked_at: nowTimestamp(),
        },
    };
    validateLeaseShape(next);
    await writeTextAtomically(path.join(identity.primaryRoot, identity.leaseFile), `${JSON.stringify(next, null, 2)}\n`);
    if (state !== lease.state) {
        throw new PrReviewLeaseError("lease state changed during cleanup metadata write");
    }
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
    if (primaryRoot !== cwd) {
        throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must match the primary repository root");
    }
    const worktreePath = await realpath(requiredEnv("WORKTREE_PATH"));
    if (worktreePath === primaryRoot) {
        throw new PrReviewLeaseError("WORKTREE_PATH must be a review worktree, not the primary repository root");
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
    return {
        ...base,
        state: "gated",
        artifacts: {
            ...base.artifacts,
            handoff_file: previous?.artifacts.handoff_file ?? null,
            result_file: resultFile,
        },
        presentation: {
            presented_at: inputs.presentedAt,
            status: inputs.presentationStatus,
        },
    };
}
function applyFailure(row, base, previous, inputs) {
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
        presentation: row === "LC-11" || row === "LC-12" || row === "LC-13"
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
        return inputs.resultFile ?? previous?.artifacts.result_file ?? null;
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
    const stamp = (previous.terminal.finished_at ?? previous.updated_at).replace(/[-:Z]/gu, "");
    return `.ephemeral/pr-${identity.prNumber}-${identity.worktreeDigest}-${stamp}-${previous.state}-archived-lease.json`;
}
function validateLeaseShape(lease) {
    if (lease.schema !== "pr-review/lease/v1") {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
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
    validateStateInvariants(lease);
}
function validateStateInvariants(lease) {
    if (lease.state === "created" && lease.artifacts.result_file !== null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if ((lease.state === "reviewed" ||
        lease.state === "gated" ||
        lease.state === "posted") &&
        lease.artifacts.result_file === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.state === "gated" && lease.presentation.presented_at === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if ((lease.state === "posted" ||
        lease.state === "aborted" ||
        lease.state === "failed") &&
        lease.terminal.finished_at === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.state === "posted" &&
        lease.artifacts.approved_review_file === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.state === "failed" && lease.failure.phase === null) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
}
async function validateReferencedArtifacts(lease, worktreePath) {
    if (lease.artifacts.handoff_file !== null) {
        const handoff = await readRequiredJson(worktreePath, lease.artifacts.handoff_file, "handoff file");
        validateHandoffIdentity(handoff, lease, worktreePath);
    }
    if (lease.artifacts.result_file !== null) {
        const result = await readRequiredJson(worktreePath, lease.artifacts.result_file, "result file");
        validateResultIdentity(result, lease);
    }
    if (lease.artifacts.approved_review_file !== null) {
        const approved = await readRequiredJson(worktreePath, lease.artifacts.approved_review_file, "approved review file");
        validateApprovedIdentity(approved, lease);
        if (lease.artifacts.validated_payload_file !== null) {
            const payload = await readRequiredJson(worktreePath, lease.artifacts.validated_payload_file, "validated payload file");
            if (JSON.stringify(payload) !== JSON.stringify(approved.payload)) {
                throw new PrReviewLeaseError("validated payload approved-review mismatch");
            }
        }
    }
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
    if (lease.state === "gated" && isObject(result.presentation)) {
        const status = result.presentation.status;
        if (status !== "preview-current" && status !== "edited") {
            throw new PrReviewLeaseError("gated result presentation mismatch");
        }
    }
}
function validateApprovedIdentity(approved, lease) {
    const reviewHead = stringField(approved, "review_head_sha");
    if (!SHA_RE.test(reviewHead)) {
        throw new PrReviewLeaseError("approved review head mismatch");
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
}
async function readExistingLease(file) {
    try {
        return await readRequiredJson(process.cwd(), file, "lease file");
    }
    catch (err) {
        if (err.code === "ENOENT")
            return null;
        return null;
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
function digestPath(value) {
    return createHash("sha256")
        .update(normalizeComparablePath(value))
        .digest("hex");
}
function normalizeComparablePath(value) {
    const normalized = value.replace(/\\/gu, "/");
    return /^[A-Za-z]:\//u.test(normalized)
        ? normalized.toLowerCase()
        : normalized;
}
function emptyArtifacts() {
    return {
        handoff_file: null,
        result_file: null,
        approved_review_file: null,
        validated_payload_file: null,
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
