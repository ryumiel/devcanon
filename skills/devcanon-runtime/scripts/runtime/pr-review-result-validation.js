import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeBashScriptEnvPaths, toBashPath } from "./bash-paths.js";
import { requireDirectEphemeralChild } from "./paths.js";
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
export async function validatePrReviewResultEvidence(input) {
    return withCwd(input.worktreeRoot, async () => {
        await requireRepoRoot();
        validateDirectChildPath("result", input.resultFile, "-result.json");
        await assertReadableFile("result file", input.resultFile);
        const result = await readJsonObject(input.resultFile, "result file");
        validateResultObject(result, input.resultFile, input.resultIdentityPath ?? input.resultFile);
        const handoff = await validateResultFacts(result, input);
        return { result, handoff };
    });
}
export async function validatePrReviewResultCommandAuthority(input) {
    await withCwd(input.worktreeRoot, async () => {
        const { result, handoff } = await validatePrReviewResultEvidence({
            worktreeRoot: input.worktreeRoot,
            resultFile: input.resultFile,
            resultIdentityPath: input.resultIdentityPath,
            repository: input.repository,
            prNumber: input.prNumber,
            reviewHeadSha: input.reviewHeadSha,
            leaseBaseRef: input.leaseBaseRef,
            leaseHeadRef: input.leaseHeadRef,
        });
        const findingsFile = stringField(result, "findings_file");
        await validateFindingsAuthority(findingsFile, input);
        const handoffArtifacts = objectField(handoff, "artifacts");
        await validateScopeAuthority(stringField(handoffArtifacts, "scope_decision_file"), stringField(handoff, "review_scope_base_ref"), nullableStringField(handoffArtifacts, "prior_threads_file"), input);
        const artifacts = objectField(result, "artifacts");
        const scopeDecisionFile = stringField(artifacts, "scope_decision_file");
        await validateScopeAuthority(scopeDecisionFile, await guardedScopeBaseRef(scopeDecisionFile), nullableStringField(artifacts, "prior_threads_file"), input);
    });
}
async function validateHandoffFile(file, input, identityPath = file) {
    validateDirectChildPath("handoff", file, "-handoff.json");
    await assertReadableFile("handoff file", file);
    const handoff = await readJsonObject(file, "handoff file");
    validateHandoffObject(handoff, file);
    await validateHandoffFacts(handoff, identityPath, input);
    return handoff;
}
async function validateHandoffFacts(handoff, identityPath, input) {
    const manifestPrNumber = String(numberField(handoff, "pr_number"));
    if (manifestPrNumber !== String(input.prNumber)) {
        fail(`handoff PR number mismatch: manifest ${manifestPrNumber}, current ${input.prNumber}`);
    }
    const reviewHeadSha = stringField(handoff, "review_head_sha");
    if (reviewHeadSha !== input.reviewHeadSha) {
        fail(`review head mismatch: manifest ${reviewHeadSha}, current ${input.reviewHeadSha}`);
    }
    if (stringField(handoff, "repository") !== input.repository) {
        fail("handoff repository mismatch");
    }
    if (input.leaseBaseRef !== undefined &&
        stringField(handoff, "base_ref") !== input.leaseBaseRef) {
        fail("handoff base ref mismatch");
    }
    if (input.leaseHeadRef !== undefined &&
        stringField(handoff, "head_ref") !== input.leaseHeadRef) {
        fail("handoff head ref mismatch");
    }
    const expected = expectedHandoffPath(input.prNumber, reviewHeadSha);
    if (identityPath !== expected) {
        fail(`handoff path mismatch: ${identityPath}`);
    }
    const execution = objectField(handoff, "execution");
    await validateExecutionRoot(stringField(execution, "working_directory"), reviewHeadSha);
    const artifacts = objectField(handoff, "artifacts");
    const scopeDecisionFile = stringField(artifacts, "scope_decision_file");
    const priorThreadsFile = nullableStringField(artifacts, "prior_threads_file");
    const providerScopeEvidenceFile = stringField(artifacts, "provider_scope_evidence_file");
    const providerScopeEvidenceSha256 = stringField(artifacts, "provider_scope_evidence_sha256");
    await validateScopePriorContext(scopeDecisionFile, priorThreadsFile);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: stringField(handoff, "repository"),
        prNumber: numberField(handoff, "pr_number"),
    });
    if (providerScopeEvidenceFile !== providerEvidence.file) {
        fail("handoff provider scope evidence mismatch");
    }
    if (providerScopeEvidenceSha256 !== providerEvidence.sha256) {
        fail("handoff provider scope evidence digest mismatch");
    }
    if (stringField(handoff, "review_scope_base_ref") !==
        providerEvidence.providerDiffBaseSha) {
        fail("handoff review scope base mismatch");
    }
    await validateDigest("provider scope evidence", providerScopeEvidenceFile, providerScopeEvidenceSha256);
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
async function validateResultFacts(result, input) {
    const manifestPrNumber = String(numberField(result, "pr_number"));
    if (manifestPrNumber !== String(input.prNumber)) {
        fail(`result PR number mismatch: manifest ${manifestPrNumber}, current ${input.prNumber}`);
    }
    const reviewHeadSha = stringField(result, "review_head_sha");
    if (reviewHeadSha !== input.reviewHeadSha) {
        fail(`review head mismatch: manifest ${reviewHeadSha}, current ${input.reviewHeadSha}`);
    }
    if (stringField(result, "repository") !== input.repository) {
        fail("result repository mismatch");
    }
    const expected = expectedResultPath(input.prNumber, reviewHeadSha);
    if ((input.resultIdentityPath ?? input.resultFile) !== expected) {
        fail(`result path mismatch: ${input.resultIdentityPath ?? input.resultFile}`);
    }
    const artifacts = objectField(result, "artifacts");
    const handoffFile = stringField(artifacts, "handoff_file");
    if (handoffFile !== expectedHandoffPath(input.prNumber, reviewHeadSha)) {
        fail("result handoff path mismatch");
    }
    const handoff = await validateHandoffFile(handoffFile, input);
    if (stringField(result, "repository") !== stringField(handoff, "repository")) {
        fail("result repository mismatch");
    }
    const findingsFile = stringField(result, "findings_file");
    if (findingsFile !== (await expectedFindingsPath(reviewHeadSha))) {
        fail("findings path mismatch");
    }
    await assertReadableFile("findings file", findingsFile);
    const reviewBodyFile = nullableStringField(result, "review_body_file");
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
    await validateScopePriorContext(scopeDecisionFile, priorThreadsFile);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: stringField(result, "repository"),
        prNumber: numberField(result, "pr_number"),
    });
    if (providerScopeEvidenceFile !== providerEvidence.file) {
        fail("result provider scope evidence mismatch");
    }
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
    return handoff;
}
function validateHandoffObject(value, file) {
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
function validateResultObject(value, file, _identityPath) {
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
async function validateScopeAuthority(scopeDecisionFile, expectedBaseRef, manifestPriorPath, input) {
    validateDirectChildPath("scope decision", scopeDecisionFile, "-scope-decision.json");
    await assertReadableFile("scope decision file", scopeDecisionFile);
    await validateScopePriorContext(scopeDecisionFile, manifestPriorPath);
    const providerEvidence = await readProviderScopeEvidenceBinding(scopeDecisionFile, {
        repository: input.repository,
        prNumber: input.prNumber,
    });
    if (expectedBaseRef !== providerEvidence.providerDiffBaseSha) {
        fail("scope decision review scope base mismatch");
    }
    const scopeHelper = await resolveScopeHelper(input);
    const baseEnv = input.helperEnv ?? {};
    const env = {
        ...baseEnv,
        HEAD_SHA: input.reviewHeadSha,
        BASE_REF: expectedBaseRef,
        SCOPE_DECISION_FILE: scopeDecisionFile,
        PROVIDER_SCOPE_EVIDENCE_FILE: providerEvidence.file,
    };
    await runBashHelper(scopeHelper, "validate-scope-decision", env);
    if (manifestPriorPath !== null) {
        await runBashHelper(scopeHelper, "validate-scope-decision", {
            ...env,
            PRIOR_THREADS_FILE: manifestPriorPath,
        });
        await runBashHelper(scopeHelper, "validate-prior-threads", {
            ...baseEnv,
            HEAD_SHA: input.reviewHeadSha,
            PRIOR_THREADS_FILE: manifestPriorPath,
        });
    }
}
async function validateScopePriorContext(scopeDecisionFile, manifestPriorPath) {
    validateDirectChildPath("scope decision", scopeDecisionFile, "-scope-decision.json");
    await assertReadableFile("scope decision file", scopeDecisionFile);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
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
        return;
    }
    validateDirectChildPath("prior threads", manifestPriorPath, "-prior-threads.json");
    if (priorKind !== "github-prior-threads") {
        fail(`prior threads path mismatch: manifest ${manifestPriorPath} but scope decision has none`);
    }
    if (manifestPriorPath !== priorPath) {
        fail(`prior threads path mismatch: ${manifestPriorPath}`);
    }
}
async function validateFindingsAuthority(findingsFile, input) {
    validateDirectChildPath("findings", findingsFile, "-findings.json");
    await assertReadableFile("findings file", findingsFile);
    const playHelper = await resolvePlayReviewHelper(input);
    await runBashHelper(playHelper, "validate-findings", {
        ...(input.helperEnv ?? {}),
        HEAD_SHA: input.reviewHeadSha,
        FINDINGS_FILE: findingsFile,
    });
}
async function runBashHelper(helper, command, env) {
    try {
        const helperEnv = await normalizeBashScriptEnvPaths(env, [
            "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
        ]);
        await execFileAsync("bash", [await toBashPath(helper, helperEnv), command], {
            cwd: process.cwd(),
            env: helperEnv,
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
async function resolveScopeHelper(input) {
    const dir = await resolvePrReviewDir(input);
    return path.join(dir, "scripts/prior-thread-artifacts.sh");
}
async function resolvePrReviewDir(input) {
    const candidates = [];
    if (input.prReviewDir !== undefined) {
        candidates.push(input.prReviewDir);
    }
    for (const script of [
        input.prReviewManifestHelperScript,
        input.prReviewLeaseHelperScript,
    ]) {
        if (script !== undefined) {
            candidates.push(path.dirname(path.dirname(script)));
            candidates.push(path.dirname(path.dirname(await realpath(script))));
        }
    }
    for (const candidate of candidates) {
        const helper = path.join(candidate, "scripts/prior-thread-artifacts.sh");
        if (await isExecutableFile(helper)) {
            return candidate;
        }
    }
    fail("pr-review prior-thread artifact helper missing or not executable");
}
async function resolvePlayReviewHelper(input) {
    if (input.playReviewHelper !== undefined) {
        if (await isExecutableFile(input.playReviewHelper)) {
            return input.playReviewHelper;
        }
        fail("play-review findings helper missing or not executable");
    }
    const roots = [];
    for (const script of [
        input.prReviewManifestHelperScript,
        input.prReviewLeaseHelperScript,
    ]) {
        if (script !== undefined) {
            roots.push(path.dirname(path.dirname(path.dirname(script))));
            roots.push(path.dirname(path.dirname(path.dirname(await realpath(script)))));
        }
    }
    if (input.prReviewDir !== undefined) {
        roots.push(path.dirname(input.prReviewDir));
        roots.push(path.dirname(await realpath(input.prReviewDir)));
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
        const fileStat = await lstat(file);
        return (fileStat.isFile() &&
            (process.platform === "win32" || (fileStat.mode & 0o111) !== 0));
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
        if (err instanceof PrReviewResultValidationError) {
            throw err;
        }
        fail(`${label} missing or not a regular file: ${file}`);
    }
}
async function assertReadableFile(label, file) {
    await guardEphemeral();
    const fileStat = await lstat(path.join(process.cwd(), file)).catch(() => null);
    if (fileStat === null) {
        fail(`${label} missing or not a regular file: ${file}`);
    }
    if (fileStat.isSymbolicLink()) {
        fail(`${label} must not be a symlink: ${file}`);
    }
    if (!fileStat.isFile()) {
        fail(`${label} missing or not a regular file: ${file}`);
    }
    try {
        await access(path.join(process.cwd(), file), constants.R_OK);
    }
    catch {
        fail(`${label} missing or unreadable: ${file}`);
    }
}
async function guardEphemeral() {
    const fileStat = await lstat(path.join(process.cwd(), ".ephemeral")).catch(() => null);
    if (fileStat?.isSymbolicLink()) {
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
function expectedHandoffPath(prNumber, headSha) {
    return `.ephemeral/pr-${prNumber}-${headSha}-handoff.json`;
}
function expectedResultPath(prNumber, headSha) {
    return `.ephemeral/pr-${prNumber}-${headSha}-result.json`;
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
function digestMatchesNullable(file, digest) {
    return file === null
        ? digest === null
        : typeof digest === "string" && isSha256(digest);
}
function normalizePathTextForComparison(value) {
    let normalized = value.replace(/\\/gu, "/");
    if (/^\/[A-Za-z]\//u.test(normalized)) {
        normalized = `${normalized[1]}:${normalized.slice(2)}`;
    }
    if (/^[A-Za-z]:\//u.test(normalized)) {
        normalized = normalized.toLowerCase();
    }
    return normalized;
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
function fail(message) {
    throw new PrReviewResultValidationError(message);
}
export class PrReviewResultValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "PrReviewResultValidationError";
    }
}
