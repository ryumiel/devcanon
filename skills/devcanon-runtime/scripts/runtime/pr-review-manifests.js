import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rm, stat, } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { writeTextAtomically } from "./artifacts.js";
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
            default:
                throw new PrReviewManifestError("usage: review-manifests.sh prepare-handoff-write|write-handoff|validate-handoff|prepare-result-write|write-result|validate-result");
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
    await validateHandoffFile(handoffFile, handoffFile);
    await validateOptionalDirectChildReadableArtifact("review body", reviewBodyFile, "-review-body.md");
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
    requireEnv("HANDOFF_FILE");
    await validateHandoffFile(requiredEnv("HANDOFF_FILE"));
}
async function validateResultCommand() {
    requireEnv("RESULT_FILE");
    await validateResultFile(requiredEnv("RESULT_FILE"));
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
    await requireRepoRoot();
    readPrNumber();
    readHeadSha();
    validateDirectChildPath("result", file);
    await assertReadableFile("result file", file);
    const result = await readJsonObject(file, "result file");
    validateResultObject(result, file, identityFile);
    await validateResultFacts(result, identityFile);
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
        !hasExactKeys(artifacts, ["scope_decision_file", "prior_threads_file"]) ||
        !isDirectEphemeralPath(stringField(artifacts, "scope_decision_file", ""), "-scope-decision.json") ||
        !isNullableDirectEphemeralPath(artifacts.prior_threads_file, "-prior-threads.json")) {
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
        ]) ||
        !isDirectEphemeralPath(stringField(artifacts, "handoff_file", ""), "-handoff.json") ||
        !isDirectEphemeralPath(stringField(artifacts, "scope_decision_file", ""), "-scope-decision.json") ||
        !isNullableDirectEphemeralPath(artifacts.prior_threads_file, "-prior-threads.json") ||
        !isNullableDirectEphemeralPath(artifacts.rendered_preview_file, "-review-preview.md") ||
        !hasExactKeys(digests, [
            "handoff_sha256",
            "findings_sha256",
            "review_body_sha256",
            "context_sha256",
            "scope_decision_sha256",
            "prior_threads_sha256",
            "rendered_preview_sha256",
        ]) ||
        !isSha256(stringField(digests, "handoff_sha256", "")) ||
        !isSha256(stringField(digests, "findings_sha256", "")) ||
        !isSha256(stringField(digests, "scope_decision_sha256", "")) ||
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
    const expected = expectedHandoffPath(Number(prNumber), reviewHeadSha);
    if (identityFile !== expected) {
        fail(`handoff path mismatch: ${identityFile}`);
    }
    const execution = objectField(handoff, "execution");
    await validateExecutionRoot(stringField(execution, "working_directory"), reviewHeadSha);
    const artifacts = objectField(handoff, "artifacts");
    const scopeDecisionFile = stringField(artifacts, "scope_decision_file");
    const priorThreadsFile = nullableStringField(artifacts, "prior_threads_file");
    const reviewScopeBaseRef = stringField(handoff, "review_scope_base_ref");
    await validateScopeAuthority(scopeDecisionFile, reviewScopeBaseRef, priorThreadsFile);
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
    const contextFile = nullableStringField(result, "context_file");
    const renderedPreviewFile = nullableStringField(artifacts, "rendered_preview_file");
    await validateOptionalReadableArtifact("review body file", reviewBodyFile);
    await validateOptionalReadableArtifact("context file", contextFile);
    await validateOptionalReadableArtifact("rendered preview file", renderedPreviewFile);
    const scopeDecisionFile = stringField(artifacts, "scope_decision_file");
    const priorThreadsFile = nullableStringField(artifacts, "prior_threads_file");
    const handoffArtifacts = objectField(handoff, "artifacts");
    if (scopeDecisionFile !== stringField(handoffArtifacts, "scope_decision_file")) {
        fail("result handoff scope decision mismatch");
    }
    if ((priorThreadsFile ?? "null") !==
        (nullableStringField(handoffArtifacts, "prior_threads_file") ?? "null")) {
        fail("result handoff prior threads mismatch");
    }
    await validateScopeAuthority(scopeDecisionFile, await guardedScopeBaseRef(scopeDecisionFile), priorThreadsFile);
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
}
async function validateScopeAuthority(scopeDecisionFile, expectedBaseRef, manifestPriorPath) {
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
        return stat.isFile() && (stat.mode & 0o111) !== 0;
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
    const normalizedWorking = normalizePathText(workingDirectory);
    const normalizedRoot = normalizePathText(manifestRootReal);
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
    if (normalizePathText(executionDirectory) !== normalizedRoot) {
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
    return value.replace(/\\/gu, "/");
}
async function guardedScopeBaseRef(scopeDecisionFile) {
    validateDirectChildPath("scope decision", scopeDecisionFile, "-scope-decision.json");
    await assertReadableFile("scope decision file", scopeDecisionFile);
    const scope = await readJsonObject(scopeDecisionFile, "scope decision file");
    return stringField(scope, "full_range").replace(/\.\.\.HEAD$/u, "");
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
function digestMatchesNullable(file, digest) {
    return file === null
        ? digest === null
        : typeof digest === "string" && isSha256(digest);
}
function normalizePathText(value) {
    let normalized = value.replace(/\\/gu, "/");
    if (/^\/[A-Za-z]\//u.test(normalized)) {
        normalized = `${normalized[1]}:${normalized.slice(2)}`;
    }
    if (/^[A-Za-z]:\//u.test(normalized)) {
        normalized = normalized.toLowerCase();
    }
    return normalized;
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
