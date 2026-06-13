import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, readFile, realpath, rm, writeFile, } from "node:fs/promises";
import path from "node:path";
import { runGit } from "./git.js";
import { requireDirectEphemeralChild } from "./paths.js";
const EMPTY_OPTIONS = {
    surface: "",
    headSha: "",
    baseRef: "",
    scopeDecision: "",
    expectedSchema: "",
    priorContextKind: "",
    priorContextPath: "",
    provider: "",
    governedPathPattern: "",
    configuredPathPattern: "",
    maxNarrowChangedFiles: "",
    allowAmbiguousFull: "true",
    priorThreads: "",
    findingsFile: "",
    reviewBodyFile: "",
    reviewEvent: "",
    reviewPayloadFile: "",
    approvalSummaryFile: "",
    riskSignalsFile: "",
    expectedFindingsFile: "",
    expectedScopeDecisionFile: "",
    expectedReviewedRange: "",
    emitGateResult: false,
};
const BRANCH_REVIEW_GOVERNED_PATH_PATTERN = "^(docs/(adr|arch|product-requirements|specs|guidelines)/|MAP\\.md$|AGENTS\\.md$|CONTRIBUTING\\.md$)";
const BRANCH_REVIEW_MAX_NARROW_CHANGED_FILES = "5";
const KNOWN_ESCALATION_REASONS = new Set([
    "not-followup",
    "file-count",
    "governance-path",
    "configured-path",
    "last-reviewed-unusable",
    "public-api",
    "logic-restructure",
    "reviewer-routing-policy",
    "output-schema",
    "install-sync",
    "path-validation-guard",
    "external-invocation-guard",
    "generated-output-renderer",
    "generated-output-contract",
    "source-owned-contract",
    "safety-boundary",
    "broad-scope",
    "architecture-surface",
    "shared-workflow-policy",
    "ambiguous-classification",
]);
const SEMANTIC_ESCALATION_REASONS = new Set([
    "public-api",
    "logic-restructure",
    "reviewer-routing-policy",
    "output-schema",
    "install-sync",
    "path-validation-guard",
    "external-invocation-guard",
    "generated-output-renderer",
    "generated-output-contract",
    "source-owned-contract",
    "safety-boundary",
    "broad-scope",
    "architecture-surface",
    "shared-workflow-policy",
]);
const ACCEPTED_BRANCH_SCOPE_REASON_CODES = new Set([
    "governed_path",
    "file_count",
    "range_validation",
    "language_or_surface_change",
    "semantic_contract_risk",
    "narrow_allowed",
]);
const RESERVED_BRANCH_SCOPE_REASON_CODES = new Set([
    "prior_findings_validation",
]);
const SURFACE_CHANGE_ESCALATION_REASONS = new Set([
    "public-api",
    "reviewer-routing-policy",
    "output-schema",
    "install-sync",
    "generated-output-renderer",
    "generated-output-contract",
    "architecture-surface",
]);
const CONTRACT_RISK_ESCALATION_REASONS = new Set([
    "logic-restructure",
    "path-validation-guard",
    "external-invocation-guard",
    "source-owned-contract",
    "safety-boundary",
    "broad-scope",
    "shared-workflow-policy",
    "ambiguous-classification",
]);
export async function runReviewArtifactsCommand(args) {
    try {
        const [commandName, ...rest] = args;
        const options = parseCommonArgs(rest);
        switch (commandName) {
            case "validate-scope-decision":
                await validateScopeDecision(options);
                return ok("");
            case "validate-prior-threads":
                await validatePriorThreads(options);
                return ok("");
            case "validate-diff-anchors":
                await validateDiffAnchors(options);
                return ok("");
            case "compare-approved-payload":
                return ok(await compareApprovedPayload(options));
            case "validate-approval-summary":
                return ok(await validateApprovalSummary(options));
            case "validate-risk-signals":
                await validateRiskSignals(options);
                return ok("");
            default:
                throw new ReviewArtifactsError("usage: review-artifacts.sh validate-scope-decision|validate-prior-threads|validate-diff-anchors|compare-approved-payload|validate-approval-summary|validate-risk-signals");
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: `${message}\n` };
    }
}
function parseCommonArgs(args) {
    const options = { ...EMPTY_OPTIONS };
    let index = 0;
    while (index < args.length) {
        const flag = args[index];
        if (flag === "--emit-gate-result") {
            options.emitGateResult = true;
            index += 1;
            continue;
        }
        const value = args[index + 1];
        if (value === undefined || value.length === 0) {
            throw new ReviewArtifactsError(`${flag} is required`);
        }
        switch (flag) {
            case "--surface":
                options.surface = value;
                break;
            case "--head-sha":
                options.headSha = value;
                break;
            case "--base-ref":
                options.baseRef = value;
                break;
            case "--scope-decision-file":
                options.scopeDecision = value;
                break;
            case "--expected-schema":
                options.expectedSchema = value;
                break;
            case "--expected-prior-context-kind":
                options.priorContextKind = value;
                break;
            case "--expected-prior-context-path":
                options.priorContextPath = value;
                break;
            case "--governed-path-pattern":
                options.governedPathPattern = value;
                break;
            case "--configured-path-pattern":
                options.configuredPathPattern = value;
                break;
            case "--max-narrow-changed-files":
                options.maxNarrowChangedFiles = value;
                break;
            case "--allow-ambiguous-full-escalation":
                options.allowAmbiguousFull = value;
                break;
            case "--prior-threads-file":
                options.priorThreads = value;
                break;
            case "--provider":
                options.provider = value;
                break;
            case "--findings-file":
                options.findingsFile = value;
                break;
            case "--review-body-file":
                options.reviewBodyFile = value;
                break;
            case "--review-event":
                options.reviewEvent = value;
                break;
            case "--review-payload-file":
                options.reviewPayloadFile = value;
                break;
            case "--approval-summary-file":
                options.approvalSummaryFile = value;
                break;
            case "--risk-signals-file":
                options.riskSignalsFile = value;
                break;
            case "--expected-findings-file":
                options.expectedFindingsFile = value;
                break;
            case "--expected-scope-decision-file":
                options.expectedScopeDecisionFile = value;
                break;
            case "--expected-reviewed-range":
                options.expectedReviewedRange = value;
                break;
            default:
                throw new ReviewArtifactsError(`unknown review-artifacts argument: ${flag}`);
        }
        index += 2;
    }
    return options;
}
async function validateScopeDecision(options) {
    await requireRepoRoot();
    requireScopeFlags(options);
    await validateHeadShaCommit(options.headSha);
    validatePattern("--governed-path-pattern", options.governedPathPattern);
    validatePattern("--configured-path-pattern", options.configuredPathPattern);
    await assertReadableFile("--scope-decision-file", options.scopeDecision);
    validateSuffix("--scope-decision-file", options.scopeDecision, "-scope-decision.json");
    const scope = await readSingleJsonObject(options.scopeDecision, "scope decision JSON validation failed");
    validateScopeShape(scope, options.expectedSchema);
    const artifactSurface = stringField(scope, "surface");
    if (artifactSurface !== options.surface) {
        fail("scope decision surface mismatch");
    }
    const artifactHead = stringField(scope, "head_sha");
    if (artifactHead !== options.headSha) {
        fail("scope decision head mismatch");
    }
    const mode = stringField(scope, "mode");
    const fullRange = stringField(scope, "full_range");
    const selectedRange = stringField(scope, "selected_range");
    const candidateRange = stringField(scope, "candidate_narrow_range");
    const lastReviewed = nullableStringField(scope, "last_reviewed_sha") ?? "";
    const isNarrow = booleanField(scope, "is_followup_narrow");
    const escalationReasons = stringArrayField(scope, "escalation_reasons");
    const mechanicalFacts = objectField(scope, "mechanical_facts");
    const semanticDecision = objectField(scope, "semantic_decision");
    const mechanicalEscalate = booleanField(mechanicalFacts, "mechanical_escalate_full");
    const artifactFollowupUsable = booleanField(mechanicalFacts, "followup_sha_usable");
    const artifactMechanicalReason = stringField(mechanicalFacts, "mechanical_escalation_reason");
    const changedCount = numberField(mechanicalFacts, "changed_file_count");
    const semanticChecked = booleanField(semanticDecision, "checked");
    const semanticAmbiguous = booleanField(semanticDecision, "ambiguous");
    const scopeReasonCodes = options.surface === "branch-review" ? branchScopeReasonCodes(scope) : [];
    rejectUnknownEscalationReasons(escalationReasons);
    if (!semanticChecked) {
        fail("semantic decision must be checked");
    }
    const fullRangeBase = fullRange.endsWith("...HEAD")
        ? fullRange.slice(0, -"...HEAD".length)
        : "";
    if (fullRangeBase.length === 0) {
        fail("full range must end at HEAD");
    }
    if (fullRangeBase.startsWith("-") ||
        fullRangeBase.includes("..") ||
        /\s/u.test(fullRangeBase)) {
        fail("full range base ref is invalid");
    }
    if (!(await gitRefExists(`${fullRangeBase}^{commit}`))) {
        fail("base ref does not resolve");
    }
    if (options.baseRef.length > 0) {
        if (!(await gitRefExists(`${options.baseRef}^{commit}`))) {
            fail("base ref does not resolve");
        }
        if (fullRange !== `${options.baseRef}...HEAD`) {
            fail("full range does not match caller base ref");
        }
    }
    const fullExecRange = gitExecutionRange(fullRange, options.headSha);
    await requireRangeExists(fullExecRange);
    let followupUsable = false;
    if (lastReviewed.length > 0 &&
        (await gitRefExists(`${lastReviewed}^{commit}`)) &&
        (await gitMergeBaseIsAncestor(lastReviewed, options.headSha))) {
        followupUsable = true;
    }
    if (artifactFollowupUsable !== followupUsable) {
        fail("follow-up usability does not match git");
    }
    if (isNarrow) {
        if (mode !== "follow-up") {
            fail("narrow scope requires follow-up mode");
        }
        if (lastReviewed.length === 0) {
            fail("narrow scope requires last_reviewed_sha");
        }
        if (!followupUsable) {
            fail("narrow scope requires usable follow-up sha");
        }
        const expectedRange = `${lastReviewed}..HEAD`;
        if (selectedRange !== expectedRange || candidateRange !== expectedRange) {
            fail("narrow scope must use last-reviewed-sha..HEAD");
        }
        if (mechanicalEscalate) {
            fail("narrow scope cannot claim full escalation");
        }
        if (escalationReasons.length !== 0) {
            fail("narrow scope cannot contain escalation reasons");
        }
    }
    else {
        if (selectedRange !== fullRange) {
            fail("full escalation selected_range must equal full_range");
        }
        if (lastReviewed.length === 0) {
            if (mode !== "initial") {
                fail("full baseline requires initial mode");
            }
            if (candidateRange !== fullRange) {
                fail("initial candidate_narrow_range must equal full_range");
            }
            await requireRangeExists(gitExecutionRange(candidateRange, options.headSha));
            if (!reasonPresent(escalationReasons, "not-followup")) {
                fail("not-followup escalation reason missing");
            }
            if (escalationReasons.length !== 1) {
                fail("not-followup escalation reason missing");
            }
        }
        else {
            if (mode !== "follow-up") {
                fail("full follow-up requires follow-up mode");
            }
            if (escalationReasons.length === 0) {
                fail("full follow-up requires escalation reason");
            }
        }
    }
    const selectedExecRange = gitExecutionRange(selectedRange, options.headSha);
    await requireRangeExists(selectedExecRange);
    if (semanticAmbiguous && isNarrow) {
        fail("ambiguous semantic scope requires full review");
    }
    if (semanticAmbiguous) {
        if (options.allowAmbiguousFull !== "true") {
            fail("ambiguous semantic scope requires explicit allowance");
        }
        if (!reasonPresent(escalationReasons, "ambiguous-classification")) {
            fail("ambiguous-classification escalation reason missing");
        }
    }
    const expectedFiles = await changedFiles(selectedExecRange);
    const actualFiles = stringArrayField(scope, "changed_files").sort();
    if (!jsonEqual(expectedFiles, actualFiles)) {
        fail("changed files do not match selected range");
    }
    let expectedCount = expectedFiles.length;
    let countRangeLabel = "selected range";
    if (lastReviewed.length > 0 && followupUsable) {
        expectedCount = (await changedFiles(gitExecutionRange(`${lastReviewed}..HEAD`, options.headSha))).length;
        countRangeLabel = "candidate range";
    }
    if (changedCount !== expectedCount) {
        fail(`changed file count does not match ${countRangeLabel}`);
    }
    const expectedHints = languageHints(expectedFiles);
    const actualHints = uniqueSorted(stringArrayField(scope, "language_hints"));
    if (!jsonEqual(expectedHints, actualHints)) {
        fail("language hints do not match selected range");
    }
    if (lastReviewed.length > 0) {
        let hasRealFollowupTrigger = false;
        let derivedMechanicalEscalate = false;
        const derivedMechanicalReasons = [];
        const derivedMechanicalScopeCodes = new Set();
        if (!followupUsable) {
            if (isNarrow) {
                fail("narrow scope requires usable follow-up sha");
            }
            if (candidateRange !== fullRange) {
                fail("unusable follow-up scope must use full range");
            }
            if (!reasonPresent(escalationReasons, "last-reviewed-unusable")) {
                fail("last-reviewed-unusable escalation reason missing");
            }
            for (const stale of [
                "file-count",
                "governance-path",
                "configured-path",
            ]) {
                if (reasonPresent(escalationReasons, stale)) {
                    fail(`${stale} escalation reason missing`);
                }
            }
            hasRealFollowupTrigger = true;
            derivedMechanicalEscalate = true;
            derivedMechanicalReasons.push("last-reviewed-unusable");
            derivedMechanicalScopeCodes.add("range_validation");
        }
        if (followupUsable) {
            const expectedCandidateRange = `${lastReviewed}..HEAD`;
            if (candidateRange.length > 0 &&
                candidateRange !== expectedCandidateRange) {
                fail("narrow scope must use last-reviewed-sha..HEAD");
            }
            const candidateFiles = await changedFiles(gitExecutionRange(expectedCandidateRange, options.headSha));
            if (candidateFiles.length > Number(options.maxNarrowChangedFiles)) {
                if (isNarrow) {
                    fail("file count requires full review");
                }
                if (!reasonPresent(escalationReasons, "file-count")) {
                    fail("file-count escalation reason missing");
                }
                hasRealFollowupTrigger = true;
                derivedMechanicalEscalate = true;
                derivedMechanicalReasons.push("file-count");
                derivedMechanicalScopeCodes.add("file_count");
            }
            else if (reasonPresent(escalationReasons, "file-count")) {
                fail("file-count escalation reason missing");
            }
            if (anyPathMatches(candidateFiles, options.governedPathPattern)) {
                if (isNarrow) {
                    fail("governed path requires full review");
                }
                if (!reasonPresent(escalationReasons, "governance-path")) {
                    fail("governance-path escalation reason missing");
                }
                hasRealFollowupTrigger = true;
                derivedMechanicalEscalate = true;
                derivedMechanicalReasons.push("governance-path");
                derivedMechanicalScopeCodes.add("governed_path");
            }
            else if (reasonPresent(escalationReasons, "governance-path")) {
                fail("governance-path escalation reason missing");
            }
            if (anyPathMatches(candidateFiles, options.configuredPathPattern)) {
                if (isNarrow) {
                    fail("configured path requires full review");
                }
                if (!reasonPresent(escalationReasons, "configured-path")) {
                    fail("configured-path escalation reason missing");
                }
                hasRealFollowupTrigger = true;
                derivedMechanicalEscalate = true;
                derivedMechanicalReasons.push("configured-path");
                derivedMechanicalScopeCodes.add("governed_path");
            }
            else if (reasonPresent(escalationReasons, "configured-path")) {
                fail("configured-path escalation reason missing");
            }
            if (reasonPresent(escalationReasons, "last-reviewed-unusable")) {
                fail("last-reviewed-unusable escalation reason missing");
            }
        }
        if (mechanicalEscalate !== derivedMechanicalEscalate) {
            fail("mechanical escalation does not match git");
        }
        const derivedMechanicalReason = derivedMechanicalReasons.join(",");
        if (derivedMechanicalEscalate) {
            if (artifactMechanicalReason !== derivedMechanicalReason) {
                fail("mechanical escalation reason does not match git");
            }
        }
        else if (artifactMechanicalReason.length > 0) {
            fail("mechanical escalation reason does not match git");
        }
        if (reasonPresent(escalationReasons, "ambiguous-classification") &&
            !semanticAmbiguous) {
            fail("ambiguous-classification escalation reason missing");
        }
        if (semanticAmbiguous) {
            hasRealFollowupTrigger = true;
        }
        else if (escalationReasons.some((reason) => SEMANTIC_ESCALATION_REASONS.has(reason))) {
            hasRealFollowupTrigger = true;
        }
        if (reasonPresent(escalationReasons, "not-followup")) {
            fail("not-followup escalation reason missing");
        }
        if (!isNarrow && !hasRealFollowupTrigger) {
            fail("full follow-up requires justified escalation");
        }
        if (options.surface === "branch-review") {
            validateBranchScopeReasonConsistency(scopeReasonCodes, {
                isNarrow,
                isInitial: false,
                escalationReasons,
                semanticAmbiguous,
                expectedMechanicalCodes: derivedMechanicalScopeCodes,
            });
        }
    }
    else if (!mechanicalEscalate ||
        artifactMechanicalReason !== "not-followup") {
        fail("mechanical escalation does not match git");
    }
    else if (options.surface === "branch-review") {
        validateBranchScopeReasonConsistency(scopeReasonCodes, {
            isNarrow,
            isInitial: true,
            escalationReasons,
            semanticAmbiguous,
            expectedMechanicalCodes: new Set(["range_validation"]),
        });
    }
    const priorContext = objectField(scope, "prior_context");
    const artifactPriorKind = stringField(priorContext, "kind");
    const artifactPriorPath = nullableStringField(priorContext, "path") ?? "null";
    if (mode === "initial" &&
        (artifactPriorKind !== "none" || artifactPriorPath !== "null")) {
        fail("initial scope requires no prior context");
    }
    validatePriorContextSurface(artifactPriorKind, options.surface);
    if (artifactPriorKind === "none" && artifactPriorPath !== "null") {
        fail("none prior context requires null path");
    }
    if (artifactPriorKind !== options.priorContextKind) {
        fail("prior context kind mismatch");
    }
    if (artifactPriorPath !== options.priorContextPath) {
        fail("prior context path mismatch");
    }
    return scope;
}
async function validatePriorThreads(options) {
    await requireRepoRoot();
    requireFlag("--surface", options.surface);
    requireFlag("--prior-threads-file", options.priorThreads);
    requireFlag("--expected-schema", options.expectedSchema);
    requireFlag("--provider", options.provider);
    if (options.surface !== "pr-review") {
        fail("validate-prior-threads requires --surface pr-review");
    }
    if (options.expectedSchema !== "pr-review/prior-threads/v1") {
        fail("--expected-schema must be pr-review/prior-threads/v1");
    }
    if (options.provider !== "github") {
        fail("--provider must be github");
    }
    await validateHeadShaCommit(options.headSha);
    await assertReadableFile("--prior-threads-file", options.priorThreads);
    validateSuffix("--prior-threads-file", options.priorThreads, "-prior-threads.json");
    const envelope = await readSingleJsonObject(options.priorThreads, "prior-thread shape validation failed");
    try {
        validatePriorThreadsSchema(envelope, options);
    }
    catch (err) {
        if (err instanceof ReviewArtifactsError &&
            err.message === "runtime validation failed") {
            fail("prior-thread shape validation failed");
        }
        throw err;
    }
}
function validatePriorThreadsSchema(envelope, options) {
    if (!hasExactKeys(envelope, [
        "schema",
        "provider",
        "pr_number",
        "head_sha",
        "threads",
        "dropped",
    ]) ||
        stringField(envelope, "schema") !== options.expectedSchema ||
        stringField(envelope, "provider") !== options.provider ||
        !isPositiveInteger(envelope.pr_number) ||
        stringField(envelope, "head_sha") !== options.headSha ||
        !Array.isArray(envelope.threads) ||
        !Array.isArray(envelope.dropped)) {
        fail("prior-thread shape validation failed");
    }
    for (const thread of envelope.threads) {
        if (!isPriorThread(thread)) {
            fail("prior-thread shape validation failed");
        }
        const threadObject = thread;
        for (const comment of arrayField(threadObject, "comments")) {
            const commentObject = comment;
            if (!isValidTimestamp(stringField(commentObject, "created_at")) ||
                !isValidTimestamp(stringField(commentObject, "updated_at"))) {
                fail("prior-thread timestamp validation failed");
            }
        }
        const modelContext = stringField(threadObject, "model_context");
        const classification = stringField(threadObject, "classification");
        const isResolved = booleanField(threadObject, "is_resolved");
        const isOutdated = booleanField(threadObject, "is_outdated");
        const comments = arrayField(threadObject, "comments");
        const summary = stringField(threadObject, "summary");
        if ((modelContext === "include" &&
            !(classification === "actionable" &&
                !isResolved &&
                !isOutdated &&
                comments.length > 0)) ||
            (modelContext === "summarize" &&
                !(summary.trim().length > 0 && comments.length === 0)) ||
            (modelContext === "drop" && comments.length !== 0) ||
            (classification === "actionable" &&
                !isResolved &&
                !isOutdated &&
                modelContext !== "include")) {
            fail("prior-thread model-context eligibility validation failed");
        }
        const line = nullableNumberField(threadObject, "line");
        const startLine = nullableNumberField(threadObject, "start_line");
        const originalLine = nullableNumberField(threadObject, "original_line");
        const originalStartLine = nullableNumberField(threadObject, "original_start_line");
        if ((startLine !== null && line !== null && startLine > line) ||
            (originalStartLine !== null &&
                originalLine !== null &&
                originalStartLine > originalLine)) {
            fail("prior-thread line range is inverted");
        }
    }
    for (const dropped of envelope.dropped) {
        if (!isDroppedThread(dropped)) {
            fail("dropped-thread shape validation failed");
        }
    }
}
async function validateDiffAnchors(options) {
    const scope = await validateScopeDecision(options);
    requireFlag("--findings-file", options.findingsFile);
    if (options.surface !== "pr-review") {
        fail("validate-diff-anchors requires --surface pr-review");
    }
    await assertReadableFile("--findings-file", options.findingsFile);
    validateSuffix("--findings-file", options.findingsFile, "-findings.json");
    const findings = await assertFindingsEnvelope(options.findingsFile);
    await validateSelectedDiffAnchors(scope, findings, options.headSha);
}
async function compareApprovedPayload(options) {
    const scope = await validateScopeDecision(options);
    if (options.surface !== "pr-review") {
        fail("compare-approved-payload requires --surface pr-review");
    }
    requireFlag("--findings-file", options.findingsFile);
    requireFlag("--review-body-file", options.reviewBodyFile);
    requireFlag("--review-payload-file", options.reviewPayloadFile);
    requireFlag("--review-event", options.reviewEvent);
    if (!["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(options.reviewEvent)) {
        fail("--review-event must be APPROVE, REQUEST_CHANGES, or COMMENT");
    }
    await assertReadableFile("--findings-file", options.findingsFile);
    await assertReadableReviewBodyFile(options.reviewBodyFile);
    await assertReadableFile("--review-payload-file", options.reviewPayloadFile);
    validateSuffix("--findings-file", options.findingsFile, "-findings.json");
    validateSuffix("--review-payload-file", options.reviewPayloadFile, "-review-payload.json");
    const findings = await assertFindingsEnvelope(options.findingsFile);
    await validateSelectedDiffAnchors(scope, findings, options.headSha);
    const actualPayload = await readSingleJsonObject(options.reviewPayloadFile, "review payload JSON validation failed");
    const expectedPayload = buildApprovedReviewPayload({
        headSha: options.headSha,
        reviewEvent: options.reviewEvent,
        reviewBody: await readFile(options.reviewBodyFile, "utf-8"),
        findings,
    });
    if (!jsonEqual(expectedPayload, actualPayload)) {
        fail("approved review payload does not match generated payload");
    }
    const tempDir = await mkdtemp(path.join(process.cwd(), ".ephemeral", ".expected-approved-payload."));
    await rm(tempDir, { recursive: true, force: true });
    const expectedPath = tempDir;
    await writeFile(expectedPath, `${JSON.stringify(expectedPayload, null, 2)}\n`);
    const output = await readFile(expectedPath, "utf-8");
    await rm(expectedPath, { force: true });
    return output;
}
async function validateApprovalSummary(options) {
    await requireRepoRoot();
    requireApprovalSummaryFlags(options);
    await validateHeadShaCommit(options.headSha);
    await assertReadableFile("--approval-summary-file", options.approvalSummaryFile);
    validateSuffix("--approval-summary-file", options.approvalSummaryFile, "-approval-summary.json");
    const summary = await readSingleJsonObject(options.approvalSummaryFile, "approval summary JSON validation failed");
    validateApprovalSummarySchema(summary);
    const terminalState = stringField(summary, "terminal_state");
    const findingsFile = stringField(summary, "findings_file");
    const scopeDecisionFile = stringField(summary, "scope_decision_file");
    const fullRange = stringField(summary, "full_range");
    const selectedRange = stringField(summary, "selected_range");
    const baseRef = stringField(summary, "base_ref");
    if (stringField(summary, "surface") !== options.surface) {
        fail("approval summary surface mismatch");
    }
    if (stringField(summary, "review_head_sha") !== options.headSha) {
        fail("approval summary head mismatch");
    }
    if (fullRange !== `${baseRef}...HEAD`) {
        fail("approval summary full range does not match base_ref");
    }
    validateSummaryBaseRef(baseRef);
    if (!(await gitRefExists(`${baseRef}^{commit}`))) {
        fail("approval summary base_ref does not resolve");
    }
    await requireRangeExists(gitExecutionRange(fullRange, options.headSha));
    await requireRangeExists(gitExecutionRange(selectedRange, options.headSha));
    if (options.expectedFindingsFile.length > 0) {
        validateDirectChildPath("--expected-findings-file", options.expectedFindingsFile);
        validateSuffix("--expected-findings-file", options.expectedFindingsFile, "-findings.json");
        if (options.expectedFindingsFile !== findingsFile) {
            fail("approval summary linked findings path mismatch");
        }
    }
    if (options.expectedScopeDecisionFile.length > 0) {
        validateDirectChildPath("--expected-scope-decision-file", options.expectedScopeDecisionFile);
        validateSuffix("--expected-scope-decision-file", options.expectedScopeDecisionFile, "-scope-decision.json");
        if (options.expectedScopeDecisionFile !== scopeDecisionFile) {
            fail("approval summary linked scope-decision path mismatch");
        }
    }
    await assertReadableFile("--findings-file", findingsFile);
    validateSuffix("--findings-file", findingsFile, "-findings.json");
    await validateFindingsPathMatchesHead(findingsFile, options.headSha);
    await assertReadableFile("--scope-decision-file", scopeDecisionFile);
    validateSuffix("--scope-decision-file", scopeDecisionFile, "-scope-decision.json");
    const scope = await readSingleJsonObject(scopeDecisionFile, "scope decision JSON validation failed");
    validateScopeShape(scope, "branch-review/scope-decision/v1");
    await validateScopeDecision(scopeOptionsForApprovalSummary(options, summary, scope));
    validateApprovalScopeLink(summary, scope);
    const findings = await assertFindingsEnvelope(findingsFile);
    await validateApprovalDigest("approval summary findings digest mismatch", findingsFile, stringField(summary, "findings_sha256"));
    await validateApprovalDigest("approval summary scope-decision digest mismatch", scopeDecisionFile, stringField(summary, "scope_decision_sha256"));
    const counts = findingsCounts(findings);
    if (numberField(summary, "blocker_count") !== counts.blockerCount) {
        fail("approval summary blocker count mismatch");
    }
    if (numberField(summary, "nit_count") !== counts.nitCount) {
        fail("approval summary nit count mismatch");
    }
    if (numberField(summary, "carry_forward_count") !== counts.carryForwardCount) {
        fail("approval summary carry-forward count mismatch");
    }
    validateTerminalStateMatchesCounts(terminalState, counts);
    if (!options.emitGateResult) {
        return "";
    }
    return `${JSON.stringify({
        terminal_state: terminalState,
        gate_result: gateResultForApprovalTerminalState(terminalState),
    })}\n`;
}
async function validateRiskSignals(options) {
    await requireRepoRoot();
    requireRiskSignalsFlags(options);
    await validateHeadShaCommit(options.headSha);
    await validateCurrentHead(options.headSha);
    await assertReadableFile("--risk-signals-file", options.riskSignalsFile);
    validateSuffix("--risk-signals-file", options.riskSignalsFile, "-risk-signals.json");
    const riskSignals = await readSingleJsonObject(options.riskSignalsFile, "risk-signals JSON validation failed");
    validateRiskSignalsSchema(riskSignals, options.expectedSchema);
    const reviewedHeadSha = stringField(riskSignals, "reviewed_head_sha");
    if (!isSha(reviewedHeadSha)) {
        fail("risk-signals head is malformed");
    }
    if (reviewedHeadSha !== options.headSha) {
        fail("risk-signals head mismatch");
    }
    const reviewedRange = stringField(riskSignals, "reviewed_range");
    if (reviewedRange !== options.expectedReviewedRange) {
        fail("risk-signals reviewed range mismatch");
    }
    await requireRangeExists(gitExecutionRange(reviewedRange, options.headSha));
    const reviewedBaseSha = stringField(riskSignals, "reviewed_base_sha");
    if (!(await gitRefExists(`${reviewedBaseSha}^{commit}`))) {
        fail("risk-signals base sha does not resolve");
    }
    const expectedFiles = await changedFiles(gitExecutionRange(reviewedRange, options.headSha));
    const actualFiles = uniqueSorted(stringArrayField(riskSignals, "changed_files"));
    if (!jsonEqual(expectedFiles, actualFiles)) {
        fail("risk-signals changed files do not match expected range");
    }
}
function requireRiskSignalsFlags(options) {
    requireFlag("--surface", options.surface);
    requireFlag("--head-sha", options.headSha);
    requireFlag("--risk-signals-file", options.riskSignalsFile);
    requireFlag("--expected-schema", options.expectedSchema);
    requireFlag("--expected-reviewed-range", options.expectedReviewedRange);
    if (options.surface !== "branch-review") {
        fail("validate-risk-signals requires --surface branch-review");
    }
    if (options.expectedSchema !== "branch-review/risk-signals/v1") {
        fail("--expected-schema must be branch-review/risk-signals/v1");
    }
}
function validateRiskSignalsSchema(riskSignals, expectedSchema) {
    try {
        const topLevelKeys = [
            "schema",
            "producer",
            "evidence_source",
            "reviewed_base_ref",
            "reviewed_base_sha",
            "reviewed_head_sha",
            "reviewed_range",
            "changed_files",
            "signals",
            "canonical_docs_may_be_affected",
            "end_user_diagnostics_may_be_affected",
        ];
        if (!hasExactKeys(riskSignals, Object.hasOwn(riskSignals, "notes")
            ? [...topLevelKeys, "notes"]
            : topLevelKeys) ||
            stringField(riskSignals, "schema") !== expectedSchema ||
            stringField(riskSignals, "producer") !== "play-subagent-execution" ||
            stringField(riskSignals, "reviewed_base_ref").length === 0 ||
            !isSha(stringField(riskSignals, "reviewed_base_sha")) ||
            stringField(riskSignals, "reviewed_head_sha").length === 0 ||
            stringField(riskSignals, "reviewed_range").length === 0 ||
            !stringArrayField(riskSignals, "changed_files").every(isSafeRiskSignalRepoPath) ||
            typeof riskSignals.canonical_docs_may_be_affected !== "boolean" ||
            typeof riskSignals.end_user_diagnostics_may_be_affected !== "boolean" ||
            (Object.hasOwn(riskSignals, "notes") &&
                typeof riskSignals.notes !== "string")) {
            fail("risk-signals schema mismatch");
        }
        validateRiskSignalsEvidenceSource(objectField(riskSignals, "evidence_source"));
        validateRiskSignalsSignals(objectField(riskSignals, "signals"));
    }
    catch (err) {
        if (err instanceof ReviewArtifactsError &&
            err.message === "runtime validation failed") {
            fail("risk-signals schema mismatch");
        }
        throw err;
    }
}
function validateRiskSignalsEvidenceSource(evidenceSource) {
    const keys = Object.keys(evidenceSource);
    if (!keys.includes("kind") ||
        !keys.every((key) => ["kind", "path", "summary"].includes(key)) ||
        stringField(evidenceSource, "kind") !== "executor-terminal-handoff" ||
        (Object.hasOwn(evidenceSource, "path") &&
            !isSafeRiskSignalRepoPath(stringField(evidenceSource, "path"))) ||
        (Object.hasOwn(evidenceSource, "summary") &&
            typeof evidenceSource.summary !== "string")) {
        fail("risk-signals schema mismatch");
    }
}
function validateRiskSignalsSignals(signals) {
    const signalKeys = [
        "user_facing_behavior",
        "documentation_examples",
        "diagnostics",
        "contract",
        "generated_output",
        "governance_path",
    ];
    if (!hasExactKeys(signals, signalKeys) ||
        !signalKeys.every((key) => ["none", "present", "unknown"].includes(stringField(signals, key)))) {
        fail("risk-signals schema mismatch");
    }
}
function requireApprovalSummaryFlags(options) {
    requireFlag("--approval-summary-file", options.approvalSummaryFile);
    requireFlag("--head-sha", options.headSha);
    requireFlag("--surface", options.surface);
    if (options.surface !== "branch-review") {
        fail("validate-approval-summary requires --surface branch-review");
    }
}
function validateApprovalSummarySchema(summary) {
    if ("gate_passed" in summary) {
        fail("approval summary contains forbidden field: gate_passed");
    }
    try {
        if (!hasExactKeys(summary, [
            "schema",
            "surface",
            "review_head_sha",
            "base_ref",
            "full_range",
            "selected_range",
            "scope_decision_file",
            "scope_decision_sha256",
            "findings_file",
            "findings_sha256",
            "terminal_state",
            "blocker_count",
            "nit_count",
            "carry_forward_count",
        ]) ||
            stringField(summary, "schema") !== "branch-review/approval-summary/v1" ||
            stringField(summary, "surface") !== "branch-review" ||
            !isSha(stringField(summary, "review_head_sha")) ||
            stringField(summary, "base_ref").length === 0 ||
            stringField(summary, "full_range").length === 0 ||
            stringField(summary, "selected_range").length === 0 ||
            !isDirectEphemeralPath(stringField(summary, "scope_decision_file")) ||
            !isDirectEphemeralPath(stringField(summary, "findings_file")) ||
            !isSha256(stringField(summary, "scope_decision_sha256")) ||
            !isSha256(stringField(summary, "findings_sha256")) ||
            !isNonNegativeInteger(summary.blocker_count) ||
            !isNonNegativeInteger(summary.nit_count) ||
            !isNonNegativeInteger(summary.carry_forward_count)) {
            fail("approval summary schema mismatch");
        }
    }
    catch (err) {
        if (err instanceof ReviewArtifactsError &&
            err.message === "runtime validation failed") {
            fail("approval summary schema mismatch");
        }
        throw err;
    }
    if (!isApprovalTerminalState(stringField(summary, "terminal_state"))) {
        fail("approval summary terminal_state is invalid");
    }
}
function validateSummaryBaseRef(baseRef) {
    if (baseRef.length === 0 ||
        baseRef.startsWith("-") ||
        baseRef.includes("..") ||
        /\s/u.test(baseRef)) {
        fail("approval summary base_ref is invalid");
    }
}
function validateApprovalScopeLink(summary, scope) {
    if (stringField(scope, "surface") !== "branch-review") {
        fail("linked scope decision surface mismatch");
    }
    if (stringField(scope, "head_sha") !== stringField(summary, "review_head_sha")) {
        fail("linked scope decision head mismatch");
    }
    if (stringField(scope, "full_range") !== stringField(summary, "full_range")) {
        fail("linked scope decision full range mismatch");
    }
    if (stringField(scope, "selected_range") !==
        stringField(summary, "selected_range")) {
        fail("linked scope decision selected range mismatch");
    }
}
function scopeOptionsForApprovalSummary(options, summary, scope) {
    const priorContext = objectField(scope, "prior_context");
    const priorPath = nullableStringField(priorContext, "path") ?? "null";
    return {
        ...EMPTY_OPTIONS,
        surface: "branch-review",
        headSha: options.headSha,
        baseRef: stringField(summary, "base_ref"),
        scopeDecision: stringField(summary, "scope_decision_file"),
        expectedSchema: "branch-review/scope-decision/v1",
        priorContextKind: stringField(priorContext, "kind"),
        priorContextPath: priorPath,
        governedPathPattern: BRANCH_REVIEW_GOVERNED_PATH_PATTERN,
        configuredPathPattern: options.configuredPathPattern,
        maxNarrowChangedFiles: BRANCH_REVIEW_MAX_NARROW_CHANGED_FILES,
    };
}
async function validateApprovalDigest(message, file, expectedDigest) {
    const digest = createHash("sha256")
        .update(await readFile(file, "utf-8"))
        .digest("hex");
    if (digest !== expectedDigest) {
        fail(message);
    }
}
function findingsCounts(findings) {
    const currentFindings = arrayField(findings, "findings").map((item) => item);
    const carryForwardFindings = arrayField(findings, "carry_forward").map((item) => item);
    const remainingFindings = uniqueFindingsByContent([
        ...currentFindings,
        ...carryForwardFindings,
    ]);
    return {
        blockerCount: remainingFindings.filter((finding) => stringField(finding, "severity") === "Blocking").length,
        nitCount: remainingFindings.filter((finding) => stringField(finding, "severity") === "Nit").length,
        carryForwardCount: carryForwardFindings.length,
    };
}
function uniqueFindingsByContent(findings) {
    const unique = [];
    for (const finding of findings) {
        if (!unique.some((existing) => jsonEqual(existing, finding))) {
            unique.push(finding);
        }
    }
    return unique;
}
function validateTerminalStateMatchesCounts(terminalState, counts) {
    if (terminalState === "invalid") {
        return;
    }
    const expectedState = counts.blockerCount > 0
        ? "blocked"
        : counts.nitCount > 0 || counts.carryForwardCount > 0
            ? "approved_with_nits"
            : "approved";
    if (terminalState !== expectedState) {
        fail("approval summary terminal_state contradicts counts");
    }
}
export function gateResultForApprovalTerminalState(terminalState) {
    switch (terminalState) {
        case "approved":
        case "approved_with_nits":
            return "passing";
        case "blocked":
        case "invalid":
            return "blocking";
    }
}
async function validateSelectedDiffAnchors(scope, findings, headSha) {
    const selectedRange = stringField(scope, "selected_range");
    const selectedExecRange = gitExecutionRange(selectedRange, headSha);
    for (const finding of arrayField(findings, "findings").map((item) => item)) {
        if (!["natural", "missing-file"].includes(stringField(finding, "anchor"))) {
            continue;
        }
        const line = numberField(finding, "line");
        const lineHunk = await diffHunkForFileLine(selectedExecRange, stringField(finding, "path"), line);
        if (lineHunk === null) {
            fail("inline anchor is outside selected review diff");
        }
        const startLine = nullableNumberField(finding, "start_line");
        if (startLine !== null) {
            if (startLine > line) {
                fail("diff anchor line range is inverted");
            }
            const startHunk = await diffHunkForFileLine(selectedExecRange, stringField(finding, "path"), startLine);
            if (startHunk === null) {
                fail("inline anchor is outside selected review diff");
            }
            if (startHunk !== lineHunk) {
                fail("inline anchor range crosses selected review diff hunks");
            }
        }
    }
}
async function assertFindingsEnvelope(file) {
    const envelope = await readSingleJsonObject(file, "findings envelope JSON validation failed");
    try {
        validateFindingsEnvelopeSchema(envelope);
    }
    catch (err) {
        if (err instanceof ReviewArtifactsError &&
            err.message === "runtime validation failed") {
            fail("findings envelope validation failed");
        }
        throw err;
    }
    return envelope;
}
function validateFindingsEnvelopeSchema(envelope) {
    if (stringField(envelope, "schema") !== "play-review/findings/v1" ||
        !Array.isArray(envelope.findings) ||
        !Array.isArray(envelope.carry_forward)) {
        fail("findings envelope validation failed");
    }
    for (const finding of allFindings(envelope)) {
        if (!isFinding(finding)) {
            fail("findings envelope validation failed");
        }
    }
}
function allFindings(envelope) {
    return [
        ...arrayField(envelope, "findings"),
        ...arrayField(envelope, "carry_forward"),
    ].map((item) => item);
}
function validateScopeShape(scope, expectedSchema) {
    try {
        validateScopeShapeSchema(scope, expectedSchema);
    }
    catch (err) {
        if (err instanceof ReviewArtifactsError &&
            err.message === "runtime validation failed") {
            fail("scope decision schema mismatch");
        }
        throw err;
    }
}
function validateScopeShapeSchema(scope, expectedSchema) {
    const baseScopeKeys = [
        "schema",
        "surface",
        "mode",
        "selected_range",
        "full_range",
        "candidate_narrow_range",
        "is_followup_narrow",
        "selection_reason",
        "escalation_reasons",
        "last_reviewed_sha",
        "head_sha",
        "changed_files",
        "language_hints",
        "prior_context",
        "mechanical_facts",
        "semantic_decision",
    ];
    const expectedScopeKeys = expectedSchema === "branch-review/scope-decision/v1"
        ? [...baseScopeKeys, "scope_reason_codes", "scope_explanation"]
        : baseScopeKeys;
    if (expectedSchema === "branch-review/scope-decision/v1" &&
        !Object.hasOwn(scope, "scope_reason_codes")) {
        fail("scope_reason_codes is required");
    }
    if (expectedSchema === "branch-review/scope-decision/v1" &&
        !Object.hasOwn(scope, "scope_explanation")) {
        fail("scope_explanation is required");
    }
    if (!hasExactKeys(scope, expectedScopeKeys) ||
        stringField(scope, "schema") !== expectedSchema ||
        !["pr-review", "branch-review"].includes(stringField(scope, "surface")) ||
        !["initial", "follow-up"].includes(stringField(scope, "mode")) ||
        !isSha(stringField(scope, "head_sha")) ||
        stringField(scope, "full_range").length === 0 ||
        stringField(scope, "selected_range").length === 0 ||
        stringField(scope, "candidate_narrow_range").length === 0 ||
        !isNullableSha(scope.last_reviewed_sha) ||
        typeof scope.is_followup_narrow !== "boolean" ||
        stringField(scope, "selection_reason").length === 0 ||
        !stringArrayField(scope, "changed_files").every(isRepoPath) ||
        !stringArrayField(scope, "language_hints").every((hint) => hint.length >= 0) ||
        !stringArrayField(scope, "escalation_reasons").every((reason) => reason.length > 0)) {
        fail("scope decision schema mismatch");
    }
    if (expectedSchema === "branch-review/scope-decision/v1") {
        validateBranchScopeReasonShape(scope);
    }
    const priorContext = objectField(scope, "prior_context");
    if (!["github-prior-threads", "branch-findings", "none"].includes(stringField(priorContext, "kind")) ||
        !(priorContext.path === null || typeof priorContext.path === "string") ||
        (stringField(priorContext, "kind") !== "none" &&
            !isDirectEphemeralPath(String(priorContext.path)))) {
        fail("scope decision schema mismatch");
    }
    const mechanicalFacts = objectField(scope, "mechanical_facts");
    if (!hasExactKeys(mechanicalFacts, [
        "changed_file_count",
        "followup_sha_usable",
        "mechanical_escalate_full",
        "mechanical_escalation_reason",
    ]) ||
        !isNonNegativeInteger(mechanicalFacts.changed_file_count) ||
        typeof mechanicalFacts.followup_sha_usable !== "boolean" ||
        typeof mechanicalFacts.mechanical_escalate_full !== "boolean" ||
        typeof mechanicalFacts.mechanical_escalation_reason !== "string") {
        fail("scope decision schema mismatch");
    }
    const semanticDecision = objectField(scope, "semantic_decision");
    if (!hasExactKeys(semanticDecision, ["checked", "ambiguous", "notes"]) ||
        typeof semanticDecision.checked !== "boolean" ||
        typeof semanticDecision.ambiguous !== "boolean" ||
        typeof semanticDecision.notes !== "string") {
        fail("scope decision schema mismatch");
    }
}
function validateBranchScopeReasonShape(scope) {
    const codes = branchScopeReasonCodes(scope);
    const explanation = stringField(scope, "scope_explanation");
    if (explanation.trim().length === 0) {
        fail("scope_explanation must not be empty");
    }
    const seen = new Set();
    for (const code of codes) {
        if (RESERVED_BRANCH_SCOPE_REASON_CODES.has(code)) {
            fail(`reserved scope reason code: ${code}`);
        }
        if (!ACCEPTED_BRANCH_SCOPE_REASON_CODES.has(code)) {
            fail(`unknown scope reason code: ${code}`);
        }
        if (seen.has(code)) {
            fail(`duplicate scope reason code: ${code}`);
        }
        seen.add(code);
    }
}
function branchScopeReasonCodes(scope) {
    if (!Array.isArray(scope.scope_reason_codes)) {
        fail("scope_reason_codes must be an array");
    }
    if (!scope.scope_reason_codes.every((code) => typeof code === "string") ||
        !stringArrayField(scope, "scope_reason_codes").every((code) => code.length > 0)) {
        fail("scope_reason_codes must contain non-empty strings");
    }
    return stringArrayField(scope, "scope_reason_codes");
}
function validateBranchScopeReasonConsistency(scopeReasonCodes, facts) {
    const actualCodes = new Set(scopeReasonCodes);
    if (facts.isNarrow) {
        if (scopeReasonCodes.length !== 1 ||
            scopeReasonCodes[0] !== "narrow_allowed") {
            fail("narrow follow-up requires scope_reason_codes narrow_allowed");
        }
        return;
    }
    if (actualCodes.has("narrow_allowed")) {
        fail("narrow_allowed requires narrow follow-up scope");
    }
    if (facts.isInitial && !actualCodes.has("range_validation")) {
        fail("initial full review requires scope_reason_codes range_validation");
    }
    const expectedCodes = new Set(facts.expectedMechanicalCodes);
    for (const reason of facts.escalationReasons) {
        if (SURFACE_CHANGE_ESCALATION_REASONS.has(reason)) {
            expectedCodes.add("language_or_surface_change");
        }
        if (CONTRACT_RISK_ESCALATION_REASONS.has(reason)) {
            expectedCodes.add("semantic_contract_risk");
        }
    }
    if (facts.semanticAmbiguous) {
        expectedCodes.add("semantic_contract_risk");
    }
    if (!setEquals(actualCodes, expectedCodes)) {
        fail("scope reason codes do not match escalation reasons");
    }
}
function requireScopeFlags(options) {
    requireFlag("--scope-decision-file", options.scopeDecision);
    requireFlag("--surface", options.surface);
    requireFlag("--expected-schema", options.expectedSchema);
    requireFlag("--expected-prior-context-kind", options.priorContextKind);
    requireFlag("--expected-prior-context-path", options.priorContextPath);
    requireFlag("--governed-path-pattern", options.governedPathPattern);
    requireFlag("--max-narrow-changed-files", options.maxNarrowChangedFiles);
    if (!["pr-review", "branch-review"].includes(options.surface)) {
        fail("--surface must be pr-review or branch-review");
    }
    if (![
        "pr-review/scope-decision/v1",
        "branch-review/scope-decision/v1",
    ].includes(options.expectedSchema)) {
        fail("--expected-schema is invalid");
    }
    if (options.expectedSchema !== `${options.surface}/scope-decision/v1`) {
        fail("--expected-schema does not match --surface");
    }
    if (!["github-prior-threads", "branch-findings", "none"].includes(options.priorContextKind)) {
        fail("--expected-prior-context-kind is invalid");
    }
    validatePriorContextSurface(options.priorContextKind, options.surface);
    if (options.priorContextKind === "none" &&
        options.priorContextPath !== "null") {
        fail("none prior context requires null path");
    }
    if (options.priorContextPath !== "null" &&
        (options.priorContextPath.length === 0 ||
            options.priorContextPath.startsWith("/") ||
            options.priorContextPath.includes("..") ||
            options.priorContextPath.includes("//") ||
            options.priorContextPath.includes("/./") ||
            options.priorContextPath.startsWith("./"))) {
        fail("--expected-prior-context-path must be repo-relative or null");
    }
    if (!/^[0-9]+$/u.test(options.maxNarrowChangedFiles)) {
        fail("--max-narrow-changed-files must be an integer");
    }
    if (!["true", "false"].includes(options.allowAmbiguousFull)) {
        fail("--allow-ambiguous-full-escalation must be true or false");
    }
}
function validatePriorContextSurface(kind, surface) {
    if (kind === "github-prior-threads" && surface !== "pr-review") {
        fail("github-prior-threads prior context is pr-review only");
    }
    if (kind === "branch-findings" && surface !== "branch-review") {
        fail("branch-findings prior context is branch-review only");
    }
}
async function requireRepoRoot() {
    const gitTopLevel = (await git(["rev-parse", "--show-toplevel"])).trim();
    const physicalTopLevel = await realpath(gitTopLevel);
    const physicalCwd = await realpath(process.cwd());
    if (physicalTopLevel !== physicalCwd) {
        fail("review-artifacts.sh must run from the repository root");
    }
}
async function validateHeadShaCommit(headSha) {
    requireFlag("--head-sha", headSha);
    if (!isSha(headSha)) {
        fail("--head-sha must be a 40-character lowercase hex SHA");
    }
    if (!(await gitRefExists(`${headSha}^{commit}`))) {
        fail("--head-sha does not resolve to a commit");
    }
}
async function validateCurrentHead(headSha) {
    const currentHead = (await git(["rev-parse", "HEAD"])).trim();
    if (currentHead !== headSha) {
        fail("--head-sha must match current repository HEAD");
    }
}
async function assertReadableFile(label, file) {
    validateDirectChildPath(label, file);
    await assertEphemeralDirectory();
    const stat = await lstat(file).catch(() => null);
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
        await access(file, constants.R_OK);
    }
    catch {
        fail(`${label} missing or unreadable: ${file}`);
    }
}
async function assertReadableReviewBodyFile(file) {
    validateReviewBodyPath(file);
    await assertEphemeralDirectory();
    const stat = await lstat(file).catch(() => null);
    if (stat === null) {
        fail(`review body missing or not a regular file: ${file}`);
    }
    if (stat.isSymbolicLink()) {
        fail(`review body must not be a symlink: ${file}`);
    }
    if (!stat.isFile()) {
        fail(`review body missing or not a regular file: ${file}`);
    }
    try {
        await access(file, constants.R_OK);
    }
    catch {
        fail(`review body missing or unreadable: ${file}`);
    }
}
function validateDirectChildPath(label, file) {
    if (file.length === 0) {
        fail(`${label} is required`);
    }
    if (file.includes("..")) {
        fail(`path traversal: ${file}`);
    }
    if (file.startsWith(".ephemeral/") &&
        file.slice(".ephemeral/".length).includes("/")) {
        fail(`nested ${label} path rejected: ${file}`);
    }
    if (!file.startsWith(".ephemeral/")) {
        fail(`${label} path validation failed: ${file}`);
    }
    try {
        requireDirectEphemeralChild(file);
    }
    catch {
        fail(`${label} path validation failed: ${file}`);
    }
}
function validateReviewBodyPath(file) {
    if (file.length === 0) {
        fail("--review-body-file is required");
    }
    if (file.startsWith("/") ||
        file.includes("..") ||
        file.startsWith("./") ||
        file.includes("//") ||
        /^[A-Za-z]:/u.test(file) ||
        file.includes("\\")) {
        fail(`review body path validation failed: ${file}`);
    }
    if (file.startsWith(".ephemeral/") &&
        file.slice(".ephemeral/".length).includes("/")) {
        fail(`nested review body path rejected: ${file}`);
    }
    if (!file.startsWith(".ephemeral/") &&
        !file.endsWith(".md") &&
        !file.endsWith(".markdown")) {
        fail(`review body path validation failed: ${file}`);
    }
}
async function assertEphemeralDirectory() {
    const stat = await lstat(".ephemeral").catch(() => undefined);
    if (stat?.isSymbolicLink()) {
        fail(".ephemeral must be a directory, not a symlink");
    }
}
function validateSuffix(label, file, suffix) {
    if (!file.endsWith(suffix)) {
        fail(`${label} path validation failed: ${file}`);
    }
}
async function validateFindingsPathMatchesHead(findingsFile, headSha) {
    const expectedFindingsFile = await expectedFindingsPath(headSha);
    if (findingsFile !== expectedFindingsFile) {
        fail("findings path mismatch");
    }
}
async function expectedFindingsPath(headSha) {
    const rawBranch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const branchSlug = rawBranch === "HEAD" ? "detached" : slugBranchForFindings(rawBranch);
    return `.ephemeral/${branchSlug}-${headSha}-findings.json`;
}
function slugBranchForFindings(branchName) {
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
async function readSingleJsonObject(file, failureMessage) {
    try {
        const parsed = JSON.parse(await readFile(file, "utf-8"));
        if (parsed === null ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)) {
            fail(failureMessage);
        }
        return parsed;
    }
    catch (err) {
        if (err instanceof ReviewArtifactsError) {
            throw err;
        }
        fail(failureMessage);
    }
}
async function changedFiles(range) {
    const stdout = await git(["diff", "-z", "--name-only", range]);
    return stdout.split("\0").filter(Boolean).sort();
}
function languageHints(files) {
    return uniqueSorted(files
        .map((file) => /\.([A-Za-z0-9_+-]+)$/u.exec(file)?.[1])
        .filter((ext) => ext !== undefined)
        .map((ext) => ext.toLowerCase()));
}
export function buildApprovedReviewPayload(input) {
    let reviewBody = stripTrailingNewlines(input.reviewBody);
    const outOfDiffBodies = allFindings(input.findings)
        .filter((finding) => stringField(finding, "anchor") === "out-of-diff")
        .map((finding) => stringField(finding, "body"));
    if (outOfDiffBodies.length > 0) {
        const outOfDiff = `## Out-of-diff Findings\n\n${outOfDiffBodies.join("\n\n")}`;
        reviewBody =
            reviewBody.length > 0 ? `${reviewBody}\n\n${outOfDiff}` : outOfDiff;
    }
    return {
        commit_id: input.headSha,
        event: input.reviewEvent,
        body: reviewBody,
        comments: arrayField(input.findings, "findings")
            .map((item) => item)
            .filter((finding) => ["natural", "missing-file"].includes(stringField(finding, "anchor")))
            .map((finding) => {
            const anchor = stringField(finding, "anchor");
            const comment = {
                path: stringField(finding, "path"),
                line: numberField(finding, "line"),
                side: "RIGHT",
                body: anchor === "missing-file"
                    ? `Missing-file finding (no natural anchor — see body):\n\n${stringField(finding, "body")}`
                    : stringField(finding, "body"),
            };
            const startLine = nullableNumberField(finding, "start_line");
            if (startLine !== null) {
                comment.start_line = startLine;
                comment.start_side = "RIGHT";
            }
            return comment;
        }),
    };
}
function gitExecutionRange(publicRange, headSha) {
    if (publicRange.endsWith("...HEAD")) {
        return `${publicRange.slice(0, -4)}${headSha}`;
    }
    if (publicRange.endsWith("..HEAD")) {
        return `${publicRange.slice(0, -4)}${headSha}`;
    }
    return publicRange;
}
async function requireRangeExists(range) {
    if (!(await gitDiffRangeExists(range))) {
        fail("review range does not resolve");
    }
}
async function diffHunkForFileLine(range, file, line) {
    const diff = await git(["diff", range, "--", file]);
    return diffHunkForLine(diff, line);
}
export function diffHunkForLine(diff, line) {
    let hunk = 0;
    for (const diffLine of diff.split("\n")) {
        if (!diffLine.startsWith("@@ ")) {
            continue;
        }
        hunk += 1;
        const match = /\+([0-9]+)(?:,([0-9]+))?/u.exec(diffLine);
        if (!match) {
            continue;
        }
        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count === 0) {
            continue;
        }
        const end = start + count - 1;
        if (line >= start && line <= end) {
            return hunk;
        }
    }
    return null;
}
function stripTrailingNewlines(value) {
    return value.replace(/\n+$/u, "");
}
async function git(args) {
    try {
        const { stdout } = await runGit(args, { cwd: process.cwd() });
        return stdout;
    }
    catch {
        fail(args[0] === "rev-parse"
            ? "failed to determine git repository root"
            : "git command failed");
    }
}
async function gitRefExists(ref) {
    return (await gitStatus(["cat-file", "-e", ref])) === 0;
}
async function gitMergeBaseIsAncestor(ancestor, descendant) {
    return ((await gitStatus(["merge-base", "--is-ancestor", ancestor, descendant])) ===
        0);
}
async function gitDiffRangeExists(range) {
    const status = await gitStatus(["diff", "--quiet", range]);
    return status <= 1;
}
async function gitStatus(args) {
    return new Promise((resolve) => {
        const child = execFile("git", [...args], { cwd: process.cwd(), shell: false, windowsHide: true }, (error) => {
            if (error && typeof error === "object" && "code" in error) {
                resolve(Number(error.code));
            }
            else {
                resolve(0);
            }
        });
        child.on("error", () => resolve(128));
    });
}
function validatePattern(label, pattern) {
    if (pattern.length === 0) {
        return;
    }
    try {
        new RegExp(toJavaScriptRegex(pattern));
    }
    catch {
        fail(`${label} must be a valid extended regular expression`);
    }
}
function anyPathMatches(files, pattern) {
    if (pattern.length === 0) {
        return false;
    }
    const regex = new RegExp(toJavaScriptRegex(pattern));
    return files.some((file) => regex.test(file));
}
function toJavaScriptRegex(pattern) {
    return pattern
        .replace(/\\</gu, "\\b")
        .replace(/\\>/gu, "\\b")
        .replace(/\[:alnum:\]/gu, "A-Za-z0-9")
        .replace(/\[:alpha:\]/gu, "A-Za-z")
        .replace(/\[:blank:\]/gu, " \\t")
        .replace(/\[:cntrl:\]/gu, "\\x00-\\x1F\\x7F")
        .replace(/\[:digit:\]/gu, "0-9")
        .replace(/\[:graph:\]/gu, "\\x21-\\x7E")
        .replace(/\[:lower:\]/gu, "a-z")
        .replace(/\[:print:\]/gu, "\\x20-\\x7E")
        .replace(/\[:punct:\]/gu, "!\"#$%&'()*+,\\-./:;<=>?@[\\\\\\]^_`{|}~")
        .replace(/\[:space:\]/gu, "\\s")
        .replace(/\[:upper:\]/gu, "A-Z")
        .replace(/\[:xdigit:\]/gu, "A-Fa-f0-9");
}
function rejectUnknownEscalationReasons(reasons) {
    if (!reasons.every((reason) => KNOWN_ESCALATION_REASONS.has(reason))) {
        fail("unknown escalation reason");
    }
}
function reasonPresent(reasons, reason) {
    return reasons.includes(reason);
}
function isPriorThread(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const thread = value;
    return (hasExactKeys(thread, [
        "thread_id",
        "is_resolved",
        "is_outdated",
        "path",
        "line",
        "original_line",
        "start_line",
        "original_start_line",
        "classification",
        "model_context",
        "staleness_reason",
        "comments",
        "summary",
    ]) &&
        isGithubNodeId(thread.thread_id) &&
        typeof thread.is_resolved === "boolean" &&
        typeof thread.is_outdated === "boolean" &&
        isRepoPath(thread.path) &&
        isNullablePositiveInteger(thread.line) &&
        isNullablePositiveInteger(thread.original_line) &&
        isNullablePositiveInteger(thread.start_line) &&
        isNullablePositiveInteger(thread.original_start_line) &&
        [
            "actionable",
            "resolved",
            "outdated",
            "bot-boilerplate",
            "review-request",
            "reaction-only",
            "conversation",
            "unknown",
        ].includes(String(thread.classification)) &&
        ["include", "summarize", "drop"].includes(String(thread.model_context)) &&
        typeof thread.staleness_reason === "string" &&
        Array.isArray(thread.comments) &&
        thread.comments.every(isPriorComment) &&
        typeof thread.summary === "string");
}
function isPriorComment(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const comment = value;
    const allowed = [
        "author",
        "author_association",
        "created_at",
        "updated_at",
        "body",
        "is_bot",
        "minimized_reason",
    ];
    return (Object.keys(comment).every((key) => allowed.includes(key)) &&
        typeof comment.author === "string" &&
        comment.author.length > 0 &&
        (comment.author_association === undefined ||
            comment.author_association === null ||
            (typeof comment.author_association === "string" &&
                comment.author_association.length > 0)) &&
        typeof comment.created_at === "string" &&
        typeof comment.updated_at === "string" &&
        typeof comment.body === "string" &&
        typeof comment.is_bot === "boolean" &&
        (comment.minimized_reason === undefined ||
            comment.minimized_reason === null ||
            typeof comment.minimized_reason === "string"));
}
function isDroppedThread(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const dropped = value;
    return (hasExactKeys(dropped, ["thread_id", "classification", "reason"]) &&
        isGithubNodeId(dropped.thread_id) &&
        [
            "resolved",
            "outdated",
            "bot-boilerplate",
            "review-request",
            "reaction-only",
            "conversation",
            "unknown",
        ].includes(String(dropped.classification)) &&
        typeof dropped.reason === "string" &&
        dropped.reason.length > 0);
}
function isFinding(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const finding = value;
    const startLine = nullableNumberField(finding, "start_line");
    const line = typeof finding.line === "number" ? finding.line : null;
    return (isRepoPath(finding.path) &&
        isPositiveInteger(finding.line) &&
        (finding.start_line === undefined ||
            finding.start_line === null ||
            isPositiveInteger(finding.start_line)) &&
        ["Blocking", "Nit"].includes(String(finding.severity)) &&
        [
            "Logic",
            "Safety",
            "Architecture",
            "Tests",
            "Maintainability",
            "Documentation",
            "Contracts",
        ].includes(String(finding.category)) &&
        (finding.severity === "Nit"
            ? finding.critic === null
            : finding.critic === undefined ||
                finding.critic === null ||
                ["VALID", "INVALID", "DOWNGRADE"].includes(String(finding.critic))) &&
        ["natural", "missing-file", "out-of-diff"].includes(String(finding.anchor)) &&
        typeof finding.why === "string" &&
        typeof finding.recommendation === "string" &&
        typeof finding.body === "string" &&
        (startLine === null || (line !== null && startLine <= line)));
}
function isValidTimestamp(value) {
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]+)?Z$/u.exec(value);
    if (!match) {
        return false;
    }
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return (month >= 1 &&
        month <= 12 &&
        day >= 1 &&
        day <= daysInMonth &&
        hour >= 0 &&
        hour <= 23 &&
        minute >= 0 &&
        minute <= 59 &&
        second >= 0 &&
        second <= 59);
}
function isRepoPath(value) {
    return (typeof value === "string" &&
        value.length > 0 &&
        !value.startsWith("/") &&
        value
            .split("/")
            .every((part) => part !== "" && part !== "." && part !== ".."));
}
function isSafeRiskSignalRepoPath(value) {
    return (isRepoPath(value) &&
        !value.startsWith("./") &&
        !value.includes("\\") &&
        !/^[A-Za-z]:/u.test(value));
}
function isDirectEphemeralPath(value) {
    return /^\.ephemeral\/[^/]+$/u.test(value) && !value.includes("..");
}
function isGithubNodeId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_+=/-]+$/u.test(value);
}
function isSha(value) {
    return /^[0-9a-f]{40}$/u.test(value);
}
function isSha256(value) {
    return /^[0-9a-f]{64}$/u.test(value);
}
function isApprovalTerminalState(value) {
    return ["approved", "approved_with_nits", "blocked", "invalid"].includes(value);
}
function isNullableSha(value) {
    return value === null || (typeof value === "string" && isSha(value));
}
function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1;
}
function isNullablePositiveInteger(value) {
    return value === null || isPositiveInteger(value);
}
function requireFlag(label, value) {
    if (value.length === 0) {
        fail(`${label} is required`);
    }
}
function stringField(object, key) {
    const value = object[key];
    if (typeof value !== "string") {
        fail("runtime validation failed");
    }
    return value;
}
function nullableStringField(object, key) {
    const value = object[key];
    if (value === null) {
        return null;
    }
    if (typeof value !== "string") {
        fail("runtime validation failed");
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
function nullableNumberField(object, key) {
    const value = object[key];
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== "number") {
        fail("runtime validation failed");
    }
    return value;
}
function booleanField(object, key) {
    const value = object[key];
    if (typeof value !== "boolean") {
        fail("runtime validation failed");
    }
    return value;
}
function objectField(object, key) {
    const value = object[key];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        fail("runtime validation failed");
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
function stringArrayField(object, key) {
    const value = arrayField(object, key);
    if (!value.every((item) => typeof item === "string")) {
        fail("runtime validation failed");
    }
    return [...value];
}
function hasExactKeys(object, keys) {
    const actual = Object.keys(object).sort();
    const expected = [...keys].sort();
    return jsonEqual(actual, expected);
}
function uniqueSorted(values) {
    return [...new Set(values)].sort();
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
    if (left !== null &&
        right !== null &&
        typeof left === "object" &&
        typeof right === "object") {
        const leftObject = left;
        const rightObject = right;
        const leftKeys = Object.keys(leftObject).sort();
        const rightKeys = Object.keys(rightObject).sort();
        return (jsonEqual(leftKeys, rightKeys) &&
            leftKeys.every((key) => jsonEqual(leftObject[key], rightObject[key])));
    }
    return false;
}
function setEquals(left, right) {
    return left.size === right.size && [...left].every((item) => right.has(item));
}
function ok(stdout) {
    return { exitCode: 0, stdout, stderr: "" };
}
function fail(message) {
    throw new ReviewArtifactsError(message);
}
class ReviewArtifactsError extends Error {
    constructor(message) {
        super(message);
        this.name = "ReviewArtifactsError";
    }
}
