import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, } from "node:fs/promises";
import path from "node:path";
import { TextDecoder, promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
import { requireDirectEphemeralChild } from "./paths.js";
import { validateSharedContextFamilyBinding } from "./play-review-shared-context.js";
import { validatePrReviewResultCommandAuthority } from "./pr-review-result-validation.js";
const execFileAsync = promisify(execFile);
const DISCOVERY_INVALID_REASONS = [
    "discovery-snapshot-changed",
    "invalid-canonical-target",
    "invalid-discovery-directory",
    "invalid-archived-entry",
    "invalid-lease-name",
    "worktree-registrations-changed",
    "primary-repository-identity-changed",
    "canonical-target-changed",
];
const DISCOVERY_ACTIVE_INVALID_REASONS = [
    "invalid-lease",
    "lease-replaced",
    "worktree-replaced",
    "repository-identity-changed",
    "status-inspection-failed",
    "worktree-dirty-after-snapshot",
    "lease-identity-mismatch",
    "worktree-inspection-failed",
    "invalid-worktree-entry",
    "worktree-identity-unverifiable",
    "worktree-digest-mismatch",
    "invalid-ephemeral-directory",
    "worktree-repository-mismatch",
    "resumable-worktree-path-missing",
];
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
export async function runPrReviewLeasesCommand(args, stdinInput) {
    try {
        const [commandName, ...commandArgs] = args;
        switch (commandName) {
            case "derive-path":
                return ok(`${(await readIdentity(false)).leaseFile}\n`);
            case "discover":
                if (commandArgs.length !== 0) {
                    throw new PrReviewLeaseError("discover does not accept positional arguments");
                }
                return ok(`${JSON.stringify(await discoverReviewSession())}\n`);
            case "validate-discovery":
                return ok(`${await runValidateDiscoveryCommand(stdinInput ??
                    (commandArgs[0] === "--resume-acceptance"
                        ? Buffer.alloc(0)
                        : readFileSync(0)), commandArgs)}\n`);
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
                throw new PrReviewLeaseError("usage: review-leases.sh derive-path|discover|validate-discovery|write|record-audit-failure|validate|read-status|inspect-worktree|cleanup-worktree");
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: `${message}\n` };
    }
}
function runValidateDiscoveryCommand(contents, args) {
    if (args[0] === "--resume-acceptance") {
        return validateResumeAcceptance(parseResumeAcceptanceArgs(args.slice(1)));
    }
    return validatePrReviewDiscoveryCommand(contents, parseValidateDiscoveryArgs(args));
}
function isSafeGitHubRepositoryComponent(value) {
    return (/^[A-Za-z0-9_.-]+$/u.test(value) &&
        value !== "." &&
        value !== ".." &&
        !value.startsWith("-"));
}
function parseResumeAcceptanceArgs(args) {
    if (args.length !== 10 ||
        args[0] !== "--repository" ||
        args[2] !== "--pr-number" ||
        args[4] !== "--primary-root" ||
        args[6] !== "--lease-file" ||
        args[8] !== "--worktree-path") {
        throw new PrReviewLeaseError("usage: validate-discovery --resume-acceptance --repository owner/name --pr-number N --primary-root PATH --lease-file PATH --worktree-path PATH");
    }
    const identity = parseValidateDiscoveryArgs(args.slice(0, 6));
    if (args[7].length === 0 || args[9].length === 0) {
        throw new PrReviewLeaseError("invalid resume acceptance identity");
    }
    return {
        ...identity,
        leaseFile: args[7],
        worktreePath: args[9],
    };
}
async function validateResumeAcceptance(identity) {
    const observed = await discoverReviewSession(identity);
    validatePrReviewDiscoveryJson(Buffer.from(JSON.stringify(observed)), identity);
    if (observed.disposition !== "resume" ||
        observed.resume === null ||
        observed.resume.lease_file !== identity.leaseFile ||
        observed.resume.worktree_path !== identity.worktreePath) {
        throw new PrReviewLeaseError("resume acceptance changed; stop before lifecycle mutation");
    }
    return JSON.stringify({
        schema: "pr-review/resume-acceptance/v1",
        repository: observed.repository,
        pr_number: observed.pr_number,
        primary_repository_root: observed.primary_repository_root,
        lease_file: observed.resume.lease_file,
        worktree_path: observed.resume.worktree_path,
    });
}
function isSafeGitHubRepository(value) {
    const parts = value.split("/");
    return (parts.length === 2 &&
        parts.every((part) => isSafeGitHubRepositoryComponent(part)));
}
function parseValidateDiscoveryArgs(args) {
    if (args.length !== 6 ||
        args[0] !== "--repository" ||
        args[2] !== "--pr-number" ||
        args[4] !== "--primary-root") {
        throw new PrReviewLeaseError("usage: validate-discovery --repository owner/name --pr-number N --primary-root PATH");
    }
    const repository = args[1];
    const primaryRoot = args[5];
    if (!isSafeGitHubRepository(repository) || primaryRoot.length === 0) {
        throw new PrReviewLeaseError("invalid discovery validation identity");
    }
    return {
        repository,
        prNumber: parsePositiveInteger("PR_NUMBER", args[3]),
        primaryRoot,
    };
}
export function validatePrReviewDiscoveryJson(contents, identity) {
    const source = decodeDiscoveryJson(contents);
    assertNoDuplicateJsonKeys(source);
    let value;
    try {
        value = JSON.parse(source);
    }
    catch {
        throw new PrReviewLeaseError("discovery result is not valid JSON");
    }
    const platform = identity.platform ?? process.platform;
    const result = parseDiscoveryResult(value, platform);
    if (result.repository !== identity.repository ||
        result.pr_number !== identity.prNumber ||
        discoveryComparablePath(discoveryFilesystemPath(result.primary_repository_root, platform), platform) !==
            discoveryComparablePath(discoveryFilesystemPath(identity.primaryRoot, platform), platform)) {
        throw new PrReviewLeaseError("discovery result identity mismatch");
    }
    const canonicalExpected = `${result.primary_repository_root.replace(/[/\\]+$/u, "")}/.worktrees/pr-${result.pr_number}-review`;
    if (discoveryComparablePath(result.canonical_target.worktree_path, platform) !==
        discoveryComparablePath(canonicalExpected, platform)) {
        throw new PrReviewLeaseError("discovery canonical target mismatch");
    }
    const registrationKeys = result.registrations.map((entry) => discoveryRegistrationComparablePath(entry, platform));
    const duplicateRegistrationKeys = new Set(registrationKeys).size !== registrationKeys.length;
    const invalidRegistrationAuthority = result.invalid.some((entry) => entry.path === ".git/worktrees" &&
        entry.reason === "worktree-registrations-changed");
    const canonicalRegistrationCount = registrationKeys.filter((entry) => entry ===
        discoveryRegistrationComparablePath(result.canonical_target.worktree_path, platform)).length;
    if ((duplicateRegistrationKeys && !invalidRegistrationAuthority) ||
        (result.canonical_target.registered
            ? canonicalRegistrationCount < 1
            : canonicalRegistrationCount !== 0)) {
        throw new PrReviewLeaseError("discovery registration correlation mismatch");
    }
    for (const entry of result.active) {
        if (entry.classification === "invalid" || entry.worktree_path === null) {
            continue;
        }
        const registrationCount = registrationKeys.filter((registration) => registration ===
            discoveryRegistrationComparablePath(entry.worktree_path ?? "", platform)).length;
        const registrationCountValid = entry.classification === "artifact-bearing"
            ? registrationCount === 0 ||
                registrationCount === 1 ||
                (duplicateRegistrationKeys && invalidRegistrationAuthority)
            : entry.classification === "missing" ||
                entry.classification === "unregistered"
                ? registrationCount === 0
                : registrationCount === 1 ||
                    (registrationCount > 1 &&
                        duplicateRegistrationKeys &&
                        invalidRegistrationAuthority);
        if (!registrationCountValid) {
            throw new PrReviewLeaseError("discovery active registration correlation mismatch");
        }
    }
    const expected = reducePrReviewDiscovery({
        repository: result.repository,
        pr_number: result.pr_number,
        primary_repository_root: result.primary_repository_root,
        canonical_target: result.canonical_target,
        registrations: result.registrations,
        active: result.active,
        archived: result.archived,
        invalid: result.invalid,
        comparison_platform: platform,
    });
    if (JSON.stringify(expected) !== JSON.stringify(result)) {
        throw new PrReviewLeaseError("discovery disposition correlation mismatch");
    }
    if (result.resume !== null &&
        registrationKeys.filter((entry) => entry ===
            discoveryRegistrationComparablePath(result.resume?.worktree_path ?? "", platform)).length !== 1) {
        throw new PrReviewLeaseError("discovery resume registration mismatch");
    }
    if (result.cleanup !== null &&
        result.cleanup.lease_file !== null &&
        [
            "unsupported-lease-state",
            "terminal-lease",
            "worktree-dirty",
            "unmanaged-ephemeral-artifacts",
        ].includes(result.cleanup.reason) &&
        registrationKeys.filter((entry) => entry ===
            discoveryRegistrationComparablePath(result.cleanup?.worktree_path ?? "", platform)).length !== 1) {
        throw new PrReviewLeaseError("discovery cleanup registration mismatch");
    }
    if (result.cleanup !== null &&
        result.cleanup.lease_file !== null &&
        result.cleanup.reason === "artifact-authority-required") {
        const registrationCount = registrationKeys.filter((entry) => entry ===
            discoveryRegistrationComparablePath(result.cleanup?.worktree_path ?? "", platform)).length;
        if (registrationCount !== 0 && registrationCount !== 1) {
            throw new PrReviewLeaseError("discovery cleanup registration mismatch");
        }
    }
    if (result.cleanup !== null &&
        result.cleanup.lease_file !== null &&
        ["worktree-missing", "worktree-unregistered"].includes(result.cleanup.reason) &&
        registrationKeys.filter((entry) => entry ===
            discoveryRegistrationComparablePath(result.cleanup?.worktree_path ?? "", platform)).length !== 0) {
        throw new PrReviewLeaseError("discovery cleanup registration mismatch");
    }
    return JSON.stringify(result);
}
async function validatePrReviewDiscoveryCommand(contents, identity) {
    const platform = identity.platform ?? process.platform;
    const requestedRoot = discoveryFilesystemPath(identity.primaryRoot, platform);
    const primaryRoot = await realpath(requestedRoot);
    const gitEnv = discoveryGitEnvironment();
    const primaryRepository = await assertDiscoveryPrimaryRoot(primaryRoot, gitEnv);
    await readDiscoveryRepositoryBinding(primaryRoot, primaryRepository, gitEnv, identity.repository);
    const validated = validatePrReviewDiscoveryJson(contents, {
        ...identity,
        primaryRoot,
        platform,
    });
    await assertDiscoveryRoutedWorktreesExcludePrimary(JSON.parse(validated), primaryRoot, primaryRepository, gitEnv, platform);
    return validated;
}
async function assertDiscoveryRoutedWorktreesExcludePrimary(result, primaryRoot, primaryRepository, gitEnv, platform) {
    const routedPaths = [
        ...result.active
            .filter((entry) => entry.classification !== "invalid" && entry.worktree_path !== null)
            .map((entry) => entry.worktree_path),
        ...(result.resume === null ? [] : [result.resume.worktree_path]),
        ...(result.cleanup === null ? [] : [result.cleanup.worktree_path]),
    ];
    const primaryAuthority = discoveryWorktreeAuthorityComparablePath(primaryRoot, platform);
    const inspectedRawPaths = new Set();
    const inspectedPaths = [];
    for (const routedPath of routedPaths) {
        if (inspectedRawPaths.has(routedPath))
            continue;
        inspectedRawPaths.add(routedPath);
        const requestedPath = discoveryFilesystemPath(routedPath, platform);
        let physicalPath;
        try {
            physicalPath = await realpath(requestedPath);
        }
        catch (err) {
            const code = err.code;
            if (code === "ENOENT" || code === "ENOTDIR")
                continue;
            throw new PrReviewLeaseError("discovery worktree authority inspection failed");
        }
        if (discoveryWorktreeAuthorityComparablePath(physicalPath, platform) ===
            primaryAuthority) {
            throw new PrReviewLeaseError("discovery primary worktree authority mismatch");
        }
        inspectedPaths.push({ physicalPath, requestedPath, routedPath });
    }
    for (const { physicalPath, requestedPath, routedPath } of inspectedPaths) {
        const registrationKey = discoveryRegistrationComparablePath(routedPath, platform);
        if (!result.registrations.some((registration) => discoveryRegistrationComparablePath(registration, platform) ===
            registrationKey)) {
            continue;
        }
        try {
            const repository = await readDiscoveryRepositoryIdentity(requestedPath, gitEnv);
            assertDiscoveryCandidateRepository(repository, physicalPath, primaryRepository);
            await readDiscoveryCandidateRepositoryAuthority(physicalPath, repository, primaryRepository);
        }
        catch {
            throw new PrReviewLeaseError("discovery candidate repository authority mismatch");
        }
    }
}
function parseDiscoveryResult(value, platform) {
    if (!isObject(value)) {
        throw new PrReviewLeaseError("discovery result schema mismatch");
    }
    assertDiscoveryKeys(value, [
        "schema",
        "repository",
        "pr_number",
        "primary_repository_root",
        "canonical_target",
        "registrations",
        "active",
        "archived",
        "invalid",
        "disposition",
        "resume",
        "cleanup",
    ]);
    const result = value;
    if (result.schema !== "pr-review/discovery/v1" ||
        typeof result.repository !== "string" ||
        !isSafeGitHubRepository(result.repository) ||
        !Number.isSafeInteger(result.pr_number) ||
        result.pr_number <= 0 ||
        typeof result.primary_repository_root !== "string" ||
        result.primary_repository_root.length === 0 ||
        !["create", "resume", "cleanup-required", "ambiguous", "invalid"].includes(result.disposition)) {
        throw new PrReviewLeaseError("discovery result schema mismatch");
    }
    assertDiscoveryKeys(result.canonical_target, [
        "worktree_path",
        "status",
        "parent_status",
        "registered",
    ]);
    if (typeof result.canonical_target.worktree_path !== "string" ||
        result.canonical_target.worktree_path.length === 0 ||
        !["absent", "directory", "invalid"].includes(result.canonical_target.status) ||
        !["absent", "directory", "invalid"].includes(result.canonical_target.parent_status) ||
        typeof result.canonical_target.registered !== "boolean") {
        throw new PrReviewLeaseError("discovery result schema mismatch");
    }
    if (result.canonical_target.status === "directory" &&
        result.canonical_target.parent_status !== "directory") {
        throw new PrReviewLeaseError("discovery canonical target correlation mismatch");
    }
    assertDiscoveryStringArray(result.registrations);
    assertDiscoveryStringArray(result.archived);
    if (!Array.isArray(result.active) || !Array.isArray(result.invalid)) {
        throw new PrReviewLeaseError("discovery result schema mismatch");
    }
    for (const entry of result.active) {
        validateDiscoveryActiveEntry(entry, result.pr_number, platform);
    }
    for (const entry of result.invalid) {
        assertDiscoveryKeys(entry, ["path", "reason"]);
        if (typeof entry.path !== "string" ||
            entry.path.length === 0 ||
            typeof entry.reason !== "string" ||
            !DISCOVERY_INVALID_REASONS.includes(entry.reason)) {
            throw new PrReviewLeaseError("discovery result schema mismatch");
        }
        assertDiscoveryInvalidEntryCorrelation(entry, result);
    }
    for (const entry of result.archived) {
        if (!isDiscoveryArchivePath(entry, result.pr_number)) {
            throw new PrReviewLeaseError("discovery archived entry mismatch");
        }
    }
    if (new Set(result.active.map((entry) => entry.lease_file)).size !==
        result.active.length ||
        new Set(result.archived).size !== result.archived.length ||
        new Set(result.invalid.map((entry) => entry.path)).size !==
            result.invalid.length ||
        !hasValidDiscoveryWorktreeClaimGroups(result.active, platform) ||
        !sameOrdinalStringArray(result.active.map((entry) => entry.lease_file), ordinalSort(result.active.map((entry) => entry.lease_file))) ||
        !sameOrdinalStringArray(result.archived, ordinalSort(result.archived)) ||
        !sameOrdinalStringArray(result.invalid.map((entry) => entry.path), ordinalSort(result.invalid.map((entry) => entry.path)))) {
        throw new PrReviewLeaseError("discovery result ordering mismatch");
    }
    assertDiscoveryCanonicalTargetCorrelation(result, platform);
    if (result.resume !== null) {
        assertDiscoveryKeys(result.resume, ["lease_file", "worktree_path"]);
        if (typeof result.resume.lease_file !== "string" ||
            result.resume.lease_file.length === 0 ||
            typeof result.resume.worktree_path !== "string" ||
            result.resume.worktree_path.length === 0) {
            throw new PrReviewLeaseError("discovery result schema mismatch");
        }
    }
    if (result.cleanup !== null) {
        assertDiscoveryKeys(result.cleanup, [
            "lease_file",
            "worktree_path",
            "reason",
        ]);
        if ((result.cleanup.lease_file !== null &&
            (typeof result.cleanup.lease_file !== "string" ||
                result.cleanup.lease_file.length === 0)) ||
            typeof result.cleanup.worktree_path !== "string" ||
            result.cleanup.worktree_path.length === 0 ||
            typeof result.cleanup.reason !== "string" ||
            ![
                "artifact-authority-required",
                "unsupported-lease-state",
                "terminal-lease",
                "worktree-missing",
                "worktree-unregistered",
                "worktree-dirty",
                "unmanaged-ephemeral-artifacts",
                "canonical-target-registered",
                "canonical-target-occupied",
            ].includes(result.cleanup.reason)) {
            throw new PrReviewLeaseError("discovery result schema mismatch");
        }
    }
    if (result.active.some((entry) => entry.classification !== "invalid" &&
        entry.worktree_path !== null &&
        discoveryWorktreeAuthorityComparablePath(entry.worktree_path, platform) ===
            discoveryWorktreeAuthorityComparablePath(result.primary_repository_root, platform)) ||
        (result.resume !== null &&
            discoveryWorktreeAuthorityComparablePath(result.resume.worktree_path, platform) ===
                discoveryWorktreeAuthorityComparablePath(result.primary_repository_root, platform)) ||
        (result.cleanup !== null &&
            discoveryWorktreeAuthorityComparablePath(result.cleanup.worktree_path, platform) ===
                discoveryWorktreeAuthorityComparablePath(result.primary_repository_root, platform))) {
        throw new PrReviewLeaseError("discovery primary worktree authority mismatch");
    }
    return result;
}
function hasValidDiscoveryWorktreeClaimGroups(active, platform) {
    const groups = new Map();
    for (const entry of active) {
        if (entry.worktree_path === null)
            continue;
        const key = discoveryComparablePath(entry.worktree_path, platform);
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
    }
    for (const group of groups.values()) {
        if (group.length < 2)
            continue;
        if (group.some((entry) => entry.classification !== "invalid" ||
            entry.reason !== "lease-identity-mismatch" ||
            entry.worktree_path === null ||
            entry.state === null)) {
            return false;
        }
    }
    return true;
}
function validateDiscoveryActiveEntry(entry, prNumber, platform) {
    assertDiscoveryKeys(entry, [
        "lease_file",
        "worktree_path",
        "state",
        "classification",
        "reason",
    ]);
    if (typeof entry.lease_file !== "string" ||
        !new RegExp(`^\\.ephemeral/pr-${prNumber}-[0-9a-f]{64}-lease\\.json$`, "u").test(entry.lease_file) ||
        (entry.worktree_path !== null &&
            (typeof entry.worktree_path !== "string" ||
                !isAbsoluteLeasePath(entry.worktree_path, platform))) ||
        (entry.state !== null &&
            !["created", "reviewed", "gated", "posted", "aborted", "failed"].includes(entry.state)) ||
        ![
            "resumable",
            "terminal",
            "unsupported",
            "artifact-bearing",
            "missing",
            "unregistered",
            "dirty",
            "unmanaged",
            "invalid",
        ].includes(entry.classification) ||
        typeof entry.reason !== "string" ||
        entry.reason.length === 0) {
        throw new PrReviewLeaseError("discovery result schema mismatch");
    }
    if (entry.classification === "invalid" &&
        !DISCOVERY_ACTIVE_INVALID_REASONS.includes(entry.reason)) {
        throw new PrReviewLeaseError("discovery active correlation mismatch");
    }
    if (entry.classification !== "invalid" && entry.worktree_path === null) {
        throw new PrReviewLeaseError("discovery active correlation mismatch");
    }
    if (entry.classification !== "invalid" && entry.state === null) {
        throw new PrReviewLeaseError("discovery active correlation mismatch");
    }
    if (entry.worktree_path !== null &&
        entry.classification !== "invalid" &&
        entry.lease_file !==
            `.ephemeral/pr-${prNumber}-${digestPath(entry.worktree_path)}-lease.json`) {
        throw new PrReviewLeaseError("discovery active correlation mismatch");
    }
    if (entry.classification === "invalid") {
        const identityRequired = [
            "worktree-replaced",
            "repository-identity-changed",
            "status-inspection-failed",
            "worktree-dirty-after-snapshot",
            "lease-identity-mismatch",
            "worktree-inspection-failed",
            "invalid-worktree-entry",
            "worktree-identity-unverifiable",
            "worktree-digest-mismatch",
            "invalid-ephemeral-directory",
            "worktree-repository-mismatch",
        ].includes(entry.reason);
        if ((identityRequired &&
            (entry.worktree_path === null || entry.state === null)) ||
            (entry.reason === "invalid-lease" &&
                (entry.worktree_path !== null || entry.state !== null)) ||
            (entry.reason === "resumable-worktree-path-missing" &&
                entry.worktree_path !== null)) {
            throw new PrReviewLeaseError("discovery active correlation mismatch");
        }
        if (entry.worktree_path !== null &&
            !["lease-identity-mismatch", "worktree-digest-mismatch"].includes(entry.reason) &&
            entry.lease_file !==
                `.ephemeral/pr-${prNumber}-${digestPath(entry.worktree_path)}-lease.json`) {
            throw new PrReviewLeaseError("discovery active correlation mismatch");
        }
    }
    const expectedByClassification = {
        resumable: ["created", "resumable"],
        terminal: [entry.state, "terminal-lease"],
        unsupported: [entry.state, "unsupported-lease-state"],
        "artifact-bearing": [entry.state, "artifact-authority-required"],
        missing: [entry.state, "worktree-missing"],
        unregistered: [entry.state, "worktree-unregistered"],
        dirty: [entry.state, "worktree-dirty"],
        unmanaged: [entry.state, "unmanaged-ephemeral-artifacts"],
    };
    const expected = expectedByClassification[entry.classification];
    if (expected !== undefined &&
        (entry.state !== expected[0] || entry.reason !== expected[1])) {
        throw new PrReviewLeaseError("discovery active correlation mismatch");
    }
    if (entry.classification === "terminal" &&
        entry.state !== "posted" &&
        entry.state !== "aborted") {
        throw new PrReviewLeaseError("discovery active correlation mismatch");
    }
    if (entry.classification === "unsupported" &&
        entry.state !== "reviewed" &&
        entry.state !== "gated" &&
        entry.state !== "failed") {
        throw new PrReviewLeaseError("discovery active correlation mismatch");
    }
}
function assertDiscoveryInvalidEntryCorrelation(entry, result) {
    const selectedPrefix = `.ephemeral/pr-${result.pr_number}-`;
    const directSelectedPrChild = entry.path.startsWith(selectedPrefix) &&
        !entry.path.slice(".ephemeral/".length).includes("/");
    const correlated = entry.reason === "invalid-canonical-target" ||
        entry.reason === "canonical-target-changed"
        ? entry.path === result.canonical_target.worktree_path
        : entry.reason === "invalid-discovery-directory"
            ? entry.path === ".ephemeral"
            : entry.reason === "worktree-registrations-changed"
                ? entry.path === ".git/worktrees"
                : entry.reason === "primary-repository-identity-changed"
                    ? entry.path === ".git"
                    : entry.reason === "invalid-archived-entry"
                        ? directSelectedPrChild &&
                            entry.path.endsWith("-archived-lease.json")
                        : entry.reason === "invalid-lease-name"
                            ? directSelectedPrChild &&
                                entry.path.endsWith("-lease.json") &&
                                !new RegExp(`^\\.ephemeral/pr-${result.pr_number}-[0-9a-f]{64}-lease\\.json$`, "u").test(entry.path)
                            : entry.reason === "discovery-snapshot-changed"
                                ? entry.path === "." ||
                                    (directSelectedPrChild &&
                                        entry.path.endsWith("-lease.json"))
                                : false;
    if (!correlated) {
        throw new PrReviewLeaseError("discovery invalid path correlation mismatch");
    }
}
function assertDiscoveryCanonicalTargetCorrelation(result, platform) {
    const canonicalKey = discoveryComparablePath(result.canonical_target.worktree_path, platform);
    const canonicalActive = result.active.find((entry) => entry.worktree_path !== null &&
        discoveryComparablePath(entry.worktree_path, platform) === canonicalKey);
    if (canonicalActive === undefined ||
        canonicalActive.classification === "invalid") {
        return;
    }
    const target = result.canonical_target;
    const coherent = canonicalActive.classification === "missing"
        ? target.status === "absent"
        : canonicalActive.classification === "unregistered"
            ? target.status === "directory" &&
                target.parent_status === "directory" &&
                !target.registered
            : canonicalActive.classification === "artifact-bearing"
                ? (target.status === "absent" &&
                    !target.registered &&
                    (target.parent_status === "absent" ||
                        target.parent_status === "directory")) ||
                    (target.status === "directory" &&
                        target.parent_status === "directory")
                : target.status === "directory" &&
                    target.parent_status === "directory" &&
                    target.registered;
    if (!coherent) {
        throw new PrReviewLeaseError("discovery canonical target correlation mismatch");
    }
}
function assertDiscoveryKeys(value, keys) {
    if (!isObject(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(value, key))) {
        throw new PrReviewLeaseError("discovery result schema mismatch");
    }
}
function assertDiscoveryStringArray(value) {
    if (!Array.isArray(value) ||
        value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
        throw new PrReviewLeaseError("discovery result schema mismatch");
    }
}
export function reducePrReviewDiscovery(inventory) {
    const active = inventory.active
        .map((entry) => {
        if (entry.classification !== "invalid" && entry.worktree_path === null) {
            return {
                ...entry,
                classification: "invalid",
                reason: "resumable-worktree-path-missing",
            };
        }
        return entry;
    })
        .sort((left, right) => ordinalCompare(left.lease_file, right.lease_file));
    const archived = ordinalSort(inventory.archived);
    const invalid = normalizeDiscoveryInvalidEntries(inventory.invalid);
    const structuralClaims = active.filter((entry) => entry.classification !== "invalid" &&
        entry.classification !== "artifact-bearing");
    const resumable = active.filter((entry) => entry.classification === "resumable");
    const blockers = active.filter((entry) => entry.classification !== "resumable");
    const canonicalKey = discoveryComparablePath(inventory.canonical_target.worktree_path, inventory.comparison_platform);
    const canonicalClaimed = active.some((entry) => entry.worktree_path !== null &&
        discoveryComparablePath(entry.worktree_path, inventory.comparison_platform) === canonicalKey);
    const canonicalActive = active.find((entry) => entry.worktree_path !== null &&
        discoveryComparablePath(entry.worktree_path, inventory.comparison_platform) === canonicalKey);
    const canonicalClaimContradiction = canonicalActive !== undefined &&
        canonicalActive.classification !== "invalid" &&
        (canonicalActive.classification === "missing"
            ? inventory.canonical_target.status !== "absent"
            : canonicalActive.classification === "unregistered"
                ? inventory.canonical_target.status !== "directory" ||
                    inventory.canonical_target.parent_status !== "directory" ||
                    inventory.canonical_target.registered
                : inventory.canonical_target.status !== "directory" ||
                    inventory.canonical_target.parent_status !== "directory" ||
                    !inventory.canonical_target.registered);
    const canonicalBlocked = canonicalClaimContradiction ||
        (inventory.canonical_target.status !== "absent" && !canonicalClaimed) ||
        (inventory.canonical_target.registered && !canonicalClaimed);
    const canonicalInvalid = inventory.canonical_target.parent_status === "invalid" ||
        inventory.canonical_target.status === "invalid";
    let disposition;
    let resume = null;
    let cleanup = null;
    if (invalid.length > 0 ||
        canonicalInvalid ||
        active.some((entry) => entry.classification === "invalid")) {
        disposition = "invalid";
    }
    else if (structuralClaims.length > 1) {
        disposition = "ambiguous";
    }
    else if (blockers.length > 0 || canonicalBlocked) {
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
                    worktree_path: selected.worktree_path,
                    reason: selected.reason,
                };
    }
    else if (resumable.length === 1 && resumable[0].worktree_path !== null) {
        disposition = "resume";
        resume = {
            lease_file: resumable[0].lease_file,
            worktree_path: resumable[0].worktree_path,
        };
    }
    else {
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
function normalizeDiscoveryInvalidEntries(entries) {
    const byPath = new Map();
    for (const entry of entries) {
        const prior = byPath.get(entry.path);
        if (prior === undefined ||
            discoveryInvalidReasonPriority(entry.reason) >
                discoveryInvalidReasonPriority(prior.reason)) {
            byPath.set(entry.path, entry);
        }
    }
    return [...byPath.values()].sort((left, right) => ordinalCompare(left.path, right.path));
}
function discoveryInvalidReasonPriority(reason) {
    return DISCOVERY_INVALID_REASONS.indexOf(reason);
}
async function discoverReviewSession(requestedIdentity) {
    const repository = requestedIdentity?.repository ?? requiredEnv("REPOSITORY");
    if (!isSafeGitHubRepository(repository)) {
        throw new PrReviewLeaseError("REPOSITORY must use owner/name form");
    }
    const prNumber = requestedIdentity?.prNumber ??
        parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
    const requestedRoot = discoveryFilesystemPath(requestedIdentity?.primaryRoot ?? requiredEnv("PRIMARY_REPOSITORY_ROOT"));
    const primaryRoot = await realpath(requestedRoot);
    const gitEnv = discoveryGitEnvironment();
    const primaryRepository = await assertDiscoveryPrimaryRoot(primaryRoot, gitEnv);
    const primaryRepositoryBinding = await readDiscoveryRepositoryBinding(primaryRoot, primaryRepository, gitEnv, repository);
    let first;
    try {
        first = await collectDiscoverySession({
            repository,
            prNumber,
            primaryRoot,
            gitEnv,
            primaryRepository,
            primaryRepositoryBinding,
        });
    }
    catch {
        return discoveryCollectionFailure(repository, prNumber, primaryRoot);
    }
    let second;
    try {
        second = await collectDiscoverySession({
            repository,
            prNumber,
            primaryRoot,
            gitEnv,
            primaryRepository,
            primaryRepositoryBinding,
        });
    }
    catch {
        return reducePrReviewDiscovery({
            ...first.inventory,
            invalid: [
                ...first.inventory.invalid,
                {
                    path: ".",
                    reason: "discovery-snapshot-changed",
                },
            ],
            comparison_platform: process.platform,
        });
    }
    if (JSON.stringify(first.inventory) !== JSON.stringify(second.inventory) ||
        JSON.stringify(first.authority) !== JSON.stringify(second.authority)) {
        return reducePrReviewDiscovery({
            ...correlateDiscoveryCollectionMismatch(first, second),
            comparison_platform: process.platform,
        });
    }
    return reducePrReviewDiscovery({
        ...second.inventory,
        comparison_platform: process.platform,
    });
}
function correlateDiscoveryCollectionMismatch(first, second) {
    const inventory = structuredClone(second.inventory);
    const firstAuthority = new Map(first.authority.map((record) => [record.key, record.value]));
    const secondAuthority = new Map(second.authority.map((record) => [record.key, record.value]));
    const keys = new Set([...firstAuthority.keys(), ...secondAuthority.keys()]);
    let correlated = false;
    const invalidatedActive = new Set();
    const addInvalid = (pathValue, reason) => {
        correlated = true;
        const index = inventory.invalid.findIndex((entry) => entry.path === pathValue);
        if (index < 0) {
            inventory.invalid.push({ path: pathValue, reason });
        }
        else if (discoveryInvalidReasonPriority(reason) >
            discoveryInvalidReasonPriority(inventory.invalid[index].reason)) {
            inventory.invalid[index] = { path: pathValue, reason };
        }
    };
    const invalidateActive = (leaseFile, reason) => {
        correlated = true;
        if (invalidatedActive.has(leaseFile))
            return;
        invalidatedActive.add(leaseFile);
        const index = inventory.active.findIndex((entry) => entry.lease_file === leaseFile);
        const prior = first.inventory.active.find((entry) => entry.lease_file === leaseFile);
        if (index >= 0) {
            inventory.active[index] = {
                ...inventory.active[index],
                classification: "invalid",
                reason,
            };
        }
        else if (prior !== undefined) {
            inventory.active.push({
                ...prior,
                classification: "invalid",
                reason,
            });
        }
        else {
            addInvalid(leaseFile, "discovery-snapshot-changed");
        }
    };
    for (const key of keys) {
        if (firstAuthority.get(key) === secondAuthority.get(key))
            continue;
        if (key === "registrations") {
            addInvalid(".git/worktrees", "worktree-registrations-changed");
        }
        else if (key === "primary-ephemeral") {
            addInvalid(".ephemeral", "invalid-discovery-directory");
        }
        else if (key === "primary-repository" || key === "primary-origin") {
            addInvalid(".git", "primary-repository-identity-changed");
        }
        else if (key === "canonical-parent" || key === "canonical-target") {
            addInvalid(inventory.canonical_target.worktree_path, "canonical-target-changed");
        }
        else if (key.startsWith("lease:")) {
            invalidateActive(key.slice("lease:".length), "lease-replaced");
        }
        else if (key.startsWith("candidate-repository:")) {
            invalidateActive(key.slice("candidate-repository:".length), "repository-identity-changed");
        }
        else if (key.startsWith("candidate:")) {
            invalidateActive(key.slice("candidate:".length), "worktree-replaced");
        }
        else if (key.startsWith("candidate-status:")) {
            const leaseFile = key.slice("candidate-status:".length);
            const before = first.inventory.active.find((entry) => entry.lease_file === leaseFile);
            const after = second.inventory.active.find((entry) => entry.lease_file === leaseFile);
            invalidateActive(leaseFile, before?.classification === "resumable" &&
                after?.classification === "dirty"
                ? "worktree-dirty-after-snapshot"
                : "status-inspection-failed");
        }
    }
    if (!correlated) {
        addInvalid(".", "discovery-snapshot-changed");
    }
    return inventory;
}
function discoveryCollectionFailure(repository, prNumber, primaryRoot) {
    return reducePrReviewDiscovery({
        repository,
        pr_number: prNumber,
        primary_repository_root: primaryRoot,
        canonical_target: {
            worktree_path: path.join(primaryRoot, ".worktrees", `pr-${prNumber}-review`),
            status: "invalid",
            registered: false,
            parent_status: "invalid",
        },
        registrations: [],
        active: [],
        archived: [],
        invalid: [{ path: ".", reason: "discovery-snapshot-changed" }],
        comparison_platform: process.platform,
    });
}
async function collectDiscoverySession({ repository, prNumber, primaryRoot, gitEnv, primaryRepository, primaryRepositoryBinding, }) {
    const authority = [];
    const collectedPrimaryRepository = await readDiscoveryRepositoryIdentity(primaryRoot, gitEnv);
    if (!sameDiscoveryRepositoryIdentity(collectedPrimaryRepository, primaryRepository) ||
        discoveryComparablePath(collectedPrimaryRepository.top_level, process.platform) !== discoveryComparablePath(primaryRoot, process.platform)) {
        throw new PrReviewLeaseError("primary repository identity changed during collection");
    }
    authority.push({
        key: "primary-repository",
        value: discoveryRepositoryIdentityFingerprint(collectedPrimaryRepository),
    });
    const collectedRepositoryBinding = await readDiscoveryRepositoryBinding(primaryRoot, collectedPrimaryRepository, gitEnv, repository);
    if (collectedRepositoryBinding.repository !==
        primaryRepositoryBinding.repository ||
        collectedRepositoryBinding.config_fingerprint !==
            primaryRepositoryBinding.config_fingerprint) {
        throw new PrReviewLeaseError("primary repository origin changed during collection");
    }
    authority.push({
        key: "primary-origin",
        value: `${collectedRepositoryBinding.repository}\0${collectedRepositoryBinding.config_fingerprint}`,
    });
    const registrations = await readDiscoveryWorktreeRegistrations(primaryRoot, gitEnv);
    const registrationSnapshot = discoveryRegistrationSnapshot(registrations, process.platform);
    authority.push({
        key: "registrations",
        value: JSON.stringify(registrationSnapshot),
    });
    const registrationKeys = new Set(registrationSnapshot);
    const canonicalPath = path.join(primaryRoot, ".worktrees", `pr-${prNumber}-review`);
    const parentSnapshot = await observeStableDiscoveryPathSnapshot(path.dirname(canonicalPath), true);
    const parentObservation = parentSnapshot.status;
    const targetSnapshot = parentObservation === "directory"
        ? await observeStableDiscoveryPathSnapshot(canonicalPath, true)
        : { status: "absent", identity: null };
    const targetObservation = targetSnapshot.status;
    authority.push({
        key: "canonical-parent",
        value: stableDiscoveryPathFingerprint(parentSnapshot),
    }, {
        key: "canonical-target",
        value: stableDiscoveryPathFingerprint(targetSnapshot),
    });
    const canonicalTarget = {
        worktree_path: canonicalPath,
        status: targetObservation === "absent"
            ? "absent"
            : targetObservation === "directory"
                ? "directory"
                : "invalid",
        registered: registrationKeys.has(discoveryRegistrationComparablePath(canonicalPath, process.platform)),
        parent_status: parentObservation === "absent"
            ? "absent"
            : parentObservation === "directory"
                ? "directory"
                : "invalid",
    };
    const active = [];
    const activeInspections = [];
    const archived = [];
    const invalid = [];
    if (registrationKeys.size !== registrationSnapshot.length) {
        invalid.push({
            path: ".git/worktrees",
            reason: "worktree-registrations-changed",
        });
    }
    if (canonicalTarget.parent_status === "invalid" ||
        canonicalTarget.status === "invalid") {
        invalid.push({
            path: canonicalPath,
            reason: "invalid-canonical-target",
        });
    }
    const ephemeralPath = path.join(primaryRoot, ".ephemeral");
    let entries = [];
    let ephemeralSnapshot = null;
    try {
        ephemeralSnapshot = await readStableDiscoveryDirectory(ephemeralPath);
        entries = ephemeralSnapshot?.entries ?? [];
        authority.push({
            key: "primary-ephemeral",
            value: stableDiscoveryDirectoryFingerprint(ephemeralSnapshot),
        });
    }
    catch {
        authority.push({ key: "primary-ephemeral", value: "invalid" });
        invalid.push({
            path: ".ephemeral",
            reason: "invalid-discovery-directory",
        });
    }
    const activeName = new RegExp(`^pr-${prNumber}-[0-9a-f]{64}-lease\\.json$`, "u");
    const archiveName = new RegExp(`^pr-${prNumber}-[0-9a-f]{64}-([0-9]{8}T[0-9]{6})-(posted|aborted)-archived-lease\\.json$`, "u");
    const prPrefix = `pr-${prNumber}-`;
    for (const entry of entries) {
        if (!entry.startsWith(prPrefix))
            continue;
        const relativePath = `.ephemeral/${entry}`;
        const absolutePath = path.join(ephemeralPath, entry);
        const archiveMatch = entry.match(archiveName);
        if (archiveMatch !== null && isValidCompactUtcTimestamp(archiveMatch[1])) {
            if ((await observeStableDiscoveryPath(absolutePath, false)) === "file") {
                archived.push(relativePath);
            }
            else {
                invalid.push({ path: relativePath, reason: "invalid-archived-entry" });
            }
            continue;
        }
        if (entry.endsWith("-archived-lease.json")) {
            invalid.push({ path: relativePath, reason: "invalid-archived-entry" });
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
                primaryRepository: collectedPrimaryRepository,
                authority,
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
            if ((await observeStableDiscoveryPath(ephemeralPath, true)) !== "absent") {
                throw new PrReviewLeaseError("discovery directory appeared during inspection");
            }
        }
        else {
            await assertSameDiscoveryDirectory(ephemeralPath, ephemeralSnapshot);
        }
    }
    catch {
        if (!invalid.some((entry) => entry.path === ".ephemeral")) {
            invalid.push({
                path: ".ephemeral",
                reason: "invalid-discovery-directory",
            });
        }
    }
    const reconcileGlobalSnapshot = async () => {
        try {
            const finalRegistrations = await readDiscoveryWorktreeRegistrations(primaryRoot, gitEnv);
            if (!sameOrdinalStringArray(discoveryRegistrationSnapshot(registrations, process.platform), discoveryRegistrationSnapshot(finalRegistrations, process.platform))) {
                throw new PrReviewLeaseError("worktree registrations changed during inspection");
            }
        }
        catch {
            if (!invalid.some((entry) => entry.path === ".git/worktrees" &&
                entry.reason === "worktree-registrations-changed")) {
                invalid.push({
                    path: ".git/worktrees",
                    reason: "worktree-registrations-changed",
                });
            }
        }
        try {
            const finalPrimaryRepository = await readDiscoveryRepositoryIdentity(primaryRoot, gitEnv);
            if (!sameDiscoveryRepositoryIdentity(finalPrimaryRepository, collectedPrimaryRepository) ||
                discoveryComparablePath(finalPrimaryRepository.top_level, process.platform) !== discoveryComparablePath(primaryRoot, process.platform)) {
                throw new PrReviewLeaseError("primary repository identity changed during inspection");
            }
        }
        catch {
            if (!invalid.some((entry) => entry.path === ".git")) {
                invalid.push({
                    path: ".git",
                    reason: "primary-repository-identity-changed",
                });
            }
            for (let index = 0; index < active.length; index += 1) {
                if (active[index].classification !== "invalid") {
                    active[index] = {
                        ...active[index],
                        classification: "invalid",
                        reason: "repository-identity-changed",
                    };
                }
            }
        }
        try {
            if (ephemeralSnapshot === null) {
                if ((await observeStableDiscoveryPath(ephemeralPath, true)) !== "absent") {
                    throw new PrReviewLeaseError("discovery directory appeared during final inspection");
                }
            }
            else {
                await assertSameDiscoveryDirectory(ephemeralPath, ephemeralSnapshot);
            }
        }
        catch {
            if (!invalid.some((entry) => entry.path === ".ephemeral")) {
                invalid.push({
                    path: ".ephemeral",
                    reason: "invalid-discovery-directory",
                });
            }
        }
        const finalParentSnapshot = await observeStableDiscoveryPathSnapshot(path.dirname(canonicalPath), true);
        const finalTargetSnapshot = finalParentSnapshot.status === "directory"
            ? await observeStableDiscoveryPathSnapshot(canonicalPath, true)
            : { status: "absent", identity: null };
        if (!sameStableDiscoveryPath(parentSnapshot, finalParentSnapshot) ||
            !sameStableDiscoveryPath(targetSnapshot, finalTargetSnapshot)) {
            if (!invalid.some((entry) => entry.path === canonicalPath)) {
                invalid.push({
                    path: canonicalPath,
                    reason: "canonical-target-changed",
                });
            }
        }
    };
    // Complete this scan in authority order: global state first, then every
    // retained candidate. The caller compares two complete scans and performs
    // only pure comparison and reduction after the second scan returns.
    await reconcileGlobalSnapshot();
    for (let index = 0; index < activeInspections.length; index += 1) {
        active[index] = await activeInspections[index].verifySnapshot();
    }
    invalidateDuplicateDiscoveryWorktreeClaims(active);
    return {
        inventory: {
            repository,
            pr_number: prNumber,
            primary_repository_root: primaryRoot,
            canonical_target: canonicalTarget,
            registrations,
            active,
            archived,
            invalid,
        },
        authority,
    };
}
export function invalidateDuplicateDiscoveryWorktreeClaims(active, platform = process.platform) {
    const counts = new Map();
    for (const entry of active) {
        if (entry.worktree_path === null)
            continue;
        const key = discoveryComparablePath(entry.worktree_path, platform);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (let index = 0; index < active.length; index += 1) {
        const entry = active[index];
        if (entry.worktree_path !== null &&
            (counts.get(discoveryComparablePath(entry.worktree_path, platform)) ??
                0) > 1) {
            active[index] = {
                lease_file: entry.lease_file,
                worktree_path: entry.worktree_path,
                state: entry.state,
                classification: "invalid",
                reason: "lease-identity-mismatch",
            };
        }
    }
}
function isValidCompactUtcTimestamp(value) {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/u);
    if (match === null)
        return false;
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
    return (!Number.isNaN(date.valueOf()) &&
        date.toISOString().replace(/[-:]/gu, "").slice(0, 15) === value);
}
function isDiscoveryArchivePath(value, prNumber) {
    const match = value.match(new RegExp(`^\\.ephemeral/pr-${prNumber}-[0-9a-f]{64}-([0-9]{8}T[0-9]{6})-(posted|aborted)-archived-lease\\.json$`, "u"));
    return match !== null && isValidCompactUtcTimestamp(match[1]);
}
async function inspectDiscoveryLease({ primaryRoot, relativePath, repository, prNumber, registrationKeys, gitEnv, primaryRepository, authority, }) {
    const invalid = (reason, lease) => ({
        lease_file: relativePath,
        worktree_path: lease?.worktree_path ?? null,
        state: lease?.state ?? null,
        classification: "invalid",
        reason,
    });
    const fixed = (entry) => ({
        entry,
        verifyFinal: async () => entry,
        verifySnapshot: async () => entry,
    });
    let lease;
    let leaseSnapshot;
    const leasePath = path.join(primaryRoot, relativePath);
    try {
        leaseSnapshot = await readStableDiscoveryFile(leasePath);
        authority.push({
            key: `lease:${relativePath}`,
            value: stableDiscoveryFileFingerprint(leaseSnapshot),
        });
    }
    catch {
        authority.push({ key: `lease:${relativePath}`, value: "invalid" });
        return fixed(invalid("invalid-lease"));
    }
    try {
        const leaseText = decodeDiscoveryJson(leaseSnapshot.contents);
        assertNoDuplicateJsonKeys(leaseText);
        lease = parseDiscoveryLease(JSON.parse(leaseText));
    }
    catch {
        const entry = invalid("invalid-lease");
        return {
            entry,
            verifyFinal: async () => {
                try {
                    await assertSameDiscoveryFile(leasePath, leaseSnapshot);
                    return entry;
                }
                catch {
                    return invalid("lease-replaced");
                }
            },
            verifySnapshot: async () => {
                try {
                    await assertSameDiscoveryFile(leasePath, leaseSnapshot);
                    return entry;
                }
                catch {
                    return invalid("lease-replaced");
                }
            },
        };
    }
    let verifyCandidateFinal = async () => { };
    let verifyCandidateRepositoryFinal = async () => { };
    let candidateRepositoryBound = false;
    const finalize = async (entry) => {
        const verifyFinal = async () => {
            try {
                await assertSameDiscoveryFile(leasePath, leaseSnapshot);
            }
            catch {
                return invalid("lease-replaced", lease);
            }
            try {
                await verifyCandidateFinal();
            }
            catch {
                return invalid("worktree-replaced", lease);
            }
            if (candidateRepositoryBound) {
                try {
                    await verifyCandidateRepositoryFinal();
                }
                catch {
                    return invalid("repository-identity-changed", lease);
                }
            }
            if (entry.classification === "resumable") {
                let finalDirty;
                try {
                    finalDirty = (await discoveryWorktreeDirty(discoveryFilesystemPath(lease.worktree_path), gitEnv)).dirty;
                }
                catch {
                    return invalid("status-inspection-failed", lease);
                }
                try {
                    await assertSameDiscoveryFile(leasePath, leaseSnapshot);
                }
                catch {
                    return invalid("lease-replaced", lease);
                }
                try {
                    await verifyCandidateFinal();
                }
                catch {
                    return invalid("worktree-replaced", lease);
                }
                try {
                    await verifyCandidateRepositoryFinal();
                }
                catch {
                    return invalid("repository-identity-changed", lease);
                }
                if (finalDirty) {
                    return invalid("worktree-dirty-after-snapshot", lease);
                }
            }
            return entry;
        };
        const verified = await verifyFinal();
        return verified === entry
            ? {
                entry,
                verifyFinal,
                verifySnapshot: verifyFinal,
            }
            : fixed(verified);
    };
    const expectedLeaseFile = `.ephemeral/pr-${prNumber}-${lease.worktree_digest}-lease.json`;
    if (lease.repository !== repository ||
        lease.pr_number !== prNumber ||
        lease.lease_file !== relativePath ||
        lease.lease_file !== expectedLeaseFile) {
        return finalize(invalid("lease-identity-mismatch", lease));
    }
    const hasDeclaredArtifacts = Object.values(lease.artifacts).some((artifactPath) => artifactPath !== null);
    const filesystemPath = discoveryFilesystemPath(lease.worktree_path);
    let before;
    try {
        before = await lstat(filesystemPath);
    }
    catch (err) {
        if (err.code === "ENOENT") {
            authority.push({ key: `candidate:${relativePath}`, value: "absent" });
            verifyCandidateFinal = async () => {
                if ((await observeStableDiscoveryPath(filesystemPath, true)) !== "absent") {
                    throw new PrReviewLeaseError("candidate worktree appeared during inspection");
                }
            };
            if (registrationKeys.has(discoveryRegistrationComparablePath(lease.worktree_path, process.platform))) {
                return finalize(invalid("worktree-inspection-failed", lease));
            }
            if (hasDeclaredArtifacts) {
                return finalize(discoveryEntry(lease, "artifact-bearing", "artifact-authority-required"));
            }
            return finalize(discoveryEntry(lease, "missing", "worktree-missing"));
        }
        authority.push({
            key: `candidate:${relativePath}`,
            value: "inspection-failed",
        });
        return finalize(invalid("worktree-inspection-failed", lease));
    }
    if (before.isSymbolicLink() || !before.isDirectory()) {
        authority.push({
            key: `candidate:${relativePath}`,
            value: discoveryStatFingerprint(before),
        });
        return finalize(invalid("invalid-worktree-entry", lease));
    }
    let physicalWorktree;
    try {
        physicalWorktree = await realpath(filesystemPath);
    }
    catch {
        return finalize(invalid("worktree-identity-unverifiable", lease));
    }
    if (discoveryComparablePath(physicalWorktree, process.platform) !==
        discoveryComparablePath(lease.worktree_path, process.platform) ||
        digestPath(physicalWorktree) !== lease.worktree_digest) {
        authority.push({
            key: `candidate:${relativePath}`,
            value: `${discoveryStatFingerprint(before)}:${physicalWorktree}`,
        });
        return finalize(invalid("worktree-digest-mismatch", lease));
    }
    let ephemeralSnapshot;
    try {
        ephemeralSnapshot = await readStableDiscoveryDirectory(path.join(filesystemPath, ".ephemeral"));
        await assertSameDiscoveryDirectoryIdentity(filesystemPath, before);
        authority.push({
            key: `candidate:${relativePath}`,
            value: `${discoveryStatFingerprint(before)}:${physicalWorktree}:${stableDiscoveryDirectoryFingerprint(ephemeralSnapshot)}`,
        });
    }
    catch {
        authority.push({
            key: `candidate:${relativePath}`,
            value: "invalid-ephemeral",
        });
        return finalize(invalid("invalid-ephemeral-directory", lease));
    }
    verifyCandidateFinal = async () => {
        await assertSameDiscoveryDirectoryIdentity(filesystemPath, before);
        const finalPhysicalWorktree = await realpath(filesystemPath);
        if (discoveryComparablePath(finalPhysicalWorktree, process.platform) !==
            discoveryComparablePath(physicalWorktree, process.platform) ||
            discoveryComparablePath(finalPhysicalWorktree, process.platform) !==
                discoveryComparablePath(lease.worktree_path, process.platform) ||
            digestPath(finalPhysicalWorktree) !== lease.worktree_digest) {
            throw new PrReviewLeaseError("candidate worktree identity changed during inspection");
        }
        const candidateEphemeral = path.join(filesystemPath, ".ephemeral");
        if (ephemeralSnapshot === null) {
            if ((await observeStableDiscoveryPath(candidateEphemeral, true)) !==
                "absent") {
                throw new PrReviewLeaseError("candidate ephemeral directory appeared during inspection");
            }
        }
        else {
            await assertSameDiscoveryDirectory(candidateEphemeral, ephemeralSnapshot);
        }
    };
    const verifyCandidateSnapshot = verifyCandidateFinal;
    if (!registrationKeys.has(discoveryRegistrationComparablePath(lease.worktree_path, process.platform))) {
        try {
            await verifyCandidateSnapshot();
        }
        catch {
            return finalize(invalid("worktree-replaced", lease));
        }
        if (hasDeclaredArtifacts) {
            return finalize(discoveryEntry(lease, "artifact-bearing", "artifact-authority-required"));
        }
        return finalize(discoveryEntry(lease, "unregistered", "worktree-unregistered"));
    }
    let candidateRepository;
    let candidateRepositoryAuthority;
    let candidateRepositoryBinding;
    try {
        candidateRepository = await readDiscoveryRepositoryIdentity(filesystemPath, gitEnv);
        assertDiscoveryCandidateRepository(candidateRepository, physicalWorktree, primaryRepository);
        candidateRepositoryAuthority =
            await readDiscoveryCandidateRepositoryAuthority(physicalWorktree, candidateRepository, primaryRepository);
        candidateRepositoryBinding = await readDiscoveryRepositoryBinding(filesystemPath, candidateRepository, gitEnv, repository);
        authority.push({
            key: `candidate-repository:${relativePath}`,
            value: `${discoveryRepositoryIdentityFingerprint(candidateRepository)}\0${candidateRepositoryAuthority.fingerprint}\0${candidateRepositoryBinding.repository}\0${candidateRepositoryBinding.config_fingerprint}`,
        });
    }
    catch {
        authority.push({
            key: `candidate-repository:${relativePath}`,
            value: "invalid",
        });
        return finalize(invalid("worktree-repository-mismatch", lease));
    }
    verifyCandidateRepositoryFinal = async () => {
        const currentPrimary = await readDiscoveryRepositoryIdentity(primaryRoot, gitEnv);
        if (!sameDiscoveryRepositoryIdentity(currentPrimary, primaryRepository) ||
            discoveryComparablePath(currentPrimary.top_level, process.platform) !==
                discoveryComparablePath(primaryRoot, process.platform)) {
            throw new PrReviewLeaseError("primary repository identity changed during inspection");
        }
        const current = await readDiscoveryRepositoryIdentity(filesystemPath, gitEnv);
        assertDiscoveryCandidateRepository(current, physicalWorktree, currentPrimary);
        const currentAuthority = await readDiscoveryCandidateRepositoryAuthority(physicalWorktree, current, currentPrimary);
        const currentBinding = await readDiscoveryRepositoryBinding(filesystemPath, current, gitEnv, repository);
        if (!sameDiscoveryRepositoryIdentity(current, candidateRepository) ||
            currentAuthority.fingerprint !==
                candidateRepositoryAuthority.fingerprint ||
            discoveryComparablePath(current.common_directory, process.platform) !==
                discoveryComparablePath(primaryRepository.common_directory, process.platform) ||
            currentBinding.repository !== candidateRepositoryBinding.repository ||
            currentBinding.config_fingerprint !==
                candidateRepositoryBinding.config_fingerprint) {
            throw new PrReviewLeaseError("candidate repository identity changed during inspection");
        }
    };
    candidateRepositoryBound = true;
    if (hasDeclaredArtifacts) {
        try {
            await verifyCandidateSnapshot();
        }
        catch {
            return finalize(invalid("worktree-replaced", lease));
        }
        return finalize(discoveryEntry(lease, "artifact-bearing", "artifact-authority-required"));
    }
    if ((ephemeralSnapshot?.entries ?? []).length > 0) {
        try {
            await verifyCandidateSnapshot();
        }
        catch {
            return finalize(invalid("worktree-replaced", lease));
        }
        return finalize(discoveryEntry(lease, "unmanaged", "unmanaged-ephemeral-artifacts"));
    }
    let statusObservation;
    try {
        statusObservation = await discoveryWorktreeDirty(filesystemPath, gitEnv);
        authority.push({
            key: `candidate-status:${relativePath}`,
            value: `${statusObservation.dirty ? "dirty" : "clean"}:${statusObservation.authority}`,
        });
    }
    catch {
        authority.push({
            key: `candidate-status:${relativePath}`,
            value: "invalid",
        });
        try {
            await verifyCandidateSnapshot();
        }
        catch {
            return finalize(invalid("worktree-replaced", lease));
        }
        return finalize(invalid("status-inspection-failed", lease));
    }
    try {
        await verifyCandidateSnapshot();
    }
    catch {
        return finalize(invalid("worktree-replaced", lease));
    }
    if (statusObservation.dirty) {
        return finalize(discoveryEntry(lease, "dirty", "worktree-dirty"));
    }
    if (lease.state === "posted" || lease.state === "aborted") {
        return finalize(discoveryEntry(lease, "terminal", "terminal-lease"));
    }
    if (lease.state !== "created") {
        return finalize(discoveryEntry(lease, "unsupported", "unsupported-lease-state"));
    }
    return finalize(discoveryEntry(lease, "resumable", "resumable"));
}
function discoveryEntry(lease, classification, reason) {
    return {
        lease_file: lease.lease_file,
        worktree_path: lease.worktree_path,
        state: lease.state,
        classification,
        reason,
    };
}
export function parseDiscoveryLease(value) {
    assertClosedLeasePrimitiveShape(value);
    validateLeaseShape(value);
    if (value.state === "created" &&
        (value.presentation.presented_at !== null ||
            value.presentation.status !== null ||
            value.terminal.finished_at !== null ||
            value.terminal.reason !== null ||
            value.failure.phase !== null ||
            value.failure.reason !== null ||
            value.failure.recoverability !== null ||
            value.github.github_post_attempted ||
            value.github.github_post_result !== "not-attempted" ||
            value.github.github_posted_at !== null)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    return value;
}
function decodeDiscoveryJson(contents) {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(contents);
    }
    catch {
        throw new PrReviewLeaseError("discovery lease is not valid UTF-8");
    }
}
function assertNoDuplicateJsonKeys(source) {
    let index = 0;
    const whitespace = /\s/u;
    const skipWhitespace = () => {
        while (index < source.length && whitespace.test(source[index] ?? "")) {
            index += 1;
        }
    };
    const readString = () => {
        const start = index;
        index += 1;
        while (index < source.length) {
            const char = source[index];
            if (char === "\\") {
                index += 2;
                continue;
            }
            index += 1;
            if (char === '"') {
                return JSON.parse(source.slice(start, index));
            }
        }
        throw new PrReviewLeaseError("lease schema mismatch");
    };
    const readValue = () => {
        skipWhitespace();
        const char = source[index];
        if (char === "{") {
            index += 1;
            const keys = new Set();
            skipWhitespace();
            if (source[index] === "}") {
                index += 1;
                return;
            }
            while (index < source.length) {
                skipWhitespace();
                if (source[index] !== '"') {
                    throw new PrReviewLeaseError("lease schema mismatch");
                }
                const key = readString();
                if (keys.has(key)) {
                    throw new PrReviewLeaseError("duplicate discovery lease key");
                }
                keys.add(key);
                skipWhitespace();
                if (source[index] !== ":") {
                    throw new PrReviewLeaseError("lease schema mismatch");
                }
                index += 1;
                readValue();
                skipWhitespace();
                if (source[index] === "}") {
                    index += 1;
                    return;
                }
                if (source[index] !== ",") {
                    throw new PrReviewLeaseError("lease schema mismatch");
                }
                index += 1;
            }
            throw new PrReviewLeaseError("lease schema mismatch");
        }
        if (char === "[") {
            index += 1;
            skipWhitespace();
            if (source[index] === "]") {
                index += 1;
                return;
            }
            while (index < source.length) {
                readValue();
                skipWhitespace();
                if (source[index] === "]") {
                    index += 1;
                    return;
                }
                if (source[index] !== ",") {
                    throw new PrReviewLeaseError("lease schema mismatch");
                }
                index += 1;
            }
            throw new PrReviewLeaseError("lease schema mismatch");
        }
        if (char === '"') {
            readString();
            return;
        }
        const start = index;
        while (index < source.length && !/[,\]}\s]/u.test(source[index] ?? "")) {
            index += 1;
        }
        if (start === index) {
            throw new PrReviewLeaseError("lease schema mismatch");
        }
    };
    readValue();
    skipWhitespace();
    if (index !== source.length) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
}
function assertClosedLeasePrimitiveShape(value) {
    if (!isObject(value))
        throw new PrReviewLeaseError("lease schema mismatch");
    assertExactKeys(value, [
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
    ], ["cleanup"]);
    const lease = value;
    if (lease.schema !== "pr-review/lease/v1" ||
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
        typeof lease.updated_at !== "string") {
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
    if ((lease.validation.result_manifest.status !== null &&
        lease.validation.result_manifest.status !== "valid") ||
        !nullableString(lease.validation.result_manifest.validated_at) ||
        !nullableString(lease.validation.result_manifest.sha256)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertExactObject(lease.presentation, ["presented_at", "status"]);
    if (!nullableString(lease.presentation.presented_at) ||
        (lease.presentation.status !== null &&
            lease.presentation.status !== "preview-current" &&
            lease.presentation.status !== "edited")) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertExactObject(lease.terminal, ["finished_at", "reason"]);
    if (!nullableString(lease.terminal.finished_at) ||
        !nullableString(lease.terminal.reason)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertExactObject(lease.failure, ["phase", "reason", "recoverability"]);
    if ((lease.failure.phase !== null &&
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
            !["recoverable", "unrecoverable", "unknown"].includes(lease.failure.recoverability))) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    assertExactObject(lease.github, [
        "github_post_attempted",
        "github_post_result",
        "github_posted_at",
    ]);
    if (typeof lease.github.github_post_attempted !== "boolean" ||
        !["succeeded", "failed", "not-attempted"].includes(lease.github.github_post_result) ||
        !nullableString(lease.github.github_posted_at)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.cleanup !== undefined) {
        assertExactKeys(lease.cleanup, ["last_outcome", "last_checked_at"], ["removed_at"]);
        if ((lease.cleanup.last_outcome !== null &&
            !["removed", "retained", "skipped", "failed"].includes(lease.cleanup.last_outcome)) ||
            !nullableString(lease.cleanup.last_checked_at) ||
            !nullableString(lease.cleanup.removed_at ?? null)) {
            throw new PrReviewLeaseError("lease schema mismatch");
        }
    }
}
function assertExactObject(value, required) {
    if (!isObject(value))
        throw new PrReviewLeaseError("lease schema mismatch");
    assertExactKeys(value, required);
}
function assertExactKeys(value, required, optional = []) {
    const actual = Object.keys(value).sort(ordinalCompare);
    const allowed = new Set([...required, ...optional]);
    if (required.some((key) => !Object.hasOwn(value, key)) ||
        actual.some((key) => !allowed.has(key))) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
}
function nullableString(value) {
    return value === null || typeof value === "string";
}
function isAbsoluteLeasePath(value, platform = process.platform) {
    if (/^\/[A-Za-z]\//u.test(value) && platform === "win32") {
        return false;
    }
    return (path.isAbsolute(value) ||
        /^[A-Za-z]:[\\/]/u.test(value) ||
        /^\\\\[^\\]+\\[^\\]+/u.test(value) ||
        /^\/\/[^/]+\/[^/]+/u.test(value));
}
async function readStableDiscoveryFile(file) {
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
        const contents = await handle.readFile();
        const after = await lstat(file);
        if (!sameDiscoveryIdentity(before, after) || after.isSymbolicLink()) {
            throw new PrReviewLeaseError("discovery lease changed during read");
        }
        return {
            contents,
            sha256: createHash("sha256").update(contents).digest("hex"),
            identity: before,
        };
    }
    finally {
        await handle.close();
    }
}
async function assertSameDiscoveryFile(file, expected) {
    const actual = await readStableDiscoveryFile(file);
    if (!sameDiscoveryFileIdentity(expected.identity, actual.identity) ||
        expected.sha256 !== actual.sha256 ||
        !expected.contents.equals(actual.contents)) {
        throw new PrReviewLeaseError("discovery lease changed during inspection");
    }
}
async function readStableDiscoveryDirectory(directory) {
    let before;
    try {
        before = await lstat(directory);
    }
    catch (err) {
        if (err.code === "ENOENT")
            return null;
        throw err;
    }
    if (before.isSymbolicLink() || !before.isDirectory()) {
        throw new PrReviewLeaseError("discovery directory is not a real directory");
    }
    const entries = ordinalSort(await readdir(directory));
    const entryKinds = await readDiscoveryEntryKinds(directory, entries);
    const after = await lstat(directory);
    const finalEntries = ordinalSort(await readdir(directory));
    if (after.isSymbolicLink() ||
        !after.isDirectory() ||
        !sameDiscoveryIdentity(before, after) ||
        !sameOrdinalStringArray(entries, finalEntries)) {
        throw new PrReviewLeaseError("discovery directory changed during inspection");
    }
    return { entries, entry_kinds: entryKinds, identity: before };
}
async function assertSameDiscoveryDirectory(directory, expected) {
    const actual = await lstat(directory);
    if (actual.isSymbolicLink() ||
        !actual.isDirectory() ||
        !sameDiscoveryIdentity(expected.identity, actual)) {
        throw new PrReviewLeaseError("discovery worktree changed during inspection");
    }
    const entries = ordinalSort(await readdir(directory));
    const entryKinds = await readDiscoveryEntryKinds(directory, entries);
    const after = await lstat(directory);
    const finalEntries = ordinalSort(await readdir(directory));
    if (after.isSymbolicLink() ||
        !after.isDirectory() ||
        !sameDiscoveryIdentity(expected.identity, after) ||
        !sameOrdinalStringArray(expected.entries, entries) ||
        !sameOrdinalStringArray(expected.entry_kinds, entryKinds) ||
        !sameOrdinalStringArray(entries, finalEntries)) {
        throw new PrReviewLeaseError("discovery directory entries changed during inspection");
    }
}
async function readDiscoveryEntryKinds(directory, entries) {
    const kinds = [];
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
async function assertSameDiscoveryDirectoryIdentity(directory, expected) {
    const actual = await lstat(directory);
    if (actual.isSymbolicLink() ||
        !actual.isDirectory() ||
        !sameDiscoveryIdentity(expected, actual)) {
        throw new PrReviewLeaseError("discovery worktree changed during inspection");
    }
}
function sameDiscoveryIdentity(left, right) {
    if (left.dev !== 0 || left.ino !== 0 || right.dev !== 0 || right.ino !== 0) {
        return left.dev === right.dev && left.ino === right.ino;
    }
    return left.mode === right.mode && left.birthtimeMs === right.birthtimeMs;
}
function sameDiscoveryFileIdentity(left, right) {
    return (sameDiscoveryIdentity(left, right) &&
        left.mode === right.mode &&
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs);
}
function discoveryStatFingerprint(stat) {
    return [
        stat.dev,
        stat.ino,
        stat.mode,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
        stat.birthtimeMs,
    ].join(":");
}
function stableDiscoveryFileFingerprint(snapshot) {
    return [
        discoveryStatFingerprint(snapshot.identity),
        snapshot.sha256,
        snapshot.contents.toString("base64"),
    ].join(":");
}
function stableDiscoveryDirectoryFingerprint(snapshot) {
    if (snapshot === null)
        return "absent";
    return [
        discoveryStatFingerprint(snapshot.identity),
        JSON.stringify(snapshot.entries),
        JSON.stringify(snapshot.entry_kinds),
    ].join(":");
}
function stableDiscoveryPathFingerprint(snapshot) {
    return snapshot.identity === null
        ? snapshot.status
        : `${snapshot.status}:${discoveryStatFingerprint(snapshot.identity)}`;
}
function discoveryRepositoryIdentityFingerprint(identity) {
    return [
        discoveryComparablePath(identity.top_level, process.platform),
        discoveryComparablePath(identity.common_directory, process.platform),
        discoveryComparablePath(identity.git_directory, process.platform),
    ].join("\0");
}
async function observeStableDiscoveryPathSnapshot(target, directory) {
    let before;
    try {
        before = await lstat(target);
    }
    catch (err) {
        if (err.code === "ENOENT") {
            return { status: "absent", identity: null };
        }
        return { status: "invalid", identity: null };
    }
    if (before.isSymbolicLink() ||
        (directory ? !before.isDirectory() : !before.isFile())) {
        return { status: "invalid", identity: before };
    }
    try {
        const after = await lstat(target);
        if (!sameDiscoveryIdentity(before, after) || after.isSymbolicLink()) {
            return { status: "invalid", identity: after };
        }
    }
    catch {
        return { status: "invalid", identity: null };
    }
    return {
        status: directory ? "directory" : "file",
        identity: before,
    };
}
function sameStableDiscoveryPath(left, right) {
    if (left.status !== right.status)
        return false;
    if (left.identity === null || right.identity === null) {
        return left.identity === right.identity;
    }
    return sameDiscoveryIdentity(left.identity, right.identity);
}
async function observeStableDiscoveryPath(target, directory) {
    return (await observeStableDiscoveryPathSnapshot(target, directory)).status;
}
async function assertDiscoveryPrimaryRoot(primaryRoot, env) {
    const before = await lstat(primaryRoot);
    if (before.isSymbolicLink() || !before.isDirectory()) {
        throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must be a real directory");
    }
    try {
        const repository = await readDiscoveryRepositoryIdentity(primaryRoot, env);
        const gitDirectory = parseDiscoveryGitPathBufferRecord(await runDiscoveryGitBuffer(primaryRoot, ["rev-parse", "--absolute-git-dir"], env), "PRIMARY_REPOSITORY_ROOT Git directory");
        if (discoveryComparablePath(repository.top_level, process.platform) !==
            discoveryComparablePath(primaryRoot, process.platform) ||
            discoveryComparablePath(await realpath(discoveryFilesystemPath(gitDirectory)), process.platform) !==
                discoveryComparablePath(repository.common_directory, process.platform)) {
            throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must be the primary Git worktree");
        }
        await assertSameDiscoveryDirectoryIdentity(primaryRoot, before);
        return repository;
    }
    catch (err) {
        if (err instanceof PrReviewLeaseError)
            throw err;
        throw new PrReviewLeaseError("PRIMARY_REPOSITORY_ROOT must be the primary Git worktree");
    }
}
async function readDiscoveryRepositoryIdentity(root, env) {
    const topLevelRaw = parseDiscoveryGitPathBufferRecord(await runDiscoveryGitBuffer(root, ["rev-parse", "--show-toplevel"], env), "discovery repository top-level");
    const commonDirectoryRaw = parseDiscoveryGitPathBufferRecord(await runDiscoveryGitBuffer(root, ["rev-parse", "--git-common-dir"], env), "discovery repository common directory");
    const gitDirectoryRaw = parseDiscoveryGitPathBufferRecord(await runDiscoveryGitBuffer(root, ["rev-parse", "--absolute-git-dir"], env), "discovery repository Git directory");
    const topLevelPath = discoveryFilesystemPath(topLevelRaw);
    const commonDirectoryPath = discoveryFilesystemPath(commonDirectoryRaw);
    const gitDirectoryPath = discoveryFilesystemPath(gitDirectoryRaw);
    return {
        top_level: await realpath(topLevelPath),
        common_directory: await realpath(path.isAbsolute(commonDirectoryPath)
            ? commonDirectoryPath
            : path.resolve(root, commonDirectoryPath)),
        git_directory: await realpath(path.isAbsolute(gitDirectoryPath)
            ? gitDirectoryPath
            : path.resolve(root, gitDirectoryPath)),
    };
}
export function parseDiscoveryGitPathRecord(output, label = "discovery Git path") {
    if (!output.endsWith("\n")) {
        throw new PrReviewLeaseError(`${label} is not LF-terminated`);
    }
    const value = output.slice(0, -1);
    if (value.length === 0) {
        throw new PrReviewLeaseError(`${label} is empty`);
    }
    return value;
}
const discoveryFatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
function fatalDecodeDiscoveryGitPath(output, label) {
    if (output.includes(0)) {
        throw new PrReviewLeaseError(`${label} contains a NUL byte`);
    }
    try {
        return discoveryFatalUtf8Decoder.decode(output);
    }
    catch {
        throw new PrReviewLeaseError(`${label} is not valid UTF-8`);
    }
}
function parseDiscoveryGitPathBufferRecord(output, label = "discovery Git path") {
    if (output.length === 0 || output[output.length - 1] !== 0x0a) {
        throw new PrReviewLeaseError(`${label} is not LF-terminated`);
    }
    const value = output.subarray(0, -1);
    if (value.length === 0) {
        throw new PrReviewLeaseError(`${label} is empty`);
    }
    return fatalDecodeDiscoveryGitPath(value, label);
}
function parseDiscoveryWorktreeRegistrationRecords(output) {
    if (output.length === 0) {
        throw new PrReviewLeaseError("discovery worktree inventory is empty");
    }
    if (output[output.length - 1] !== 0) {
        throw new PrReviewLeaseError("discovery worktree inventory is not NUL-terminated");
    }
    const registrations = [];
    const prefix = Buffer.from("worktree ", "ascii");
    let recordStart = 0;
    while (recordStart < output.length) {
        let blockFieldCount = 0;
        let worktreePath = null;
        for (;;) {
            const recordEnd = output.indexOf(0, recordStart);
            if (recordEnd < 0) {
                throw new PrReviewLeaseError("discovery worktree inventory block is not NUL-terminated");
            }
            if (recordEnd === recordStart) {
                if (blockFieldCount === 0) {
                    throw new PrReviewLeaseError("discovery worktree inventory block separator is malformed");
                }
                recordStart = recordEnd + 1;
                break;
            }
            const record = output.subarray(recordStart, recordEnd);
            recordStart = recordEnd + 1;
            blockFieldCount += 1;
            if (!record.subarray(0, prefix.length).equals(prefix)) {
                continue;
            }
            if (worktreePath !== null || record.length === prefix.length) {
                throw new PrReviewLeaseError("discovery worktree inventory worktree field is malformed");
            }
            worktreePath = fatalDecodeDiscoveryGitPath(record.subarray(prefix.length), "discovery worktree registration path");
        }
        if (worktreePath === null) {
            throw new PrReviewLeaseError("discovery worktree inventory worktree field is missing");
        }
        registrations.push(worktreePath);
    }
    return registrations;
}
export function parseDiscoveryGitlinkRecords(output) {
    const parser = new DiscoveryGitlinkStreamParser();
    parser.consume(output);
    return parser.finish().paths;
}
const discoveryGitlinkSelectedPathMaxBytes = 64 * 1024;
const discoveryGitlinkSelectedRecordMaxCount = 4096;
const discoveryGitlinkSelectedAggregateMaxBytes = 1024 * 1024;
class DiscoveryGitlinkStreamParser {
    #paths = [];
    #unsafeIndexFlags = false;
    #metadata = [];
    #selectedPath = [];
    #selectedRecordCount = 0;
    #selectedAggregateBytes = 0;
    #retentionError;
    #recordStarted = false;
    #tag;
    #tagComplete = false;
    #metadataComplete = false;
    #pathStarted = false;
    #selected = false;
    consume(chunk) {
        for (const byte of chunk) {
            if (this.#retentionError !== undefined)
                continue;
            if (byte === 0) {
                this.#finishRecord();
                continue;
            }
            this.#recordStarted = true;
            if (!this.#tagComplete) {
                if (this.#tag === undefined) {
                    if (!isDiscoveryGitIndexTag(byte)) {
                        throw new PrReviewLeaseError("discovery gitlink inventory record is malformed");
                    }
                    this.#tag = byte;
                    continue;
                }
                if (byte !== 0x20) {
                    throw new PrReviewLeaseError("discovery gitlink inventory record is malformed");
                }
                this.#tagComplete = true;
                if (isDiscoveryUnsafeIndexTag(this.#tag)) {
                    this.#unsafeIndexFlags = true;
                }
                continue;
            }
            if (!this.#metadataComplete) {
                if (byte > 0x7f) {
                    throw new PrReviewLeaseError("discovery gitlink inventory record is malformed");
                }
                if (byte === 9) {
                    if (this.#metadata.length === 0) {
                        throw new PrReviewLeaseError("discovery gitlink inventory record is malformed");
                    }
                    this.#metadataComplete = true;
                    const metadata = Buffer.from(this.#metadata);
                    const gitlinkPrefix = Buffer.from("160000 ", "ascii");
                    this.#selected =
                        metadata.length >= gitlinkPrefix.length &&
                            metadata.subarray(0, gitlinkPrefix.length).equals(gitlinkPrefix);
                    if (this.#selected) {
                        if (!/^160000 [0-9a-f]{40} [0-3]$/u.test(metadata.toString("latin1"))) {
                            throw new PrReviewLeaseError("discovery gitlink inventory record is malformed");
                        }
                        if (this.#selectedRecordCount >=
                            discoveryGitlinkSelectedRecordMaxCount) {
                            this.#latchRetentionError();
                            continue;
                        }
                        this.#selectedRecordCount += 1;
                    }
                    continue;
                }
                if (this.#metadata.length >= 256) {
                    throw new PrReviewLeaseError("discovery gitlink inventory record is malformed");
                }
                this.#metadata.push(byte);
                continue;
            }
            this.#pathStarted = true;
            if (this.#selected) {
                if (this.#selectedPath.length >= discoveryGitlinkSelectedPathMaxBytes ||
                    this.#selectedAggregateBytes >=
                        discoveryGitlinkSelectedAggregateMaxBytes) {
                    this.#latchRetentionError();
                    continue;
                }
                this.#selectedPath.push(byte);
                this.#selectedAggregateBytes += 1;
            }
        }
    }
    finish() {
        if (this.#retentionError !== undefined) {
            throw this.#retentionError;
        }
        if (this.#recordStarted) {
            throw new PrReviewLeaseError("discovery gitlink inventory is not NUL-terminated");
        }
        return {
            paths: this.#paths,
            unsafe_index_flags: this.#unsafeIndexFlags,
        };
    }
    #finishRecord() {
        if (!this.#recordStarted ||
            !this.#tagComplete ||
            !this.#metadataComplete ||
            !this.#pathStarted) {
            throw new PrReviewLeaseError("discovery gitlink inventory record is malformed");
        }
        if (this.#selected) {
            try {
                this.#paths.push(discoveryFatalUtf8Decoder.decode(Buffer.from(this.#selectedPath)));
            }
            catch {
                throw new PrReviewLeaseError("discovery gitlink inventory path is not valid UTF-8");
            }
        }
        this.#metadata.length = 0;
        this.#selectedPath.length = 0;
        this.#recordStarted = false;
        this.#tag = undefined;
        this.#tagComplete = false;
        this.#metadataComplete = false;
        this.#pathStarted = false;
        this.#selected = false;
    }
    #latchRetentionError() {
        this.#retentionError ??= new PrReviewLeaseError("discovery gitlink inventory exceeds retained limits");
    }
}
function isDiscoveryGitIndexTag(byte) {
    return (byte === 0x3f || // ?
        byte === 0x43 || // C
        byte === 0x48 || // H
        byte === 0x4b || // K
        byte === 0x4d || // M
        byte === 0x52 || // R
        byte === 0x53 || // S
        byte === 0x63 || // c
        byte === 0x68 || // h
        byte === 0x6b || // k
        byte === 0x6d || // m
        byte === 0x72 || // r
        byte === 0x73 // s
    );
}
function isDiscoveryUnsafeIndexTag(tag) {
    // Git reports assume-unchanged as h, skip-worktree as S, and their
    // combination as s when ls-files -v is used.
    return tag === 0x68 || tag === 0x53 || tag === 0x73;
}
async function readDiscoveryRepositoryBinding(primaryRoot, repositoryIdentity, env, expectedRepository) {
    const configPath = path.join(repositoryIdentity.common_directory, "config");
    const snapshot = await readStableDiscoveryFile(configPath);
    const worktreeConfigPath = path.join(repositoryIdentity.git_directory, "config.worktree");
    const worktreeSnapshot = await readOptionalStableDiscoveryFile(worktreeConfigPath);
    const commonAuthorityKeys = await assertNoDiscoveryConfigIncludes(primaryRoot, configPath, env);
    const worktreeAuthorityKeys = worktreeSnapshot === null
        ? {
            defines_origin: false,
            defines_worktree_config: false,
        }
        : await assertNoDiscoveryConfigIncludes(primaryRoot, worktreeConfigPath, env);
    const worktreeConfigEnabled = await readDiscoveryWorktreeConfigExtensionAuthority(primaryRoot, configPath, commonAuthorityKeys.defines_worktree_config, env);
    const commonValues = await readDiscoveryConfigOriginValues(primaryRoot, configPath, commonAuthorityKeys.defines_origin, env);
    const worktreeValues = worktreeSnapshot === null || !worktreeConfigEnabled
        ? []
        : await readDiscoveryConfigOriginValues(primaryRoot, worktreeConfigPath, worktreeAuthorityKeys.defines_origin, env);
    await assertSameDiscoveryFile(configPath, snapshot);
    if (worktreeSnapshot === null) {
        if ((await observeStableDiscoveryPath(worktreeConfigPath, false)) !== "absent") {
            throw new PrReviewLeaseError("primary repository worktree config appeared during inspection");
        }
    }
    else {
        await assertSameDiscoveryFile(worktreeConfigPath, worktreeSnapshot);
    }
    const effectiveValues = resolveDiscoveryEffectiveOriginValues(commonValues, worktreeValues);
    if (effectiveValues.length !== 1) {
        throw new PrReviewLeaseError("primary repository must define exactly one effective local origin URL");
    }
    const repository = normalizeDiscoveryGitHubRepository(effectiveValues[0]);
    if (repository.toLowerCase() !== expectedRepository.toLowerCase()) {
        throw new PrReviewLeaseError("primary repository origin does not match REPOSITORY");
    }
    return {
        repository: repository.toLowerCase(),
        config_fingerprint: JSON.stringify({
            common: stableDiscoveryFileFingerprint(snapshot),
            worktree: worktreeSnapshot === null
                ? "absent"
                : stableDiscoveryFileFingerprint(worktreeSnapshot),
        }),
    };
}
function resolveDiscoveryEffectiveOriginValues(commonValues, worktreeValues) {
    const effectiveValues = [];
    for (const value of [...commonValues, ...worktreeValues]) {
        if (value.length === 0) {
            effectiveValues.length = 0;
        }
        else {
            effectiveValues.push(value);
        }
    }
    return effectiveValues;
}
async function readDiscoveryConfigOriginValues(root, configPath, definesOrigin, env) {
    if (!definesOrigin)
        return [];
    const rawOutput = await runDiscoveryGit(root, [
        "config",
        "--null",
        "--get-all",
        "--no-includes",
        "--file",
        configPath,
        "remote.origin.url",
    ], env);
    const typedOutput = await runDiscoveryGit(root, [
        "config",
        "--null",
        "--type=bool-or-str",
        "--get-all",
        "--no-includes",
        "--file",
        configPath,
        "remote.origin.url",
    ], env);
    const rawValues = parseDiscoveryConfigValueInventory(rawOutput, "primary repository origin inventory");
    const typedValues = parseDiscoveryConfigValueInventory(typedOutput, "primary repository typed origin inventory");
    if (rawValues.length !== typedValues.length) {
        throw new PrReviewLeaseError("primary repository origin inventory changed during inspection");
    }
    return rawValues.map((value, index) => {
        if (value.length !== 0)
            return value;
        if (typedValues[index] === "false")
            return "";
        throw new PrReviewLeaseError("primary repository origin contains a valueless URL");
    });
}
async function readDiscoveryWorktreeConfigExtensionAuthority(root, configPath, definesWorktreeConfig, env) {
    if (!definesWorktreeConfig)
        return false;
    let output;
    try {
        output = await runDiscoveryGit(root, [
            "config",
            "--null",
            "--type=bool",
            "--get-all",
            "--no-includes",
            "--file",
            configPath,
            "extensions.worktreeConfig",
        ], env);
    }
    catch {
        throw new PrReviewLeaseError("primary repository worktree config extension is malformed");
    }
    const values = parseDiscoveryConfigValueInventory(output, "primary repository worktree config extension inventory");
    if (values.length !== 1) {
        throw new PrReviewLeaseError("primary repository worktree config extension is ambiguous");
    }
    if (values[0] === "true")
        return true;
    if (values[0] === "false")
        return false;
    throw new PrReviewLeaseError("primary repository worktree config extension is malformed");
}
function parseDiscoveryConfigValueInventory(output, label) {
    if (!output.endsWith("\0")) {
        throw new PrReviewLeaseError(`${label} is not NUL-terminated`);
    }
    return output.slice(0, -1).split("\0");
}
async function assertNoDiscoveryConfigIncludes(root, configPath, env) {
    let record = [];
    let definesOrigin = false;
    let definesWorktreeConfig = false;
    await runDiscoveryGitStreaming(root, [
        "config",
        "--null",
        "--name-only",
        "--list",
        "--no-includes",
        "--file",
        configPath,
    ], env, (chunk) => {
        for (const byte of chunk) {
            if (byte !== 0) {
                if (record.length >= 4096) {
                    throw new PrReviewLeaseError("primary repository config key is malformed");
                }
                record.push(byte);
                continue;
            }
            if (record.length === 0) {
                throw new PrReviewLeaseError("primary repository config key is malformed");
            }
            const name = Buffer.from(record).toString("utf8");
            record = [];
            if (name.toLowerCase() === "remote.origin.url") {
                definesOrigin = true;
            }
            if (name.toLowerCase() === "extensions.worktreeconfig") {
                definesWorktreeConfig = true;
            }
            if (isDiscoveryIncludeAuthorityKey(name)) {
                throw new PrReviewLeaseError("primary repository config contains include authority");
            }
        }
    });
    if (record.length !== 0) {
        throw new PrReviewLeaseError("primary repository config key inventory is not NUL-terminated");
    }
    return {
        defines_origin: definesOrigin,
        defines_worktree_config: definesWorktreeConfig,
    };
}
function isDiscoveryIncludeAuthorityKey(name) {
    const normalized = name.toLowerCase();
    if (normalized === "include.path") {
        return true;
    }
    const prefix = "includeif.";
    const suffix = ".path";
    return (normalized.startsWith(prefix) &&
        normalized.endsWith(suffix) &&
        normalized.length > prefix.length + suffix.length);
}
function isDiscoveryExecutableFilterAuthorityKey(name) {
    const normalized = name.toLowerCase();
    const prefix = "filter.";
    for (const suffix of [".clean", ".process"]) {
        if (normalized.startsWith(prefix) &&
            normalized.endsWith(suffix) &&
            normalized.length > prefix.length + suffix.length) {
            return true;
        }
    }
    return false;
}
function normalizeDiscoveryGitHubRepository(value) {
    const patterns = [
        /^https:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/iu,
        /^git@github\.com:([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/iu,
        /^ssh:\/\/git@github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/?$/iu,
    ];
    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match !== null) {
            const repository = `${match[1]}/${match[2]}`;
            if (isSafeGitHubRepository(repository)) {
                return repository;
            }
        }
    }
    throw new PrReviewLeaseError("primary repository origin must be a supported GitHub repository URL");
}
function assertDiscoveryCandidateRepository(candidate, physicalWorktree, primary) {
    if (discoveryWorktreeAuthorityComparablePath(candidate.top_level, process.platform) ===
        discoveryWorktreeAuthorityComparablePath(primary.top_level, process.platform) ||
        discoveryComparablePath(candidate.top_level, process.platform) !==
            discoveryComparablePath(physicalWorktree, process.platform) ||
        discoveryComparablePath(candidate.common_directory, process.platform) !==
            discoveryComparablePath(primary.common_directory, process.platform)) {
        throw new PrReviewLeaseError("candidate worktree does not belong to the primary repository");
    }
}
async function readDiscoveryCandidateRepositoryAuthority(physicalWorktree, candidate, primary) {
    const worktreesDirectory = path.join(primary.common_directory, "worktrees");
    const worktreesIdentity = await lstat(worktreesDirectory);
    if (worktreesIdentity.isSymbolicLink() || !worktreesIdentity.isDirectory()) {
        throw new PrReviewLeaseError("candidate worktree administration is not a real directory");
    }
    const physicalWorktreesDirectory = await realpath(worktreesDirectory);
    const physicalAdminDirectory = await realpath(candidate.git_directory);
    if (discoveryComparablePath(path.dirname(physicalAdminDirectory), process.platform) !== discoveryComparablePath(physicalWorktreesDirectory, process.platform)) {
        throw new PrReviewLeaseError("candidate Git directory is not a worktree administration entry");
    }
    const adminIdentity = await lstat(candidate.git_directory);
    if (adminIdentity.isSymbolicLink() || !adminIdentity.isDirectory()) {
        throw new PrReviewLeaseError("candidate worktree administration entry is not a real directory");
    }
    const candidateGitfilePath = path.join(physicalWorktree, ".git");
    const candidateGitfile = await readStableDiscoveryFile(candidateGitfilePath);
    const candidatePrefix = Buffer.from("gitdir: ", "ascii");
    if (!candidateGitfile.contents
        .subarray(0, candidatePrefix.length)
        .equals(candidatePrefix)) {
        throw new PrReviewLeaseError("candidate Git file is malformed");
    }
    const candidateAdminValue = parseDiscoveryGitPathBufferRecord(candidateGitfile.contents.subarray(candidatePrefix.length), "candidate Git file");
    const candidateAdminPath = discoveryFilesystemPath(candidateAdminValue);
    const physicalCandidateAdmin = await realpath(path.isAbsolute(candidateAdminPath)
        ? candidateAdminPath
        : path.resolve(physicalWorktree, candidateAdminPath));
    if (discoveryComparablePath(physicalCandidateAdmin, process.platform) !==
        discoveryComparablePath(candidate.git_directory, process.platform)) {
        throw new PrReviewLeaseError("candidate Git file does not name its repository administration entry");
    }
    const adminGitdirPath = path.join(candidate.git_directory, "gitdir");
    const adminGitdir = await readStableDiscoveryFile(adminGitdirPath);
    const adminCandidateValue = parseDiscoveryGitPathBufferRecord(adminGitdir.contents, "candidate worktree administration gitdir");
    const adminCandidatePath = discoveryFilesystemPath(adminCandidateValue);
    const physicalAdminCandidate = await realpath(path.isAbsolute(adminCandidatePath)
        ? adminCandidatePath
        : path.resolve(candidate.git_directory, adminCandidatePath));
    const physicalCandidateGitfile = await realpath(candidateGitfilePath);
    if (discoveryComparablePath(physicalAdminCandidate, process.platform) !==
        discoveryComparablePath(physicalCandidateGitfile, process.platform)) {
        throw new PrReviewLeaseError("candidate worktree administration entry is not reciprocal");
    }
    const currentWorktreesIdentity = await lstat(worktreesDirectory);
    const currentAdminIdentity = await lstat(candidate.git_directory);
    const currentPhysicalWorktreesDirectory = await realpath(worktreesDirectory);
    const currentPhysicalAdminDirectory = await realpath(candidate.git_directory);
    if (discoveryStatFingerprint(currentWorktreesIdentity) !==
        discoveryStatFingerprint(worktreesIdentity) ||
        discoveryStatFingerprint(currentAdminIdentity) !==
            discoveryStatFingerprint(adminIdentity) ||
        discoveryComparablePath(currentPhysicalWorktreesDirectory, process.platform) !==
            discoveryComparablePath(physicalWorktreesDirectory, process.platform) ||
        discoveryComparablePath(currentPhysicalAdminDirectory, process.platform) !==
            discoveryComparablePath(physicalAdminDirectory, process.platform)) {
        throw new PrReviewLeaseError("candidate worktree administration changed during inspection");
    }
    return {
        admin_gitdir: adminGitdir,
        admin_gitdir_path: adminGitdirPath,
        candidate_gitfile: candidateGitfile,
        candidate_gitfile_path: candidateGitfilePath,
        fingerprint: [
            discoveryComparablePath(physicalWorktreesDirectory, process.platform),
            discoveryStatFingerprint(worktreesIdentity),
            discoveryComparablePath(physicalAdminDirectory, process.platform),
            discoveryStatFingerprint(adminIdentity),
            stableDiscoveryFileFingerprint(candidateGitfile),
            stableDiscoveryFileFingerprint(adminGitdir),
        ].join("\0"),
    };
}
function sameDiscoveryRepositoryIdentity(left, right) {
    return (discoveryComparablePath(left.top_level, process.platform) ===
        discoveryComparablePath(right.top_level, process.platform) &&
        discoveryComparablePath(left.common_directory, process.platform) ===
            discoveryComparablePath(right.common_directory, process.platform) &&
        discoveryComparablePath(left.git_directory, process.platform) ===
            discoveryComparablePath(right.git_directory, process.platform));
}
async function readDiscoveryWorktreeRegistrations(primaryRoot, env) {
    const stdout = await runDiscoveryGitBuffer(primaryRoot, ["worktree", "list", "--porcelain", "-z"], env);
    return parseDiscoveryWorktreeRegistrationRecords(stdout);
}
async function discoveryWorktreeDirty(worktreePath, env) {
    const statusAuthority = await assertDiscoveryStatusAuthoritySafe(worktreePath, env);
    let dirty = statusAuthority.dirty;
    await runDiscoveryGitStreaming(worktreePath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
    ], env, (chunk) => {
        if (chunk.length > 0)
            dirty = true;
    }, true);
    await statusAuthority.verify();
    return {
        dirty,
        authority: statusAuthority.fingerprint,
    };
}
async function assertDiscoveryStatusAuthoritySafe(worktreePath, env, visited = new Set()) {
    const repository = await readDiscoveryRepositoryIdentity(worktreePath, env);
    const identityKey = discoveryComparablePath(repository.git_directory, process.platform);
    if (visited.has(identityKey)) {
        return {
            dirty: false,
            verify: async () => { },
            fingerprint: `visited:${identityKey}`,
        };
    }
    visited.add(identityKey);
    const authoritySnapshots = [];
    const absentAuthorityFiles = [];
    const authorityFiles = ordinalSort([
        path.join(repository.common_directory, "config"),
        path.join(repository.git_directory, "config.worktree"),
        path.join(repository.common_directory, "info", "attributes"),
        path.join(repository.git_directory, "info", "attributes"),
    ]);
    for (const authorityFile of new Set(authorityFiles)) {
        const snapshot = await readOptionalStableDiscoveryFile(authorityFile);
        if (snapshot === null) {
            absentAuthorityFiles.push(authorityFile);
            continue;
        }
        authoritySnapshots.push([authorityFile, snapshot]);
        if (path.basename(authorityFile).startsWith("config")) {
            const names = await runDiscoveryGit(worktreePath, [
                "config",
                "--null",
                "--name-only",
                "--list",
                "--no-includes",
                "--file",
                authorityFile,
            ], env);
            for (const name of names.split("\0").filter(Boolean)) {
                if (isDiscoveryIncludeAuthorityKey(name) ||
                    isDiscoveryExecutableFilterAuthorityKey(name)) {
                    throw new PrReviewLeaseError("repository config contains executable status authority");
                }
            }
        }
        await assertSameDiscoveryFile(authorityFile, snapshot);
    }
    const gitlinks = await readDiscoveryGitlinkInventory(worktreePath, env);
    const submoduleAuthorities = [];
    const gitlinkPathAuthorities = [];
    for (const gitlinkPath of gitlinks.paths) {
        const pathAuthority = await inspectDiscoveryGitlinkPath(worktreePath, gitlinkPath, env);
        gitlinkPathAuthorities.push(pathAuthority);
        if (pathAuthority.physical_path === null)
            continue;
        submoduleAuthorities.push(await assertDiscoveryStatusAuthoritySafe(pathAuthority.physical_path, env, visited));
    }
    return {
        dirty: gitlinks.unsafe_index_flags ||
            submoduleAuthorities.some((authority) => authority.dirty),
        fingerprint: JSON.stringify({
            repository: discoveryRepositoryIdentityFingerprint(repository),
            files: authoritySnapshots.map(([authorityFile, snapshot]) => [
                authorityFile,
                stableDiscoveryFileFingerprint(snapshot),
            ]),
            absent: absentAuthorityFiles,
            gitlinks: gitlinks.fingerprint,
            gitlink_paths: gitlinkPathAuthorities.map((authority) => authority.fingerprint),
            submodules: submoduleAuthorities.map((authority) => authority.fingerprint),
        }),
        verify: async () => {
            for (const [authorityFile, snapshot] of authoritySnapshots) {
                await assertSameDiscoveryFile(authorityFile, snapshot);
            }
            for (const authorityFile of absentAuthorityFiles) {
                if ((await observeStableDiscoveryPath(authorityFile, false)) !== "absent") {
                    throw new PrReviewLeaseError("repository status authority appeared during inspection");
                }
            }
            const currentGitlinks = await readDiscoveryGitlinkInventory(worktreePath, env);
            if (currentGitlinks.fingerprint !== gitlinks.fingerprint) {
                throw new PrReviewLeaseError("repository submodule inventory changed during status");
            }
            for (const authority of gitlinkPathAuthorities) {
                await authority.verify();
            }
            for (const authority of submoduleAuthorities) {
                await authority.verify();
            }
        },
    };
}
async function inspectDiscoveryGitlinkPath(candidateRoot, gitlinkPath, env) {
    const components = validateDiscoveryGitlinkPath(gitlinkPath);
    const componentSnapshots = [];
    let current = candidateRoot;
    for (let index = 0; index < components.length; index += 1) {
        current = path.join(current, components[index]);
        let stat;
        try {
            stat = await lstat(current);
        }
        catch (err) {
            if (err.code !== "ENOENT")
                throw err;
            const missingPath = current;
            return {
                physical_path: null,
                fingerprint: JSON.stringify({
                    path: gitlinkPath,
                    components: componentSnapshots.map(([component, snapshot]) => [
                        component,
                        discoveryStatFingerprint(snapshot),
                    ]),
                    missing: missingPath,
                }),
                verify: async () => {
                    await verifyDiscoveryGitlinkComponents(componentSnapshots);
                    if ((await observeStableDiscoveryPath(missingPath, false)) !== "absent") {
                        throw new PrReviewLeaseError("uninitialized submodule path changed during inspection");
                    }
                },
            };
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new PrReviewLeaseError("initialized submodule path is unsafe");
        }
        componentSnapshots.push([current, stat]);
    }
    const physicalPath = await realpath(current);
    if (!isStrictDiscoveryDescendant(candidateRoot, physicalPath)) {
        throw new PrReviewLeaseError("initialized submodule path escapes worktree");
    }
    const repository = await readDiscoveryRepositoryIdentity(physicalPath, env);
    if (discoveryComparablePath(repository.top_level, process.platform) !==
        discoveryComparablePath(physicalPath, process.platform)) {
        throw new PrReviewLeaseError("initialized submodule repository identity mismatch");
    }
    return {
        physical_path: physicalPath,
        fingerprint: JSON.stringify({
            path: gitlinkPath,
            components: componentSnapshots.map(([component, snapshot]) => [
                component,
                discoveryStatFingerprint(snapshot),
            ]),
            physical: discoveryComparablePath(physicalPath, process.platform),
            repository: discoveryRepositoryIdentityFingerprint(repository),
        }),
        verify: async () => {
            await verifyDiscoveryGitlinkComponents(componentSnapshots);
            const currentPhysicalPath = await realpath(current);
            if (discoveryComparablePath(currentPhysicalPath, process.platform) !==
                discoveryComparablePath(physicalPath, process.platform) ||
                !isStrictDiscoveryDescendant(candidateRoot, currentPhysicalPath)) {
                throw new PrReviewLeaseError("initialized submodule path changed during inspection");
            }
            const currentRepository = await readDiscoveryRepositoryIdentity(currentPhysicalPath, env);
            if (!sameDiscoveryRepositoryIdentity(currentRepository, repository) ||
                discoveryComparablePath(currentRepository.top_level, process.platform) !== discoveryComparablePath(currentPhysicalPath, process.platform)) {
                throw new PrReviewLeaseError("initialized submodule repository changed during inspection");
            }
        },
    };
}
function validateDiscoveryGitlinkPath(gitlinkPath) {
    if (gitlinkPath.length === 0 ||
        gitlinkPath.includes("\\") ||
        path.posix.isAbsolute(gitlinkPath) ||
        path.win32.isAbsolute(gitlinkPath) ||
        /^[A-Za-z]:/u.test(gitlinkPath) ||
        /^[/\\]{2}/u.test(gitlinkPath) ||
        hasDiscoveryGitlinkControlCharacter(gitlinkPath)) {
        throw new PrReviewLeaseError("gitlink path is not repository-relative");
    }
    const components = gitlinkPath.split("/");
    if (components.some((component) => component.length === 0 || component === "." || component === "..")) {
        throw new PrReviewLeaseError("gitlink path is not repository-relative");
    }
    return components;
}
function hasDiscoveryGitlinkControlCharacter(gitlinkPath) {
    for (const character of gitlinkPath) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined &&
            ((codePoint >= 0 && codePoint <= 9) ||
                (codePoint >= 11 && codePoint <= 31) ||
                codePoint === 127)) {
            return true;
        }
    }
    return false;
}
async function verifyDiscoveryGitlinkComponents(components) {
    for (const [component, expected] of components) {
        const current = await lstat(component);
        if (current.isSymbolicLink() ||
            !current.isDirectory() ||
            !sameDiscoveryIdentity(expected, current)) {
            throw new PrReviewLeaseError("initialized submodule path changed during inspection");
        }
    }
}
function isStrictDiscoveryDescendant(root, target) {
    const relative = path.relative(root, target);
    return (relative.length > 0 &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative));
}
async function readDiscoveryGitlinkInventory(root, env) {
    const parser = new DiscoveryGitlinkStreamParser();
    const fingerprint = createHash("sha256");
    await runDiscoveryGitStreaming(root, ["ls-files", "--stage", "-v", "-z"], env, (chunk) => {
        fingerprint.update(chunk);
        parser.consume(chunk);
    });
    const parsed = parser.finish();
    return {
        fingerprint: fingerprint.digest("hex"),
        ...parsed,
    };
}
async function readOptionalStableDiscoveryFile(file) {
    try {
        return await readStableDiscoveryFile(file);
    }
    catch (err) {
        if (err.code === "ENOENT")
            return null;
        throw err;
    }
}
function discoveryGitArguments(root, args) {
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    return [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        `core.hooksPath=${nullDevice}`,
        "-c",
        `core.attributesFile=${nullDevice}`,
        "-c",
        `core.excludesFile=${nullDevice}`,
        "-c",
        "maintenance.auto=false",
        "-c",
        "gc.auto=0",
        "-C",
        root,
        ...args,
    ];
}
async function runDiscoveryGit(root, args, env) {
    const { stdout } = await execFileAsync("git", discoveryGitArguments(root, args), { env, maxBuffer: 1024 * 1024 });
    return stdout;
}
async function runDiscoveryGitBuffer(root, args, env) {
    return await new Promise((resolve, reject) => {
        execFile("git", discoveryGitArguments(root, args), { env, maxBuffer: 1024 * 1024, encoding: "buffer" }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout);
        });
    });
}
async function runDiscoveryGitStreaming(root, args, env, consumeStdout, rejectSuccessfulStderr = false) {
    await new Promise((resolve, reject) => {
        const child = spawn("git", discoveryGitArguments(root, args), {
            env,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const diagnosticChunks = [];
        let diagnosticBytes = 0;
        let streamError;
        let spawnError;
        child.once("error", (error) => {
            spawnError = error;
        });
        child.stdout.on("data", (chunk) => {
            if (streamError !== undefined)
                return;
            try {
                consumeStdout(chunk);
            }
            catch (error) {
                streamError = error;
            }
        });
        child.stderr.on("data", (chunk) => {
            if (diagnosticBytes >= 64 * 1024)
                return;
            const retained = chunk.subarray(0, 64 * 1024 - diagnosticBytes);
            diagnosticChunks.push(retained);
            diagnosticBytes += retained.length;
        });
        child.once("close", (code, signal) => {
            if (spawnError !== undefined) {
                reject(spawnError);
                return;
            }
            if (code !== 0) {
                const diagnostic = Buffer.concat(diagnosticChunks).toString("utf8");
                reject(new PrReviewLeaseError(`discovery Git command failed (${code ?? signal ?? "unknown"}): ${diagnostic}`));
                return;
            }
            if (streamError !== undefined) {
                reject(streamError);
                return;
            }
            if (rejectSuccessfulStderr && diagnosticBytes > 0) {
                const diagnostic = Buffer.concat(diagnosticChunks).toString("utf8");
                reject(new PrReviewLeaseError(`discovery Git command produced diagnostics: ${diagnostic}`));
                return;
            }
            resolve();
        });
    });
}
export function discoveryGitEnvironment() {
    const env = {};
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
        const match = Object.entries(process.env).find(([candidate]) => candidate.toUpperCase() === key.toUpperCase());
        if (match?.[1] !== undefined)
            env[key] = match[1];
    }
    const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
    env.GIT_CONFIG_NOSYSTEM = "1";
    env.GIT_CONFIG_GLOBAL = nullDevice;
    env.GIT_ATTR_NOSYSTEM = "1";
    env.GIT_OPTIONAL_LOCKS = "0";
    env.GIT_NO_LAZY_FETCH = "1";
    env.GIT_TERMINAL_PROMPT = "0";
    env.LC_ALL = "C";
    env.LANG = "C";
    return env;
}
export function discoveryFilesystemPath(value, platform = process.platform) {
    if (platform !== "win32")
        return value;
    const msys = value.match(/^\/([A-Za-z])(?:\/(.*))?$/u);
    if (msys !== null) {
        return `${msys[1].toLowerCase()}:/${msys[2] ?? ""}`;
    }
    return value;
}
function discoveryComparablePath(value, platform) {
    const normalized = value.replace(/\\/gu, "/");
    return platform === "win32" ||
        /^[A-Za-z]:\//u.test(normalized) ||
        /^\/\/[^/]+\/[^/]+/u.test(normalized)
        ? normalized.toLowerCase()
        : normalized;
}
function discoveryRegistrationComparablePath(value, platform) {
    const filesystemPath = discoveryFilesystemPath(value, platform);
    if (platform === "win32") {
        if (!path.win32.isAbsolute(filesystemPath)) {
            throw new PrReviewLeaseError("discovery registration path must be absolute");
        }
        return discoveryComparablePath(path.win32.normalize(filesystemPath), platform);
    }
    if (!path.posix.isAbsolute(filesystemPath)) {
        throw new PrReviewLeaseError("discovery registration path must be absolute");
    }
    return discoveryComparablePath(path.posix.normalize(filesystemPath), platform);
}
function discoveryWorktreeAuthorityComparablePath(value, platform) {
    const comparable = discoveryRegistrationComparablePath(value, platform);
    if (comparable === "/" || /^[a-z]:\/$/u.test(comparable)) {
        return comparable;
    }
    return comparable.replace(/\/+$/u, "");
}
function sameOrdinalStringArray(left, right) {
    return (left.length === right.length &&
        left.every((value, index) => value === right[index]));
}
function discoveryRegistrationSnapshot(registrations, platform) {
    return ordinalSort(registrations.map((entry) => discoveryRegistrationComparablePath(entry, platform)));
}
function ordinalCompare(left, right) {
    const leftCodePoints = Array.from(left, (value) => value.codePointAt(0) ?? 0);
    const rightCodePoints = Array.from(right, (value) => value.codePointAt(0) ?? 0);
    const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);
    for (let index = 0; index < sharedLength; index += 1) {
        if (leftCodePoints[index] < rightCodePoints[index])
            return -1;
        if (leftCodePoints[index] > rightCodePoints[index])
            return 1;
    }
    return leftCodePoints.length < rightCodePoints.length
        ? -1
        : leftCodePoints.length > rightCodePoints.length
            ? 1
            : 0;
}
function ordinalSort(values) {
    return [...values].sort(ordinalCompare);
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
    const inputs = await readInputsForWrite(previous, identity.worktreePath);
    const archive = archivePathIfNeeded(previous, identity, inputs);
    const row = transitionId(previous, inputs);
    let reduced = reducePrReviewLease(previous, identity, inputs);
    if (previous !== null && inputs.state === "failed") {
        reduced = await clearInvalidFailureRecoveryArtifacts(reduced, previous, identity.primaryRoot, identity.worktreePath, recoveryPolicyForPreviousState(previous.state));
    }
    else {
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
    reduced = await clearInvalidFailureRecoveryArtifacts(reduced, previous, identity.primaryRoot, identity.worktreePath, "preserve-gated-recovery");
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
    await validateReferencedArtifacts(lease, identity.worktreePath, {
        validateResultAuthority: true,
        policy: "validate-stored-lease",
    });
}
async function readStatus() {
    const identity = await readIdentity(true);
    await assertReadableWorktree(identity.worktreePath);
    const lease = await readRequiredJson(identity.primaryRoot, identity.leaseFile, "lease file");
    validateLeaseShape(lease);
    assertExistingLeaseIdentity(lease, identity);
    if (lease.state !== "gated") {
        throw new PrReviewLeaseError("read-status requires gated lease");
    }
    if (!(await isRegisteredWorktree(identity.primaryRoot, identity.worktreePath))) {
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
    const resultSha256 = await sha256DirectChild(identity.worktreePath, resultFile, "result file");
    const result = await readRequiredJson(identity.worktreePath, resultFile, "result file");
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
    if (decision.verifyBeforeRemove === null) {
        return cleanupOutput("retained", {
            ...decision,
            canRemove: false,
            refusalReason: "cleanup-authority-changed",
            message: "cleanup authority changed; preserving worktree",
        });
    }
    try {
        await decision.verifyBeforeRemove();
        if (await isWorktreeDirty(identity.worktreePath)) {
            return cleanupOutput("retained", {
                ...decision,
                canRemove: false,
                dirty: true,
                refusalReason: "dirty",
                message: "worktree has local changes",
            });
        }
        await decision.verifyBeforeRemove();
    }
    catch {
        return cleanupOutput("retained", {
            ...decision,
            canRemove: false,
            refusalReason: "cleanup-authority-changed",
            message: "cleanup authority changed; preserving worktree",
        });
    }
    const args = ["-C", identity.primaryRoot, "worktree", "remove"];
    if (decision.forceRemoveAllowed) {
        args.push("-f");
    }
    args.push(identity.worktreePath);
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
        verifyBeforeRemove: null,
    };
    let lease;
    let verifyBeforeRemove = null;
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
        if (!(await isRegisteredWorktree(identity.primaryRoot, identity.worktreePath))) {
            return {
                ...base,
                refusalReason: "not-registered-worktree",
                metadataOutcome: "skipped",
                message: "worktree path is not registered for the primary repository",
            };
        }
        const gitEnv = discoveryGitEnvironment();
        const primaryRoot = await realpath(identity.primaryRoot);
        const primaryRepository = await assertDiscoveryPrimaryRoot(primaryRoot, gitEnv);
        const physicalWorktree = await realpath(identity.worktreePath);
        const candidateRepository = await readDiscoveryRepositoryIdentity(physicalWorktree, gitEnv);
        assertDiscoveryCandidateRepository(candidateRepository, physicalWorktree, primaryRepository);
        const candidateRepositoryAuthority = await readDiscoveryCandidateRepositoryAuthority(physicalWorktree, candidateRepository, primaryRepository);
        verifyBeforeRemove = async () => {
            const currentPrimaryRoot = await realpath(identity.primaryRoot);
            const currentPrimaryRepository = await assertDiscoveryPrimaryRoot(currentPrimaryRoot, gitEnv);
            const currentPhysicalWorktree = await realpath(identity.worktreePath);
            if (discoveryComparablePath(currentPrimaryRoot, process.platform) !==
                discoveryComparablePath(primaryRoot, process.platform) ||
                !sameDiscoveryRepositoryIdentity(currentPrimaryRepository, primaryRepository) ||
                discoveryComparablePath(currentPhysicalWorktree, process.platform) !==
                    discoveryComparablePath(physicalWorktree, process.platform) ||
                digestPath(currentPhysicalWorktree) !== identity.worktreeDigest) {
                throw new PrReviewLeaseError("cleanup repository identity changed before removal");
            }
            const currentCandidateRepository = await readDiscoveryRepositoryIdentity(currentPhysicalWorktree, gitEnv);
            assertDiscoveryCandidateRepository(currentCandidateRepository, currentPhysicalWorktree, currentPrimaryRepository);
            const currentCandidateAuthority = await readDiscoveryCandidateRepositoryAuthority(currentPhysicalWorktree, currentCandidateRepository, currentPrimaryRepository);
            if (!sameDiscoveryRepositoryIdentity(currentCandidateRepository, candidateRepository) ||
                currentCandidateAuthority.fingerprint !==
                    candidateRepositoryAuthority.fingerprint ||
                !(await isRegisteredWorktree(currentPrimaryRoot, currentPhysicalWorktree))) {
                throw new PrReviewLeaseError("cleanup candidate authority changed before removal");
            }
            const currentLease = await readRequiredJson(currentPrimaryRoot, identity.leaseFile, "lease file");
            validateLeaseShape(currentLease);
            assertExistingLeaseIdentity(currentLease, identity);
            if (currentLease.state !== lease.state) {
                throw new PrReviewLeaseError("cleanup lease authority changed before removal");
            }
        };
        await validateReferencedArtifacts(lease, identity.worktreePath, {
            validateResultAuthority: true,
            policy: "validate-stored-lease",
        });
        const unmanagedArtifacts = await findUnmanagedEphemeralArtifacts(lease, identity.worktreePath);
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
        base.dirty = await isWorktreeDirty(identity.worktreePath);
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
        verifyBeforeRemove,
    };
}
async function isWorktreeDirty(worktreePath) {
    try {
        const { stderr, stdout } = await execFileAsync("git", ["--no-optional-locks", "-C", worktreePath, "status", "--porcelain"], { maxBuffer: 1024 * 1024 });
        if (stderr.length > 0) {
            throw new PrReviewLeaseError("git status produced diagnostics for worktree");
        }
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
        await validateReferencedArtifacts(next, identity.worktreePath, {
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
async function readAuditFailureIdentity() {
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
async function readCleanupIdentity() {
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
    const resolvedWorktree = await resolveWorktreePathForCleanup(requiredEnv("WORKTREE_PATH"));
    if (resolvedWorktree.path === primaryRoot) {
        throw new PrReviewLeaseError("WORKTREE_PATH must be a review worktree, not the primary repository root");
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
    if (lease.state === "posted" &&
        (lease.artifacts.approved_review_file === null ||
            lease.artifacts.validated_payload_file === null)) {
        throw new PrReviewLeaseError("lease schema mismatch");
    }
    if (lease.state === "failed" && lease.failure.phase === null) {
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
            if (JSON.stringify(payload) !== JSON.stringify(approved.payload)) {
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
async function findUnmanagedEphemeralArtifacts(lease, worktreePath) {
    const ephemeralPath = path.join(worktreePath, ".ephemeral");
    let entries;
    try {
        entries = await readdir(ephemeralPath, { withFileTypes: true });
    }
    catch (err) {
        if (err.code === "ENOENT") {
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
async function collectOwnedEphemeralArtifacts(lease, worktreePath) {
    const owned = new Set();
    addOwnedPath(owned, lease.artifacts.handoff_file);
    addOwnedPath(owned, lease.artifacts.result_file);
    if (lease.artifacts.handoff_file !== null) {
        const handoff = await readRequiredJson(worktreePath, lease.artifacts.handoff_file, "handoff file");
        collectHandoffArtifactPaths(owned, handoff);
    }
    if (lease.artifacts.result_file !== null) {
        const result = await readRequiredJson(worktreePath, lease.artifacts.result_file, "result file");
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
    if (lease.cleanup !== undefined && !isObject(lease.cleanup)) {
        throw new PrReviewLeaseError("lease cleanup metadata mismatch");
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
    return (previous !== null &&
        (previous.state === "posted" || previous.state === "aborted") &&
        typeof previous.cleanup?.removed_at === "string");
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
function digestPath(value) {
    return createHash("sha256")
        .update(normalizeComparablePath(value))
        .digest("hex");
}
function expectedValidatedPayloadPath(prNumber, reviewHead) {
    return `.ephemeral/pr-${prNumber}-${reviewHead}-validated-review-payload.json`;
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
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new PrReviewLeaseError(`${name} must be a safe positive integer`);
    }
    return parsed;
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
