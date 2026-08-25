import { constants } from "node:fs";
import { access, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { writeTextAtomically } from "./artifacts.js";
import { gitRevParse, runGit } from "./git.js";
import { requireDirectEphemeralChild } from "./paths.js";
const ARTIFACT_KINDS = {
    "issue-body": { label: "issue body", suffix: "-issue-body.md" },
    "comment-evidence": {
        label: "comment evidence",
        suffix: "-comment-evidence.md",
    },
    research: { label: "research", suffix: "-research.md" },
    design: { label: "design", suffix: "-design.md" },
    plan: { label: "plan", suffix: "-plan.md" },
};
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
export async function runIssuePrimingCommand(args, env = process.env) {
    try {
        const [command, ...rest] = args;
        switch (command) {
            case "phase-artifacts":
                return await validatePhaseArtifact(rest);
            case "write-research-brief":
                return await prepareResearchBrief(rest, env);
            case "write-auto-handoff":
                return await writeAutoHandoff(rest, env);
            case "write-assumptions-comment":
                return await prepareAssumptionsComment(rest, env);
            default:
                return plainFail(`unknown issue-priming runtime command: ${command ?? "<missing>"}`);
        }
    }
    catch (err) {
        return plainFail(singleLineMessage(err));
    }
}
async function validatePhaseArtifact(args) {
    if (args.length !== 3 || args[0] !== "validate-read") {
        return plainFail("usage: phase-artifacts validate-read <kind> <repo-relative-path>");
    }
    await requireRepositoryRoot("phase-artifacts");
    const kind = args[1];
    const contract = ARTIFACT_KINDS[kind];
    if (contract === undefined) {
        return plainFail(`unknown phase artifact kind: ${kind}`);
    }
    const artifactPath = args[2];
    requireOwnedPath(artifactPath, contract.suffix, contract.label);
    await assertReadableRegularFile(artifactPath, contract.label);
    return plainOk("");
}
async function prepareResearchBrief(args, env) {
    requireNoArgs("write-research-brief", args);
    const identifier = requireEnv(env, "ISSUE_IDENTIFIER");
    const today = requireEnv(env, "ISSUE_PRIMING_TODAY");
    await requireRepositoryRoot("write-research-brief");
    const slug = slugIdentifier(identifier);
    if (slug.length === 0) {
        return plainFail("ISSUE_IDENTIFIER must contain at least one slug character");
    }
    const target = `.ephemeral/${today}-${slug}-research.md`;
    if (!DATE_PATTERN.test(today)) {
        return plainFail(`research brief path validation failed: ${target}`);
    }
    requireOwnedPath(target, "-research.md", "research brief");
    await prepareWriteTarget(target, "research brief");
    return plainOk(`${target}\n`);
}
async function writeAutoHandoff(args, env) {
    requireNoArgs("write-auto-handoff", args);
    const planPath = requireEnv(env, "PLAN_PATH");
    const cwd = await requireRepositoryRoot("write-auto-handoff");
    requireOwnedPath(planPath, "-plan.md", "plan");
    await assertReadableRegularFile(planPath, "plan");
    const headSha = await gitRevParse("HEAD", { cwd });
    if (!SHA_PATTERN.test(headSha)) {
        return plainFail("git rev-parse HEAD did not return a 40-character lowercase hex SHA");
    }
    const target = `.ephemeral/issue-priming-auto-handoff-${headSha}.json`;
    await prepareWriteTarget(target, "auto handoff");
    const payload = {
        schema: "issue-priming/auto-handoff/v1",
        phase: "issue-priming-workflow:6",
        mode: "auto",
        plan_path: planPath,
        head_sha: headSha,
        phase7_branch_review_fix_required: true,
        phase7_rerun_after_commits: true,
        phase7_final_approval_summary_notice_required: true,
    };
    await writeTextAtomically(path.join(cwd, ...target.split("/")), `${JSON.stringify(payload, null, 2)}\n`);
    return plainOk(`${target}\n`);
}
async function prepareAssumptionsComment(args, env) {
    requireNoArgs("write-assumptions-comment", args);
    const identifier = requireEnv(env, "ISSUE_IDENTIFIER");
    await requireRepositoryRoot("write-assumptions-comment");
    const configuredTarget = env.ASSUMPTIONS_COMMENT_FILE;
    const target = configuredTarget !== undefined && configuredTarget.length > 0
        ? configuredTarget
        : `.ephemeral/${slugIdentifier(identifier)}-assumptions-comment.md`;
    requireOwnedPath(target, "-assumptions-comment.md", "assumptions_comment_file");
    await prepareWriteTarget(target, "assumptions comment");
    return plainOk(`${target}\n`);
}
async function requireRepositoryRoot(helper) {
    const cwd = process.cwd();
    let gitTopLevel;
    try {
        gitTopLevel = (await runGit(["rev-parse", "--show-toplevel"], { cwd }))
            .stdout;
    }
    catch {
        throw new Error("failed to determine git repository root");
    }
    const physicalTopLevel = await realpath(gitTopLevel.trim());
    const physicalCwd = await realpath(cwd);
    if (physicalTopLevel !== physicalCwd) {
        throw new Error(`${helper} must run from the repository root`);
    }
    return physicalCwd;
}
function requireOwnedPath(candidate, suffix, label) {
    if (!candidate.startsWith(".ephemeral/")) {
        throw new Error(`${label} path validation failed: ${candidate}`);
    }
    let directChild;
    try {
        directChild = requireDirectEphemeralChild(candidate);
    }
    catch (err) {
        const message = err.message;
        if (message.includes("direct child")) {
            if (label === "assumptions_comment_file") {
                throw new Error(`${label} must be a direct child of .ephemeral: ${candidate}`);
            }
            throw new Error(`nested ${label} path rejected: ${candidate}`);
        }
        throw new Error(`${label} path validation failed: ${candidate}`);
    }
    if (!directChild.filename.endsWith(suffix)) {
        throw new Error(`${label} path validation failed: ${candidate}`);
    }
    if (candidate.includes("..")) {
        throw new Error(`path traversal: ${candidate}`);
    }
}
async function assertReadableRegularFile(repoRelativePath, label) {
    await assertSafeEphemeralDirectory(false);
    const candidate = path.join(process.cwd(), ...repoRelativePath.split("/"));
    let stat;
    try {
        stat = await lstat(candidate);
    }
    catch {
        throw new Error(`${label} missing or not a regular file: ${repoRelativePath}`);
    }
    if (stat.isSymbolicLink()) {
        throw new Error(`${label} must not be a symlink: ${repoRelativePath}`);
    }
    if (!stat.isFile()) {
        throw new Error(`${label} missing or not a regular file: ${repoRelativePath}`);
    }
    try {
        await access(candidate, constants.R_OK);
    }
    catch {
        throw new Error(`${label} missing or unreadable: ${repoRelativePath}`);
    }
}
async function prepareWriteTarget(repoRelativePath, label) {
    await assertSafeEphemeralDirectory(true);
    const candidate = path.join(process.cwd(), ...repoRelativePath.split("/"));
    try {
        const stat = await lstat(candidate);
        if (stat.isSymbolicLink()) {
            throw new Error(`${label} must not be a symlink: ${repoRelativePath}`);
        }
        if (stat.isDirectory()) {
            throw new Error(`${label} path is a directory: ${repoRelativePath}`);
        }
        if (!stat.isFile()) {
            throw new Error(`${label} path exists but is not a regular file: ${repoRelativePath}`);
        }
    }
    catch (err) {
        if (isNodeError(err, "ENOENT"))
            return;
        throw err;
    }
}
async function assertSafeEphemeralDirectory(create) {
    const ephemeral = path.join(process.cwd(), ".ephemeral");
    try {
        const stat = await lstat(ephemeral);
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(".ephemeral must be a directory, not a symlink");
        }
    }
    catch (err) {
        if (!isNodeError(err, "ENOENT"))
            throw err;
        if (!create)
            return;
        await mkdir(ephemeral);
    }
}
function slugIdentifier(identifier) {
    return identifier
        .toLowerCase()
        .replaceAll("/", "-")
        .replace(/[^a-z0-9._-]/gu, "");
}
function requireEnv(env, name) {
    const value = env[name];
    if (value === undefined || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}
function requireNoArgs(command, args) {
    if (args.length > 0) {
        throw new Error(`${command} does not accept arguments`);
    }
}
function isNodeError(err, code) {
    return (err !== null &&
        typeof err === "object" &&
        "code" in err &&
        err.code === code);
}
function singleLineMessage(err) {
    const message = err instanceof Error ? err.message : String(err);
    return message.replace(/[\r\n]+/gu, " ").trim() || "issue-priming failed";
}
function plainOk(stdout) {
    return { exitCode: 0, stdout, stderr: "" };
}
function plainFail(message) {
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
}
