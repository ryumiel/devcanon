import { runResolveBashCommand } from "./bash.js";
import { runGitWorkspaceCleanupCommand } from "./git-workspace-cleanup.js";
import { runIssuePrimingCommand } from "./issue-priming.js";
import { runIssueWorktreeSetupCommand } from "./issue-worktree-setup.js";
import { RuntimePathError, normalizeRuntimePath, requireDirectEphemeralChild, } from "./paths.js";
import { runPlayReviewSharedContextCommand } from "./play-review-shared-context.js";
import { runPrMergeWorktreeCommand } from "./pr-merge-worktree.js";
import { runPrReviewLeasesCommand } from "./pr-review-leases.js";
import { runPrReviewManifestsCommand } from "./pr-review-manifests.js";
import { runPrReviewProviderScopeEvidenceCommand, runReviewArtifactsCommand, } from "./review-artifacts.js";
import { getRuntimeConfigValue, loadRuntimeConfigCatalog, runtimeConfigPath, } from "./runtime-config.js";
import { runSourceImmutabilityCommand } from "./source-immutability.js";
export const RUNTIME_COMMAND_CONTRACT = {
    command_group: "devcanon-runtime",
    major_version: 1,
    helper_foundation: true,
};
export async function runRuntimeCommand(args) {
    try {
        const [command, ...rest] = args;
        switch (command) {
            case "contract":
                requireNoArgs(command, rest);
                return ok(RUNTIME_COMMAND_CONTRACT);
            case "resolve-bash":
                return await runResolveBashCommand(rest);
            case "path-info":
                return ok(pathInfo(rest));
            case "config":
                return await runtimeConfig(rest);
            case "ephemeral-child":
                return ok(ephemeralChild(rest));
            case "validate-json":
                return validateJson(rest);
            case "review-artifacts":
                return await runReviewArtifactsCommand(rest);
            case "pr-review-provider-scope-evidence":
                return await runPrReviewProviderScopeEvidenceCommand(rest);
            case "play-review-shared-context":
                return await runPlayReviewSharedContextCommand(rest);
            case "issue-worktree-setup":
                return await runIssueWorktreeSetupCommand(rest);
            case "issue-priming":
                return await runIssuePrimingCommand(rest);
            case "git-workspace-cleanup":
                return await runGitWorkspaceCleanupCommand(rest);
            case "pr-merge-worktree":
                return await runPrMergeWorktreeCommand(rest);
            case "pr-review-manifests":
                return await runPrReviewManifestsCommand(rest);
            case "pr-review-leases":
                return await runPrReviewLeasesCommand(rest);
            case "source-immutability":
                return await runSourceImmutabilityCommand(rest);
            default:
                return fail("unknown-command", `unknown devcanon-runtime command: ${command ?? "<missing>"}`);
        }
    }
    catch (err) {
        if (err instanceof RuntimePathError) {
            return fail(err.problem, err.message);
        }
        return fail("runtime-error", err.message);
    }
}
function pathInfo(args) {
    const pathValue = requiredOption(args, "--path");
    const platform = optionalPlatform(args);
    return normalizeRuntimePath(pathValue, platform);
}
async function runtimeConfig(args) {
    const [command, ...rest] = args;
    switch (command) {
        case "path":
            requireNoArgs("config path", rest);
            await loadRuntimeConfigCatalog();
            return ok({ path: runtimeConfigPath() });
        case "get": {
            const key = requiredConfigGetKey(rest);
            return ok({
                key,
                value: getRuntimeConfigValue(await loadRuntimeConfigCatalog(), key),
            });
        }
        default:
            return fail("unknown-config-command", `unknown devcanon-runtime config command: ${command ?? "<missing>"}`);
    }
}
function requiredConfigGetKey(args) {
    if (args.length !== 2 || args[0] !== "--key" || args[1].length === 0) {
        throw new Error("config get requires exactly --key <nonempty>");
    }
    return args[1];
}
function ephemeralChild(args) {
    return requireDirectEphemeralChild(requiredOption(args, "--path"));
}
function validateJson(args) {
    const payload = requiredOption(args, "--payload");
    const schemaName = requiredOption(args, "--schema");
    if (schemaName !== "command-envelope") {
        throw new Error(`unknown schema: ${schemaName}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(payload);
    }
    catch {
        return fail("invalid-json", "payload must be valid JSON");
    }
    if (parsed === null ||
        typeof parsed !== "object" ||
        !("command" in parsed) ||
        typeof parsed.command !== "string" ||
        parsed.command.length === 0) {
        return fail("invalid-command-envelope", "command is required");
    }
    return ok({ ok: true, value: parsed });
}
function requiredOption(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1 || index + 1 >= args.length) {
        throw new Error(`${flag} requires a value`);
    }
    return args[index + 1];
}
function optionalOption(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1) {
        return undefined;
    }
    if (index + 1 >= args.length) {
        throw new Error(`${flag} requires a value`);
    }
    return args[index + 1];
}
function optionalPlatform(args) {
    const platform = optionalOption(args, "--platform");
    if (platform === undefined || platform === "posix" || platform === "win32") {
        return platform;
    }
    throw new Error(`unknown platform: ${platform}`);
}
function requireNoArgs(command, args) {
    if (args.length > 0) {
        throw new Error(`${command} does not accept arguments`);
    }
}
function ok(payload) {
    return {
        exitCode: 0,
        stdout: `${JSON.stringify(payload)}\n`,
        stderr: "",
    };
}
function fail(code, message) {
    return {
        exitCode: 1,
        stdout: "",
        stderr: `${JSON.stringify({ ok: false, code, message })}\n`,
    };
}
