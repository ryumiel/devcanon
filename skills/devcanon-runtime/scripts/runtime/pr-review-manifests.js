import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rm, stat, } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
import { requireDirectEphemeralChild } from "./paths.js";
import { runPrReviewLeasesCommand } from "./pr-review-leases.js";
import { validatePrReviewResultCommandAuthority, } from "./pr-review-result-validation.js";
const execFileAsync = promisify(execFile);
const FORBIDDEN_KEYS = new Set([
    "approval",
    "approved_review",
    "approved_review_file",
    "approval_state",
    "lease",
    "lease_state",
    "lease_file",
    "review_payload_file",
    "payload",
    "payload_sha256",
    "review_payload_sha256",
    "REVIEW_EVENT",
    "review_event",
    "event",
]);
export async function runPrReviewManifestsCommand(args) {
    try {
        const [commandName] = args;
        switch (commandName) {
            case "prepare-handoff-write":
                return ok(`${await prepareHandoffWrite()}\n`);
            case "write-handoff":
                return ok(`${await writeHandoff()}\n`);
            case "validate-handoff":
                await validateHandoffCommand();
                return ok("");
            case "prepare-result-write":
                return ok(`${await prepareResultWrite()}\n`);
            case "write-result":
                return ok(`${await writeResult()}\n`);
            case "validate-result":
                await validateResultCommand();
                return ok("");
            case "render-phase5-audit-summary":
                return ok(`${await renderPhase5AuditSummary()}\n`);
            default:
                throw new PrReviewManifestError("usage: review-manifests.sh prepare-handoff-write|write-handoff|validate-handoff|prepare-result-write|write-result|validate-result|render-phase5-audit-summary");
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: `${message}\n` };
    }
}
async function prepareHandoffWrite() {
    await requireRepoRoot();
    const prNumber = readPrNumber();
    const headSha = readHeadSha();
    const file = expectedHandoffPath(prNumber, headSha);
    validateDirectChildPath("handoff", file, "-handoff.json");
    validateDirectChildPath("handoff temp", tmpPathFor(file), ".tmp");
    await prepareWriteTarget("handoff", file);
    await prepareWriteTarget("handoff temp", tmpPathFor(file));
    return file;
}
async function prepareResultWrite() {
    await requireRepoRoot();
    const prNumber = readPrNumber();
    const headSha = readHeadSha();
    const file = expectedResultPath(prNumber, headSha);
    validateDirectChildPath("result", file, "-result.json");
    validateDirectChildPath("result temp", tmpPathFor(file), ".tmp");
    await prepareWriteTarget("result", file);
    await prepareWriteTarget("result temp", tmpPathFor(file));
    return file;
}
async function writeHandoff() {
    await requireRepoRoot();
    const prNumber = readPrNumber();
    const headSha = readHeadSha();
    requireHandoffWriteEnv();
    const file = await prepareHandoffWrite();
    const priorThreadsFile = optionalEnv("PRIOR_THREADS_FILE") ?? null;
    const lastReviewedSha = optionalEnv("LAST_REVIEWED_SHA") ?? null;
    if (lastReviewedSha !== null) {
        validateShaValue("LAST_REVIEWED_SHA", lastReviewedSha);
    }
    const executionWorkingDirectory = normalizeExecutionWorkingDirectory(requiredEnv("EXECUTION_WORKING_DIRECTORY"));
    const scopeDecisionFile = requiredEnv("SCOPE_DECISION_FILE");
    await validateScopeAuthority(scopeDecisionFile, requiredEnv("REVIEW_SCOPE_BASE_REF"), priorThreadsFile);
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: requiredEnv("REPOSITORY"),
        prNumber,
    });
    if (requiredEnv("REVIEW_SCOPE_BASE_REF") !==
        providerEvidence.providerDiffBaseSha) {
        fail("handoff review scope base mismatch");
    }
    const handoff = {
        schema: "pr-review/handoff/v1",
        pr_number: prNumber,
        repository: requiredEnv("REPOSITORY"),
        execution: {
            kind: "review-worktree",
            working_directory: executionWorkingDirectory,
        },
        base_ref: requiredEnv("BASE_REF"),
        head_ref: requiredEnv("HEAD_REF"),
        review_scope_base_ref: requiredEnv("REVIEW_SCOPE_BASE_REF"),
        active_diff_range: requiredEnv("ACTIVE_DIFF_RANGE"),
        full_pr_diff_range: requiredEnv("FULL_PR_DIFF_RANGE"),
        review_head_sha: headSha,
        mode: requiredEnv("MODE"),
        language_hints: parseJsonEnv("LANGUAGE_HINTS_JSON"),
        follow_up: {
            state: requiredEnv("FOLLOW_UP_STATE"),
            last_reviewed_sha: lastReviewedSha,
            is_followup_narrow: parseBooleanEnv("IS_FOLLOWUP_NARROW"),
        },
        artifacts: {
            scope_decision_file: scopeDecisionFile,
            prior_threads_file: priorThreadsFile,
            provider_scope_evidence_file: providerEvidence.file,
            provider_scope_evidence_sha256: providerEvidence.sha256,
        },
    };
    validateHandoffObject(handoff, file, file);
    await validateHandoffFacts(handoff, file);
    await writeTextAtomically(path.join(process.cwd(), file), `${json(handoff)}\n`);
    await rm(path.join(process.cwd(), tmpPathFor(file)), { force: true });
    return file;
}
async function writeResult() {
    await requireRepoRoot();
    const prNumber = readPrNumber();
    const headSha = readHeadSha();
    requireResultWriteEnv();
    const file = await prepareResultWrite();
    const handoffFile = expectedHandoffPath(prNumber, headSha);
    const findingsFile = requiredEnv("FINDINGS_FILE");
    const scopeDecisionFile = requiredEnv("SCOPE_DECISION_FILE");
    const priorThreadsFile = optionalEnv("PRIOR_THREADS_FILE") ?? null;
    const reviewBodyFile = optionalEnv("REVIEW_BODY_FILE") ?? null;
    const contextFile = optionalEnv("CONTEXT_FILE") ?? null;
    const renderedPreviewFile = optionalEnv("RENDERED_PREVIEW_FILE") ?? null;
    const presentationNotes = optionalEnv("PRESENTATION_NOTES") ?? null;
    await validateFindingsAuthority(findingsFile);
    await validateScopeAuthority(scopeDecisionFile, await guardedScopeBaseRef(scopeDecisionFile), priorThreadsFile);
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: requiredEnv("REPOSITORY"),
        prNumber,
    });
    await validateHandoffFile(handoffFile, handoffFile);
    await validateOptionalDirectChildReadableArtifact("review body", reviewBodyFile, "-review-body.md");
    validateCanonicalReviewBodyPath(reviewBodyFile, prNumber, headSha);
    await validateOptionalDirectChildReadableArtifact("context", contextFile, "-context.md");
    await validateOptionalDirectChildReadableArtifact("rendered preview", renderedPreviewFile, "-review-preview.md");
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    const result = {
        schema: "pr-review/result/v1",
        pr_number: prNumber,
        repository: requiredEnv("REPOSITORY"),
        review_head_sha: headSha,
        findings_file: findingsFile,
        review_body_file: reviewBodyFile,
        context_file: contextFile,
        artifacts: {
            handoff_file: handoffFile,
            scope_decision_file: scopeDecisionFile,
            prior_threads_file: priorThreadsFile,
            rendered_preview_file: renderedPreviewFile,
            provider_scope_evidence_file: providerEvidence.file,
        },
        digests: {
            handoff_sha256: await sha256File(handoffFile),
            findings_sha256: await sha256File(findingsFile),
            review_body_sha256: reviewBodyFile === null ? null : await sha256File(reviewBodyFile),
            context_sha256: contextFile === null ? null : await sha256File(contextFile),
            scope_decision_sha256: await sha256File(scopeDecisionFile),
            prior_threads_sha256: priorThreadsFile === null ? null : await sha256File(priorThreadsFile),
            rendered_preview_sha256: renderedPreviewFile === null
                ? null
                : await sha256File(renderedPreviewFile),
            provider_scope_evidence_sha256: providerEvidence.sha256,
        },
        scope_decision: {
            summary: stringField(scope, "selection_reason"),
            selected_range: stringField(scope, "selected_range"),
            full_range: stringField(scope, "full_range"),
            is_followup_narrow: booleanField(scope, "is_followup_narrow"),
        },
        presentation: {
            status: requiredEnv("PRESENTATION_STATUS"),
            notes: presentationNotes,
        },
        validation: {
            status: "valid",
            findings_validated: true,
            scope_decision_validated: true,
        },
    };
    validateResultObject(result, file, file);
    await validateResultFacts(result, file);
    await writeTextAtomically(path.join(process.cwd(), file), `${json(result)}\n`);
    await rm(path.join(process.cwd(), tmpPathFor(file)), { force: true });
    return file;
}
async function validateHandoffCommand() {
    requireEnv("REPOSITORY");
    requireEnv("HANDOFF_FILE");
    await validateHandoffFile(requiredEnv("HANDOFF_FILE"));
}
async function validateResultCommand() {
    requireEnv("REPOSITORY");
    requireEnv("RESULT_FILE");
    await validateResultFile(requiredEnv("RESULT_FILE"));
}
async function renderPhase5AuditSummary() {
    for (const name of [
        "REPOSITORY",
        "PR_NUMBER",
        "HEAD_SHA",
        "RESULT_FILE",
        "PRIMARY_REPOSITORY_ROOT",
        "WORKTREE_PATH",
        "LEASE_FILE",
    ]) {
        requireEnv(name);
    }
    const repository = requiredEnv("REPOSITORY");
    const prNumber = readPrNumber();
    const headSha = readHeadSha();
    const resultFile = requiredEnv("RESULT_FILE");
    validateDirectChildPath("result", resultFile, "-result.json");
    const primaryRoot = await requireAbsoluteDirectory("PRIMARY_REPOSITORY_ROOT", requiredEnv("PRIMARY_REPOSITORY_ROOT"));
    const worktreeRoot = await requireAbsoluteDirectory("WORKTREE_PATH", requiredEnv("WORKTREE_PATH"));
    const { result, handoff, findings } = await withCwd(worktreeRoot, async () => {
        await validateResultFile(resultFile);
        const result = await readJsonObject(resultFile, "result file");
        const handoffFile = stringField(objectField(result, "artifacts"), "handoff_file");
        const findingsFile = stringField(result, "findings_file");
        return {
            result,
            handoff: await readJsonObject(handoffFile, "handoff file"),
            findings: await readJsonObject(findingsFile, "findings file"),
        };
    });
    if (stringField(result, "repository") !== repository) {
        fail("result repository mismatch");
    }
    if (numberField(result, "pr_number") !== prNumber) {
        fail("result PR number mismatch");
    }
    if (stringField(result, "review_head_sha") !== headSha) {
        fail("review head mismatch");
    }
    const status = await readLeaseStatus(primaryRoot, worktreeRoot, result);
    const validation = objectField(result, "validation");
    const artifacts = objectField(result, "artifacts");
    const scope = objectField(result, "scope_decision");
    const presentation = objectField(result, "presentation");
    const findingItems = Array.isArray(findings.findings)
        ? findings.findings
        : [];
    const carryForwardItems = Array.isArray(findings.carry_forward)
        ? findings.carry_forward
        : [];
    const code = formatMarkdownCodeSpan;
    return [
        "## Phase 5 Artifact Audit Summary",
        "",
        `- Reviewed head SHA: ${code(headSha)}`,
        `- Repository and PR: ${code(`${repository}#${prNumber}`)}`,
        `- Base/head refs: ${code(stringField(handoff, "base_ref"))} -> ${code(stringField(handoff, "head_ref"))}`,
        `- Active diff range: ${code(stringField(scope, "selected_range"))}`,
        `- Full PR diff range: ${code(stringField(scope, "full_range"))}`,
        `- Result manifest: ${code(resultFile)}`,
        `- Findings: ${code(stringField(result, "findings_file"))} (${findingItems.length} active, ${carryForwardItems.length} carry-forward)`,
        `- Result artifacts: handoff ${code(stringField(artifacts, "handoff_file"))}, scope ${code(stringField(artifacts, "scope_decision_file"))}, prior threads ${formatNullablePath(nullableStringField(artifacts, "prior_threads_file"))}, review body ${formatNullablePath(nullableStringField(result, "review_body_file"))}, context ${formatNullablePath(nullableStringField(result, "context_file"))}, rendered preview ${formatNullablePath(nullableStringField(artifacts, "rendered_preview_file"))}`,
        `- Validation status: result ${code(stringField(validation, "status"))}; findings validated ${code(String(booleanField(validation, "findings_validated")))}; scope validated ${code(String(booleanField(validation, "scope_decision_validated")))}; lease result digest ${code(status.result_sha256)}; lease validated at ${code(status.result_validated_at)}`,
        `- Presentation status: result ${code(stringField(presentation, "status"))}; lease ${code(status.presentation_status)}; presented at ${code(status.presented_at)}`,
        `- Lease/worktree status: lease ${code(status.lease_state)}; worktree ${code(status.worktree_path)}; digest ${code(status.worktree_digest)}; exists ${code(String(status.worktree_exists))}; registered ${code(String(status.worktree_registered))}; dirty ${code(String(status.worktree_dirty))}; identity match ${code(String(status.identity_match))}`,
        "- Cleanup note: lease-gated cleanup pending; cleanup not attempted in Phase 5.",
    ].join("\n");
}
async function readLeaseStatus(primaryRoot, worktreeRoot, result) {
    const outcome = await withCwd(primaryRoot, () => runPrReviewLeasesCommand(["read-status"]));
    if (outcome.exitCode !== 0) {
        const diagnostic = outcome.stderr.trim();
        fail(diagnostic.length > 0
            ? `read-status failed: ${diagnostic}`
            : "read-status failed");
    }
    const status = parseLeaseStatus(outcome.stdout);
    const resultFile = requiredEnv("RESULT_FILE");
    if (status.result_file !== resultFile) {
        fail("read-status result file mismatch");
    }
    if (normalizePathTextForComparison(status.worktree_path) !==
        normalizePathTextForComparison(worktreeRoot)) {
        fail("read-status worktree path mismatch");
    }
    const currentResultSha256 = await withCwd(worktreeRoot, () => sha256File(resultFile));
    if (status.result_sha256 !== currentResultSha256) {
        fail("read-status result digest mismatch");
    }
    if (status.result_validated_at !== status.lease_updated_at) {
        fail("read-status validation timestamp is stale");
    }
    if (status.presentation_status !==
        stringField(objectField(result, "presentation"), "status")) {
        fail("read-status presentation status mismatch");
    }
    if (!status.worktree_exists) {
        fail("read-status worktree does not exist");
    }
    if (!status.worktree_registered) {
        fail("read-status worktree is not registered");
    }
    if (!status.identity_match) {
        fail("read-status identity mismatch");
    }
    return status;
}
function parseLeaseStatus(stdout) {
    let parsed;
    try {
        parsed = JSON.parse(stdout.trim());
    }
    catch {
        fail("read-status stdout must be a single JSON object");
    }
    if (!isObject(parsed)) {
        fail("read-status stdout must be a single JSON object");
    }
    const expectedKeys = [
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
    ];
    if (!hasExactKeys(parsed, expectedKeys)) {
        fail("read-status schema mismatch");
    }
    const status = {
        lease_state: stringField(parsed, "lease_state", "read-status schema mismatch"),
        worktree_path: stringField(parsed, "worktree_path", "read-status schema mismatch"),
        worktree_digest: stringField(parsed, "worktree_digest", "read-status schema mismatch"),
        worktree_exists: booleanField(parsed, "worktree_exists", "read-status schema mismatch"),
        worktree_registered: booleanField(parsed, "worktree_registered", "read-status schema mismatch"),
        worktree_dirty: booleanField(parsed, "worktree_dirty", "read-status schema mismatch"),
        identity_match: booleanField(parsed, "identity_match", "read-status schema mismatch"),
        result_file: stringField(parsed, "result_file", "read-status schema mismatch"),
        result_sha256: stringField(parsed, "result_sha256", "read-status schema mismatch"),
        result_validated_at: stringField(parsed, "result_validated_at", "read-status schema mismatch"),
        lease_updated_at: stringField(parsed, "lease_updated_at", "read-status schema mismatch"),
        presentation_status: stringField(parsed, "presentation_status", "read-status schema mismatch"),
        presented_at: stringField(parsed, "presented_at", "read-status schema mismatch"),
    };
    if (status.lease_state !== "gated") {
        fail("read-status lease state must be gated");
    }
    if (!isAbsolutePath(status.worktree_path)) {
        fail("read-status worktree path must be absolute");
    }
    if (!isSha256(status.worktree_digest)) {
        fail("read-status worktree digest mismatch");
    }
    validateDirectChildPath("read-status result", status.result_file, "-result.json");
    if (!isSha256(status.result_sha256)) {
        fail("read-status result digest mismatch");
    }
    if (!isTimestamp(status.result_validated_at) ||
        !isTimestamp(status.lease_updated_at) ||
        !isTimestamp(status.presented_at)) {
        fail("read-status timestamp mismatch");
    }
    if (status.presentation_status !== "preview-current" &&
        status.presentation_status !== "edited") {
        fail("read-status presentation status mismatch");
    }
    if (!status.worktree_exists) {
        fail("read-status worktree does not exist");
    }
    if (!status.worktree_registered) {
        fail("read-status worktree is not registered");
    }
    if (!status.identity_match) {
        fail("read-status identity mismatch");
    }
    return status;
}
async function requireAbsoluteDirectory(label, value) {
    if (!isAbsolutePath(value)) {
        fail(`${label} must be an absolute path`);
    }
    try {
        const fileStat = await stat(value);
        if (!fileStat.isDirectory()) {
            fail(`${label} must be a directory`);
        }
        return await realpath(value);
    }
    catch (err) {
        if (err instanceof PrReviewManifestError) {
            throw err;
        }
        fail(`${label} must be a readable directory`);
    }
}
async function withCwd(cwd, callback) {
    const previous = process.cwd();
    process.chdir(cwd);
    try {
        return await callback();
    }
    finally {
        process.chdir(previous);
    }
}
function formatNullablePath(value) {
    return value === null
        ? formatMarkdownCodeSpan("none")
        : formatMarkdownCodeSpan(value);
}
function formatMarkdownCodeSpan(value) {
    const backtickRuns = value.match(/`+/gu) ?? [];
    if (backtickRuns.length === 0) {
        return `\`${value}\``;
    }
    const delimiterLength = Math.max(...backtickRuns.map((run) => run.length)) + 1;
    const delimiter = "`".repeat(delimiterLength);
    return `${delimiter} ${value} ${delimiter}`;
}
async function validateHandoffFile(file, identityFile = file) {
    await requireRepoRoot();
    readPrNumber();
    readHeadSha();
    validateDirectChildPath("handoff", file);
    await assertReadableFile("handoff file", file);
    const handoff = await readJsonObject(file, "handoff file");
    validateHandoffObject(handoff, file, identityFile);
    await validateHandoffFacts(handoff, identityFile);
}
async function validateResultFile(file, identityFile = file) {
    await validatePrReviewResultCommandAuthority(readResultValidationInput(file, identityFile));
}
function readResultValidationInput(resultFile, resultIdentityPath = resultFile) {
    return {
        worktreeRoot: process.cwd(),
        resultFile,
        resultIdentityPath,
        repository: requiredEnv("REPOSITORY"),
        prNumber: readPrNumber(),
        reviewHeadSha: readHeadSha(),
        prReviewDir: optionalEnv("PR_REVIEW_DIR"),
        prReviewManifestHelperScript: optionalEnv("PR_REVIEW_MANIFEST_HELPER_SCRIPT"),
        prReviewLeaseHelperScript: optionalEnv("PR_REVIEW_LEASE_HELPER_SCRIPT"),
        playReviewHelper: optionalEnv("PLAY_REVIEW_HELPER"),
        helperEnv: inheritedHelperEnv(),
    };
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
function validateHandoffObject(value, file, identityFile) {
    if (!isObject(value) ||
        !hasExactKeys(value, [
            "schema",
            "pr_number",
            "repository",
            "execution",
            "base_ref",
            "head_ref",
            "review_scope_base_ref",
            "active_diff_range",
            "full_pr_diff_range",
            "review_head_sha",
            "mode",
            "language_hints",
            "follow_up",
            "artifacts",
        ]) ||
        hasForbiddenKey(value)) {
        fail(`handoff schema mismatch: ${file}`);
    }
    const execution = objectField(value, "execution", `handoff schema mismatch: ${file}`);
    const followUp = objectField(value, "follow_up", `handoff schema mismatch: ${file}`);
    const artifacts = objectField(value, "artifacts", `handoff schema mismatch: ${file}`);
    const followState = stringField(followUp, "state", `handoff schema mismatch: ${file}`);
    const lastReviewed = nullableStringField(followUp, "last_reviewed_sha", `handoff schema mismatch: ${file}`);
    const isFollowupNarrow = booleanField(followUp, "is_followup_narrow", `handoff schema mismatch: ${file}`);
    if (stringField(value, "schema", "") !== "pr-review/handoff/v1" ||
        !isPositiveInteger(value.pr_number) ||
        !isRepository(stringField(value, "repository", "")) ||
        !hasExactKeys(execution, ["kind", "working_directory"]) ||
        stringField(execution, "kind", "") !== "review-worktree" ||
        !isAbsolutePath(stringField(execution, "working_directory", "")) ||
        !isRefString(stringField(value, "base_ref", "")) ||
        !isRefString(stringField(value, "head_ref", "")) ||
        !isRefString(stringField(value, "review_scope_base_ref", "")) ||
        stringField(value, "active_diff_range", "").length === 0 ||
        stringField(value, "full_pr_diff_range", "").length === 0 ||
        !isSha(stringField(value, "review_head_sha", "")) ||
        stringField(value, "mode", "") !== "github-post" ||
        !stringArrayField(value, "language_hints", `handoff schema mismatch: ${file}`).every((hint) => /^[a-z0-9][a-z0-9_+-]*$/u.test(hint)) ||
        !hasExactKeys(followUp, [
            "state",
            "last_reviewed_sha",
            "is_followup_narrow",
        ]) ||
        !["initial", "follow-up-full", "follow-up-narrow"].includes(followState) ||
        !hasExactKeys(artifacts, [
            "scope_decision_file",
            "prior_threads_file",
            "provider_scope_evidence_file",
            "provider_scope_evidence_sha256",
        ]) ||
        !isDirectEphemeralPath(stringField(artifacts, "scope_decision_file", ""), "-scope-decision.json") ||
        !isNullableDirectEphemeralPath(artifacts.prior_threads_file, "-prior-threads.json") ||
        !isDirectEphemeralPath(stringField(artifacts, "provider_scope_evidence_file", ""), "-provider-scope-evidence.json") ||
        !isSha256(stringField(artifacts, "provider_scope_evidence_sha256", ""))) {
        fail(`handoff schema mismatch: ${file}`);
    }
    if ((followState === "initial" &&
        (lastReviewed !== null || isFollowupNarrow !== false)) ||
        (followState === "follow-up-narrow" &&
            (!isSha(lastReviewed ?? "") || isFollowupNarrow !== true)) ||
        (followState === "follow-up-full" &&
            (!isSha(lastReviewed ?? "") || isFollowupNarrow !== false))) {
        fail(`handoff schema mismatch: ${file}`);
    }
}
function validateResultObject(value, file, identityFile) {
    if (!isObject(value) ||
        !hasExactKeys(value, [
            "schema",
            "pr_number",
            "repository",
            "review_head_sha",
            "findings_file",
            "review_body_file",
            "context_file",
            "artifacts",
            "digests",
            "scope_decision",
            "presentation",
            "validation",
        ]) ||
        hasForbiddenKey(value)) {
        fail(`result schema mismatch: ${file}`);
    }
    const artifacts = objectField(value, "artifacts", `result schema mismatch: ${file}`);
    const digests = objectField(value, "digests", `result schema mismatch: ${file}`);
    const scope = objectField(value, "scope_decision", `result schema mismatch: ${file}`);
    const presentation = objectField(value, "presentation", `result schema mismatch: ${file}`);
    const validation = objectField(value, "validation", `result schema mismatch: ${file}`);
    if (stringField(value, "schema", "") !== "pr-review/result/v1" ||
        !isPositiveInteger(value.pr_number) ||
        !isRepository(stringField(value, "repository", "")) ||
        !isSha(stringField(value, "review_head_sha", "")) ||
        !isDirectEphemeralPath(stringField(value, "findings_file", ""), "-findings.json") ||
        !isNullableDirectEphemeralPath(value.review_body_file, "-review-body.md") ||
        !isNullableDirectEphemeralPath(value.context_file, "-context.md") ||
        !hasExactKeys(artifacts, [
            "handoff_file",
            "scope_decision_file",
            "prior_threads_file",
            "rendered_preview_file",
            "provider_scope_evidence_file",
        ]) ||
        !isDirectEphemeralPath(stringField(artifacts, "handoff_file", ""), "-handoff.json") ||
        !isDirectEphemeralPath(stringField(artifacts, "scope_decision_file", ""), "-scope-decision.json") ||
        !isNullableDirectEphemeralPath(artifacts.prior_threads_file, "-prior-threads.json") ||
        !isNullableDirectEphemeralPath(artifacts.rendered_preview_file, "-review-preview.md") ||
        !isDirectEphemeralPath(stringField(artifacts, "provider_scope_evidence_file", ""), "-provider-scope-evidence.json") ||
        !hasExactKeys(digests, [
            "handoff_sha256",
            "findings_sha256",
            "review_body_sha256",
            "context_sha256",
            "scope_decision_sha256",
            "prior_threads_sha256",
            "rendered_preview_sha256",
            "provider_scope_evidence_sha256",
        ]) ||
        !isSha256(stringField(digests, "handoff_sha256", "")) ||
        !isSha256(stringField(digests, "findings_sha256", "")) ||
        !isSha256(stringField(digests, "scope_decision_sha256", "")) ||
        !isSha256(stringField(digests, "provider_scope_evidence_sha256", "")) ||
        !digestMatchesNullable(value.review_body_file, digests.review_body_sha256) ||
        !digestMatchesNullable(value.context_file, digests.context_sha256) ||
        !digestMatchesNullable(artifacts.prior_threads_file, digests.prior_threads_sha256) ||
        !digestMatchesNullable(artifacts.rendered_preview_file, digests.rendered_preview_sha256) ||
        !hasExactKeys(scope, [
            "summary",
            "selected_range",
            "full_range",
            "is_followup_narrow",
        ]) ||
        stringField(scope, "summary", "").length === 0 ||
        stringField(scope, "selected_range", "").length === 0 ||
        stringField(scope, "full_range", "").length === 0 ||
        typeof scope.is_followup_narrow !== "boolean" ||
        !hasExactKeys(presentation, ["status", "notes"]) ||
        !["not-presented", "presented", "edited", "preview-current"].includes(stringField(presentation, "status", "")) ||
        !(presentation.notes === null || typeof presentation.notes === "string") ||
        !hasExactKeys(validation, [
            "status",
            "findings_validated",
            "scope_decision_validated",
        ]) ||
        stringField(validation, "status", "") !== "valid" ||
        validation.findings_validated !== true ||
        validation.scope_decision_validated !== true) {
        fail(`result schema mismatch: ${file}`);
    }
}
async function validateHandoffFacts(handoff, identityFile) {
    const prNumber = String(readPrNumber());
    const headSha = readHeadSha();
    const manifestPrNumber = String(numberField(handoff, "pr_number"));
    if (manifestPrNumber !== prNumber) {
        fail(`handoff PR number mismatch: manifest ${manifestPrNumber}, current ${prNumber}`);
    }
    const reviewHeadSha = stringField(handoff, "review_head_sha");
    if (reviewHeadSha !== headSha) {
        fail(`review head mismatch: manifest ${reviewHeadSha}, current ${headSha}`);
    }
    if (stringField(handoff, "repository") !== requiredEnv("REPOSITORY")) {
        fail("handoff repository mismatch");
    }
    const expected = expectedHandoffPath(Number(prNumber), reviewHeadSha);
    if (identityFile !== expected) {
        fail(`handoff path mismatch: ${identityFile}`);
    }
    const execution = objectField(handoff, "execution");
    await validateExecutionRoot(stringField(execution, "working_directory"), reviewHeadSha);
    const artifacts = objectField(handoff, "artifacts");
    const scopeDecisionFile = stringField(artifacts, "scope_decision_file");
    const priorThreadsFile = nullableStringField(artifacts, "prior_threads_file");
    const providerScopeEvidenceFile = stringField(artifacts, "provider_scope_evidence_file");
    const providerScopeEvidenceSha256 = stringField(artifacts, "provider_scope_evidence_sha256");
    const reviewScopeBaseRef = stringField(handoff, "review_scope_base_ref");
    await validateScopeAuthority(scopeDecisionFile, reviewScopeBaseRef, priorThreadsFile);
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: stringField(handoff, "repository"),
        prNumber: Number(prNumber),
    });
    if (providerScopeEvidenceFile !== providerEvidence.file) {
        fail("handoff provider scope evidence mismatch");
    }
    if (providerScopeEvidenceSha256 !== providerEvidence.sha256) {
        fail("handoff provider scope evidence digest mismatch");
    }
    if (reviewScopeBaseRef !== providerEvidence.providerDiffBaseSha) {
        fail("handoff review scope base mismatch");
    }
    await validateDigest("provider scope evidence", providerScopeEvidenceFile, providerScopeEvidenceSha256);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    if (stringField(scope, "head_sha") !== reviewHeadSha) {
        fail("scope decision head mismatch");
    }
    if (stringField(handoff, "active_diff_range") !==
        stringField(scope, "selected_range")) {
        fail("handoff active diff range mismatch");
    }
    if (stringField(handoff, "full_pr_diff_range") !==
        stringField(scope, "full_range")) {
        fail("handoff full diff range mismatch");
    }
    if (!jsonEqual(arrayField(handoff, "language_hints"), arrayField(scope, "language_hints"))) {
        fail("handoff language hints mismatch");
    }
    const followUp = objectField(handoff, "follow_up");
    const scopeMode = stringField(scope, "mode");
    const scopeNarrow = booleanField(scope, "is_followup_narrow");
    const expectedFollowState = scopeMode === "initial" && !scopeNarrow
        ? "initial"
        : scopeMode === "follow-up" && scopeNarrow
            ? "follow-up-narrow"
            : scopeMode === "follow-up" && !scopeNarrow
                ? "follow-up-full"
                : null;
    if (expectedFollowState === null) {
        fail("scope decision follow-up state mismatch");
    }
    if (stringField(followUp, "state") !== expectedFollowState) {
        fail("handoff follow-up state mismatch");
    }
    if ((nullableStringField(followUp, "last_reviewed_sha") ?? "") !==
        (nullableStringField(scope, "last_reviewed_sha") ?? "")) {
        fail("handoff last reviewed SHA mismatch");
    }
    if (booleanField(followUp, "is_followup_narrow") !== scopeNarrow) {
        fail("handoff follow-up narrow mismatch");
    }
}
async function validateResultFacts(result, identityFile) {
    const prNumber = String(readPrNumber());
    const headSha = readHeadSha();
    const manifestPrNumber = String(numberField(result, "pr_number"));
    if (manifestPrNumber !== prNumber) {
        fail(`result PR number mismatch: manifest ${manifestPrNumber}, current ${prNumber}`);
    }
    const reviewHeadSha = stringField(result, "review_head_sha");
    if (reviewHeadSha !== headSha) {
        fail(`review head mismatch: manifest ${reviewHeadSha}, current ${headSha}`);
    }
    const expected = expectedResultPath(Number(manifestPrNumber), reviewHeadSha);
    if (identityFile !== expected) {
        fail(`result path mismatch: ${identityFile}`);
    }
    const artifacts = objectField(result, "artifacts");
    const handoffFile = stringField(artifacts, "handoff_file");
    if (handoffFile !== expectedHandoffPath(Number(manifestPrNumber), reviewHeadSha)) {
        fail("result handoff path mismatch");
    }
    await validateHandoffFile(handoffFile);
    const handoff = await readJsonObject(handoffFile, "handoff file");
    if (stringField(result, "repository") !== stringField(handoff, "repository")) {
        fail("result repository mismatch");
    }
    const findingsFile = stringField(result, "findings_file");
    if (findingsFile !== (await expectedFindingsPath(reviewHeadSha))) {
        fail("findings path mismatch");
    }
    await validateFindingsAuthority(findingsFile);
    const reviewBodyFile = nullableStringField(result, "review_body_file");
    validateCanonicalReviewBodyPath(reviewBodyFile, Number(manifestPrNumber), reviewHeadSha);
    const contextFile = nullableStringField(result, "context_file");
    const renderedPreviewFile = nullableStringField(artifacts, "rendered_preview_file");
    await validateOptionalReadableArtifact("review body file", reviewBodyFile);
    await validateOptionalReadableArtifact("context file", contextFile);
    await validateOptionalReadableArtifact("rendered preview file", renderedPreviewFile);
    const scopeDecisionFile = stringField(artifacts, "scope_decision_file");
    const priorThreadsFile = nullableStringField(artifacts, "prior_threads_file");
    const providerScopeEvidenceFile = stringField(artifacts, "provider_scope_evidence_file");
    const handoffArtifacts = objectField(handoff, "artifacts");
    if (scopeDecisionFile !== stringField(handoffArtifacts, "scope_decision_file")) {
        fail("result handoff scope decision mismatch");
    }
    if ((priorThreadsFile ?? "null") !==
        (nullableStringField(handoffArtifacts, "prior_threads_file") ?? "null")) {
        fail("result handoff prior threads mismatch");
    }
    if (providerScopeEvidenceFile !==
        stringField(handoffArtifacts, "provider_scope_evidence_file")) {
        fail("result handoff provider scope evidence mismatch");
    }
    await validateScopeAuthority(scopeDecisionFile, await guardedScopeBaseRef(scopeDecisionFile), priorThreadsFile);
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: stringField(result, "repository"),
        prNumber: Number(manifestPrNumber),
    });
    if (providerScopeEvidenceFile !== providerEvidence.file) {
        fail("result provider scope evidence mismatch");
    }
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    const summary = objectField(result, "scope_decision");
    if (stringField(summary, "selected_range") !==
        stringField(scope, "selected_range")) {
        fail("result scope selected range mismatch");
    }
    if (stringField(summary, "full_range") !== stringField(scope, "full_range")) {
        fail("result scope full range mismatch");
    }
    if (booleanField(summary, "is_followup_narrow") !==
        booleanField(scope, "is_followup_narrow")) {
        fail("result scope follow-up narrow mismatch");
    }
    if (stringField(summary, "summary") !== stringField(scope, "selection_reason")) {
        fail("result scope summary mismatch");
    }
    const digests = objectField(result, "digests");
    await validateDigest("handoff", handoffFile, stringField(digests, "handoff_sha256"));
    await validateDigest("findings", findingsFile, stringField(digests, "findings_sha256"));
    await validateOptionalDigest("review body", reviewBodyFile, nullableStringField(digests, "review_body_sha256"));
    await validateOptionalDigest("context", contextFile, nullableStringField(digests, "context_sha256"));
    await validateDigest("scope decision", scopeDecisionFile, stringField(digests, "scope_decision_sha256"));
    await validateOptionalDigest("prior threads", priorThreadsFile, nullableStringField(digests, "prior_threads_sha256"));
    await validateOptionalDigest("rendered preview", renderedPreviewFile, nullableStringField(digests, "rendered_preview_sha256"));
    await validateDigest("provider scope evidence", providerScopeEvidenceFile, stringField(digests, "provider_scope_evidence_sha256"));
    if (stringField(digests, "provider_scope_evidence_sha256") !==
        providerEvidence.sha256) {
        fail("provider scope evidence digest mismatch");
    }
}
async function readProviderScopeEvidenceBinding(scopeDecisionFile, expectedIdentity) {
    validateDirectChildPath("scope decision", scopeDecisionFile, "-scope-decision.json");
    await assertReadableFile("scope decision file", scopeDecisionFile);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    const artifacts = objectField(scope, "artifacts", "scope decision artifacts are missing or malformed");
    const file = stringField(artifacts, "provider_scope_evidence_file", "scope decision artifacts are missing or malformed");
    const sha256 = stringField(artifacts, "provider_scope_evidence_sha256", "scope decision artifacts are missing or malformed");
    validateDirectChildPath("provider scope evidence", file, "-provider-scope-evidence.json");
    if (!isSha256(sha256)) {
        fail("scope decision artifacts are missing or malformed");
    }
    await validateDigest("provider scope evidence", file, sha256);
    const evidence = await readJsonObject(file, "provider scope evidence file");
    if (stringField(evidence, "repository") !== expectedIdentity.repository) {
        fail("provider evidence repository mismatch");
    }
    if (numberField(evidence, "pr_number") !== expectedIdentity.prNumber) {
        fail("provider evidence PR number mismatch");
    }
    if (stringField(evidence, "schema") !== "pr-review/provider-scope-evidence/v2") {
        fail("provider evidence schema mismatch");
    }
    if (stringField(evidence, "provider") !== "github") {
        fail("provider evidence provider must be github");
    }
    const baseRefOid = stringField(evidence, "baseRefOid");
    const headRefOid = stringField(evidence, "headRefOid");
    const providerDiffBaseSha = stringField(evidence, "provider_pr_diff_base_sha");
    const localReviewHeadSha = stringField(evidence, "local_review_head_sha");
    for (const [field, value] of [
        ["baseRefOid", baseRefOid],
        ["headRefOid", headRefOid],
        ["provider_pr_diff_base_sha", providerDiffBaseSha],
        ["local_review_head_sha", localReviewHeadSha],
    ]) {
        if (!isSha(value)) {
            fail(`provider evidence ${field} is malformed`);
        }
    }
    if (stringField(evidence, "full_pr_diff_range") !==
        `${providerDiffBaseSha}..${headRefOid}`) {
        fail("provider evidence full range mismatch");
    }
    return { file, sha256, providerDiffBaseSha };
}
async function validateScopeAuthority(scopeDecisionFile, expectedBaseRef, manifestPriorPath) {
    validateDirectChildPath("scope decision", scopeDecisionFile, "-scope-decision.json");
    await assertReadableFile("scope decision file", scopeDecisionFile);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    const artifacts = objectField(scope, "artifacts", "scope decision artifacts are missing or malformed");
    const providerScopeEvidenceFile = stringField(artifacts, "provider_scope_evidence_file", "scope decision artifacts are missing or malformed");
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: requiredEnv("REPOSITORY"),
        prNumber: readPrNumber(),
    });
    if (expectedBaseRef !== providerEvidence.providerDiffBaseSha) {
        fail("scope decision review scope base mismatch");
    }
    validateDirectChildPath("provider scope evidence", providerScopeEvidenceFile, "-provider-scope-evidence.json");
    const priorContext = objectField(scope, "prior_context", "scope decision prior_context is missing or malformed");
    const priorKind = stringField(priorContext, "kind", "scope decision prior_context is missing or malformed");
    const priorPath = nullableStringField(priorContext, "path", "scope decision prior_context is missing or malformed");
    if (priorKind === "none") {
        if (priorPath !== null) {
            fail("scope decision prior_context is missing or malformed");
        }
    }
    else if (priorKind === "github-prior-threads") {
        if (priorPath === null || priorPath.length === 0) {
            fail("scope decision prior_context is missing or malformed");
        }
    }
    else {
        fail("scope decision prior_context is missing or malformed");
    }
    if (manifestPriorPath === null) {
        if (priorKind !== "none") {
            fail(`prior threads path mismatch: manifest null but scope decision requires ${priorPath}`);
        }
    }
    else {
        validateDirectChildPath("prior threads", manifestPriorPath, "-prior-threads.json");
        if (priorKind !== "github-prior-threads") {
            fail(`prior threads path mismatch: manifest ${manifestPriorPath} but scope decision has none`);
        }
        if (manifestPriorPath !== priorPath) {
            fail(`prior threads path mismatch: ${manifestPriorPath}`);
        }
    }
    const scopeHelper = await resolveScopeHelper();
    const env = {
        ...process.env,
        HEAD_SHA: readHeadSha(),
        BASE_REF: expectedBaseRef,
        SCOPE_DECISION_FILE: scopeDecisionFile,
        PROVIDER_SCOPE_EVIDENCE_FILE: providerScopeEvidenceFile,
    };
    await runBashHelper(scopeHelper, "validate-scope-decision", env);
    if (manifestPriorPath !== null) {
        await runBashHelper(scopeHelper, "validate-scope-decision", {
            ...env,
            PRIOR_THREADS_FILE: manifestPriorPath,
        });
        await runBashHelper(scopeHelper, "validate-prior-threads", {
            ...process.env,
            HEAD_SHA: readHeadSha(),
            PRIOR_THREADS_FILE: manifestPriorPath,
        });
    }
}
async function validateFindingsAuthority(findingsFile) {
    validateDirectChildPath("findings", findingsFile, "-findings.json");
    await assertReadableFile("findings file", findingsFile);
    const playHelper = await resolvePlayReviewHelper();
    await runBashHelper(playHelper, "validate-findings", {
        ...process.env,
        HEAD_SHA: readHeadSha(),
        FINDINGS_FILE: findingsFile,
    });
}
async function runBashHelper(helper, command, env) {
    try {
        await execFileAsync("bash", [helper, command], {
            cwd: process.cwd(),
            env,
            maxBuffer: 1024 * 1024,
        });
    }
    catch (err) {
        const stderr = err && typeof err === "object" && "stderr" in err
            ? String(err.stderr).trim()
            : "";
        fail(stderr.length > 0 ? stderr : "helper command failed");
    }
}
async function resolveScopeHelper() {
    const dir = await resolvePrReviewDir();
    return path.join(dir, "scripts/prior-thread-artifacts.sh");
}
async function resolvePrReviewDir() {
    const candidates = [];
    if (process.env.PR_REVIEW_DIR !== undefined) {
        candidates.push(process.env.PR_REVIEW_DIR);
    }
    else if (process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT !== undefined) {
        candidates.push(path.dirname(path.dirname(process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT)));
        candidates.push(path.dirname(path.dirname(await realpath(process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT))));
    }
    for (const candidate of candidates) {
        const helper = path.join(candidate, "scripts/prior-thread-artifacts.sh");
        if (await isExecutableFile(helper)) {
            return candidate;
        }
    }
    fail("pr-review prior-thread artifact helper missing or not executable");
}
async function resolvePlayReviewHelper() {
    const override = process.env.PLAY_REVIEW_HELPER;
    if (override !== undefined) {
        if (await isExecutableFile(override)) {
            return override;
        }
        fail("play-review findings helper missing or not executable");
    }
    const roots = [];
    if (process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT !== undefined) {
        const script = process.env.PR_REVIEW_MANIFEST_HELPER_SCRIPT;
        roots.push(path.dirname(path.dirname(path.dirname(script))));
        roots.push(path.dirname(path.dirname(path.dirname(await realpath(script)))));
    }
    for (const root of roots) {
        const candidate = path.join(root, "play-review/scripts/review-artifacts.sh");
        if (await isExecutableFile(candidate)) {
            return candidate;
        }
    }
    fail("play-review findings helper missing or not executable");
}
async function isExecutableFile(file) {
    try {
        const stat = await lstat(file);
        return (stat.isFile() &&
            (process.platform === "win32" || (stat.mode & 0o111) !== 0));
    }
    catch {
        return false;
    }
}
async function validateExecutionRoot(workingDirectory, reviewHeadSha) {
    if (!isAbsolutePath(workingDirectory)) {
        fail("execution working_directory must be absolute");
    }
    const manifestRoot = await gitTopLevel(process.cwd());
    const manifestRootReal = await realpath(manifestRoot);
    const normalizedWorking = normalizePathTextForComparison(workingDirectory);
    const normalizedRoot = normalizePathTextForComparison(manifestRootReal);
    if (normalizedWorking !== normalizedRoot) {
        fail("execution working_directory must equal repository root");
    }
    try {
        if (!(await stat(workingDirectory)).isDirectory()) {
            fail(`execution working_directory missing: ${workingDirectory}`);
        }
    }
    catch {
        fail(`execution working_directory missing: ${workingDirectory}`);
    }
    const executionDirectory = await realpath(workingDirectory);
    if (normalizePathTextForComparison(executionDirectory) !== normalizedRoot) {
        fail("execution working_directory must equal repository root");
    }
    const executionRoot = await gitTopLevel(workingDirectory);
    if ((await realpath(executionRoot)) !== manifestRootReal) {
        fail("execution working_directory git root mismatch");
    }
    const { stdout } = await execFileAsync("git", [
        "-C",
        workingDirectory,
        "rev-parse",
        "HEAD",
    ]);
    if (stdout.trim() !== reviewHeadSha) {
        fail("execution worktree HEAD mismatch");
    }
}
function normalizeExecutionWorkingDirectory(value) {
    if (!isAbsolutePath(value)) {
        fail("execution working_directory must be absolute");
    }
    return normalizePathTextForComparison(value);
}
async function guardedScopeBaseRef(scopeDecisionFile) {
    validateDirectChildPath("scope decision", scopeDecisionFile, "-scope-decision.json");
    await assertReadableFile("scope decision file", scopeDecisionFile);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    const fullRange = stringField(scope, "full_range");
    if (fullRange.endsWith("...HEAD")) {
        return fullRange.replace(/\.\.\.HEAD$/u, "");
    }
    const explicitRange = /^([0-9a-f]{40})\.\.[0-9a-f]{40}$/u.exec(fullRange);
    return explicitRange?.[1] ?? fullRange;
}
async function validateOptionalReadableArtifact(label, file) {
    if (file === null) {
        return;
    }
    await assertReadableFile(label, file);
}
async function validateOptionalDirectChildReadableArtifact(label, file, suffix) {
    if (file === null) {
        return;
    }
    validateDirectChildPath(label, file, suffix);
    await assertReadableFile(`${label} file`, file);
}
async function validateDigest(label, file, expected) {
    const actual = await sha256File(file);
    if (actual !== expected) {
        fail(`${label} digest mismatch: ${file}`);
    }
}
async function validateOptionalDigest(label, file, expected) {
    if (file === null) {
        if (expected !== null) {
            fail(`${label} digest mismatch: ${file}`);
        }
        return;
    }
    if (expected === null) {
        fail(`${label} digest mismatch: ${file}`);
    }
    await validateDigest(label, file, expected);
}
async function sha256File(file) {
    const hash = createHash("sha256");
    hash.update(await readFile(path.join(process.cwd(), file)));
    return hash.digest("hex");
}
async function readJsonObject(file, label) {
    try {
        const parsed = JSON.parse(await readFile(path.join(process.cwd(), file), "utf-8"));
        if (!isObject(parsed)) {
            fail(`${label} missing or not a regular file: ${file}`);
        }
        return parsed;
    }
    catch (err) {
        if (err instanceof PrReviewManifestError) {
            throw err;
        }
        fail(`${label} missing or not a regular file: ${file}`);
    }
}
async function assertReadableFile(label, file) {
    await guardEphemeral();
    const stat = await lstat(path.join(process.cwd(), file)).catch(() => null);
    if (stat === null) {
        fail(`${label} missing or not a regular file: ${file}`);
    }
    if (stat.isSymbolicLink()) {
        fail(`${label} must not be a symlink: ${file}`);
    }
    if (!stat.isFile()) {
        fail(`${label} missing or not a regular file: ${file}`);
    }
    try {
        await access(path.join(process.cwd(), file), constants.R_OK);
    }
    catch {
        fail(`${label} missing or unreadable: ${file}`);
    }
}
async function prepareWriteTarget(label, file) {
    await guardEphemeral();
    await mkdir(path.join(process.cwd(), ".ephemeral"), { recursive: true });
    const target = path.join(process.cwd(), file);
    const stat = await lstat(target).catch(() => null);
    if (stat === null) {
        return;
    }
    if (stat.isSymbolicLink()) {
        fail(`${label} path must not be a symlink: ${file}`);
    }
    if (stat.isDirectory()) {
        fail(`${label} path is a directory: ${file}`);
    }
    if (!stat.isFile()) {
        fail(`${label} path exists but is not a regular file: ${file}`);
    }
}
async function guardEphemeral() {
    const stat = await lstat(path.join(process.cwd(), ".ephemeral")).catch(() => null);
    if (stat?.isSymbolicLink()) {
        fail(".ephemeral must be a directory, not a symlink");
    }
}
function validateDirectChildPath(label, file, suffix = "") {
    if (file.length === 0) {
        fail(`${label} is required`);
    }
    if (file.includes("\\")) {
        fail(`${label} path validation failed: ${file}`);
    }
    if (file.includes("..")) {
        fail(`path traversal: ${file}`);
    }
    try {
        requireDirectEphemeralChild(file);
    }
    catch {
        if (file.startsWith(".ephemeral/") && file.slice(11).includes("/")) {
            fail(`nested ${label} path rejected: ${file}`);
        }
        fail(`${label} path validation failed: ${file}`);
    }
    if (suffix.length > 0 && !file.endsWith(suffix)) {
        fail(`${label} path validation failed: ${file}`);
    }
}
async function requireRepoRoot() {
    const topLevel = await gitTopLevel(process.cwd());
    const physicalTopLevel = await realpath(topLevel);
    const physicalCwd = await realpath(process.cwd());
    if (physicalTopLevel !== physicalCwd) {
        fail("review-manifests.sh must run from the repository root");
    }
}
async function gitTopLevel(cwd) {
    try {
        const { stdout } = await execFileAsync("git", [
            "-C",
            cwd,
            "rev-parse",
            "--show-toplevel",
        ]);
        return stdout.trim();
    }
    catch {
        fail("failed to determine git repository root");
    }
}
function requireHandoffWriteEnv() {
    for (const name of [
        "REPOSITORY",
        "EXECUTION_WORKING_DIRECTORY",
        "BASE_REF",
        "HEAD_REF",
        "REVIEW_SCOPE_BASE_REF",
        "ACTIVE_DIFF_RANGE",
        "FULL_PR_DIFF_RANGE",
        "MODE",
        "LANGUAGE_HINTS_JSON",
        "FOLLOW_UP_STATE",
        "IS_FOLLOWUP_NARROW",
        "SCOPE_DECISION_FILE",
    ]) {
        requireEnv(name);
    }
}
function requireResultWriteEnv() {
    for (const name of [
        "REPOSITORY",
        "FINDINGS_FILE",
        "SCOPE_DECISION_FILE",
        "PRESENTATION_STATUS",
    ]) {
        requireEnv(name);
    }
}
function readPrNumber() {
    requireEnv("PR_NUMBER");
    return parsePositiveInteger("PR_NUMBER", requiredEnv("PR_NUMBER"));
}
function readHeadSha() {
    requireEnv("HEAD_SHA");
    const headSha = requiredEnv("HEAD_SHA");
    validateShaValue("HEAD_SHA", headSha);
    return headSha;
}
function parsePositiveInteger(label, value) {
    if (!/^[0-9]+$/u.test(value) || value === "0") {
        fail(`${label} must be a positive integer`);
    }
    return Number(value);
}
function validateShaValue(label, value) {
    if (!isSha(value)) {
        fail(`${label} must be a 40-character lowercase hex SHA`);
    }
}
function requireEnv(name) {
    if ((process.env[name] ?? "").length === 0) {
        fail(`${name} is required`);
    }
}
function requiredEnv(name) {
    requireEnv(name);
    return process.env[name] ?? "";
}
function optionalEnv(name) {
    const value = process.env[name];
    return value === undefined || value.length === 0 ? undefined : value;
}
function parseJsonEnv(name) {
    try {
        return JSON.parse(requiredEnv(name));
    }
    catch {
        fail(`${name} must be valid JSON`);
    }
}
function parseBooleanEnv(name) {
    const value = requiredEnv(name);
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    fail(`${name} must be true or false`);
}
function expectedHandoffPath(prNumber, headSha) {
    return `.ephemeral/pr-${prNumber}-${headSha}-handoff.json`;
}
function expectedResultPath(prNumber, headSha) {
    return `.ephemeral/pr-${prNumber}-${headSha}-result.json`;
}
function validateCanonicalReviewBodyPath(reviewBodyFile, prNumber, headSha) {
    if (reviewBodyFile !== null &&
        reviewBodyFile !== `.ephemeral/pr-${prNumber}-${headSha}-review-body.md`) {
        fail(`review body path mismatch: ${reviewBodyFile}`);
    }
}
async function expectedFindingsPath(headSha) {
    const rawBranch = await currentBranchName();
    const branchSlug = rawBranch === "HEAD" ? "detached" : slugBranch(rawBranch);
    return `.ephemeral/${branchSlug}-${headSha}-findings.json`;
}
async function currentBranchName() {
    try {
        const { stdout } = await execFileAsync("git", [
            "rev-parse",
            "--abbrev-ref",
            "HEAD",
        ]);
        return stdout.trim();
    }
    catch {
        fail("failed to determine current git branch");
    }
}
function slugBranch(branchName) {
    const slug = branchName.replaceAll("/", "-").replace(/[^A-Za-z0-9._-]/gu, "");
    if (slug.length === 0 ||
        slug === "." ||
        slug === ".." ||
        slug.startsWith("-") ||
        slug.startsWith(".")) {
        return "unnamed";
    }
    return slug;
}
function tmpPathFor(finalPath) {
    return `.ephemeral/.${finalPath.slice(".ephemeral/".length)}.tmp`;
}
function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function objectField(object, key, message = "runtime validation failed") {
    const value = object[key];
    if (!isObject(value)) {
        fail(message);
    }
    return value;
}
function stringField(object, key, message = "runtime validation failed") {
    const value = object[key];
    if (typeof value !== "string") {
        fail(message);
    }
    return value;
}
function nullableStringField(object, key, message = "runtime validation failed") {
    const value = object[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        fail(message);
    }
    return value;
}
function numberField(object, key) {
    const value = object[key];
    if (typeof value !== "number") {
        fail("runtime validation failed");
    }
    return value;
}
function booleanField(object, key, message = "runtime validation failed") {
    const value = object[key];
    if (typeof value !== "boolean") {
        fail(message);
    }
    return value;
}
function arrayField(object, key) {
    const value = object[key];
    if (!Array.isArray(value)) {
        fail("runtime validation failed");
    }
    return value;
}
function stringArrayField(object, key, message) {
    const value = arrayField(object, key);
    if (!value.every((item) => typeof item === "string")) {
        fail(message);
    }
    return value;
}
function hasExactKeys(object, keys) {
    return jsonEqual(Object.keys(object).sort(), [...keys].sort());
}
function hasForbiddenKey(value) {
    if (Array.isArray(value)) {
        return value.some(hasForbiddenKey);
    }
    if (!isObject(value)) {
        return false;
    }
    return Object.entries(value).some(([key, nested]) => FORBIDDEN_KEYS.has(key) || hasForbiddenKey(nested));
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
function isRepository(value) {
    return /^[^/\s]+\/[^/\s]+$/u.test(value);
}
function isRefString(value) {
    return value.length > 0 && !/[\s\p{Cc}]/u.test(value);
}
function isAbsolutePath(value) {
    return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value);
}
function isDirectEphemeralPath(value, suffix) {
    return (/^\.ephemeral\/[^/]+$/u.test(value) &&
        !value.includes("\\") &&
        !value.includes("..") &&
        value.endsWith(suffix));
}
function isNullableDirectEphemeralPath(value, suffix) {
    return (value === null ||
        (typeof value === "string" && isDirectEphemeralPath(value, suffix)));
}
function isSha(value) {
    return /^[0-9a-f]{40}$/u.test(value);
}
function isSha256(value) {
    return /^[0-9a-f]{64}$/u.test(value);
}
function isTimestamp(value) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value);
}
function digestMatchesNullable(file, digest) {
    return file === null
        ? digest === null
        : typeof digest === "string" && isSha256(digest);
}
function normalizePathTextForComparison(value) {
    if (!/^[A-Za-z]:[\\/]/u.test(value))
        return value;
    return value.replace(/[\\/]+/gu, "/").toLowerCase();
}
function json(value) {
    return JSON.stringify(value, null, 2);
}
function jsonEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return (Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((value, index) => jsonEqual(value, right[index])));
    }
    if (isObject(left) && isObject(right)) {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        return (jsonEqual(leftKeys, rightKeys) &&
            leftKeys.every((key) => jsonEqual(left[key], right[key])));
    }
    return false;
}
function ok(stdout) {
    return { exitCode: 0, stdout, stderr: "" };
}
function fail(message) {
    throw new PrReviewManifestError(message);
}
class PrReviewManifestError extends Error {
    constructor(message) {
        super(message);
        this.name = "PrReviewManifestError";
    }
}
