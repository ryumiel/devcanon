import { execFile, spawnSync } from "node:child_process";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function runIssueWorktreeSetupCommand(args, env = process.env) {
    try {
        return await runIssueWorktreeSetup(args, env);
    }
    catch (err) {
        return plainFail(err.message);
    }
}
async function runIssueWorktreeSetup(args, env) {
    if (args.length > 0) {
        return plainFail("issue-worktree-setup does not accept arguments");
    }
    const branchName = requireEnv(env, "BRANCH_NAME");
    const worktreeLeaf = requireEnv(env, "WORKTREE_LEAF");
    validateBranchName(branchName);
    validateWorktreeLeaf(worktreeLeaf);
    const cwd = process.cwd();
    const currentWorktree = stripGitLineEnding((await git(["rev-parse", "--show-toplevel"], cwd)).stdout);
    const currentWorktreeReal = await realpath(currentWorktree);
    const gitCommonDir = stripGitLineEnding((await git(["rev-parse", "--git-common-dir"], currentWorktree)).stdout);
    if (isUnsupportedWindowsGitMetadata(gitCommonDir)) {
        return plainFail(`issue-worktree-setup cannot run POSIX/WSL Git against Windows Git metadata (${gitCommonDir}). Re-run from native Windows Codex/worktree tooling or from a native Windows shell with node setup-worktree.mjs.`);
    }
    const currentStatus = (await git(["status", "--short"], currentWorktree)).stdout.trim();
    const suppliedBaseRef = env.BASE_REF;
    if (suppliedBaseRef !== undefined) {
        validateBaseRef(suppliedBaseRef);
    }
    const superproject = stripGitLineEnding((await git(["rev-parse", "--show-superproject-working-tree"], currentWorktree, [0, 128])).stdout);
    if (superproject.length > 0) {
        const superprojectReal = await realpath(superproject);
        return lineOk({
            MODE: "stop",
            WORKTREE_PATH: currentWorktree,
            MESSAGE: `Running issue-worktree-setup from inside submodule ${currentWorktreeReal} is unsupported; re-run from superproject ${superprojectReal}.`,
        });
    }
    let baseRef = suppliedBaseRef;
    if (baseRef === undefined) {
        const defaultBranchResult = await git(["ls-remote", "--symref", "--exit-code", "origin", "HEAD"], currentWorktree, [0, 1, 2, 128]);
        const defaultBranchDiagnostic = defaultBranchResult.stderr.trim();
        if (defaultBranchResult.exitCode !== 0 &&
            defaultBranchDiagnostic.length > 0) {
            return plainFail(`Unable to determine origin's default branch: ${defaultBranchDiagnostic}`);
        }
        const symbolicHeadTargets = defaultBranchResult.stdout
            .split(/\r?\n/u)
            .flatMap((line) => {
            const match = /^ref: ([^\t]+)\tHEAD$/u.exec(line);
            return match === null ? [] : [match[1]];
        });
        if (symbolicHeadTargets.length === 0) {
            return plainFail("Unable to determine origin's default branch: origin did not advertise a symbolic HEAD target");
        }
        if (symbolicHeadTargets.length !== 1) {
            return plainFail("Unable to determine origin's default branch: origin advertised multiple symbolic HEAD targets");
        }
        const symbolicHeadTarget = symbolicHeadTargets[0];
        const branchPrefix = "refs/heads/";
        if (!symbolicHeadTarget.startsWith(branchPrefix) ||
            symbolicHeadTarget.length === branchPrefix.length) {
            return plainFail(`Unable to determine origin's default branch: origin advertised an invalid symbolic HEAD target: ${symbolicHeadTarget}`);
        }
        baseRef = `origin/${symbolicHeadTarget.slice(branchPrefix.length)}`;
    }
    const mainWorktree = await primaryWorktree(currentWorktree);
    const mainWorktreeReal = await realpath(mainWorktree);
    await git(["fetch", "origin"], currentWorktree);
    const resolvedBaseResult = await git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`], cwd, [0, 1]);
    const resolvedBase = resolvedBaseResult.stdout.trim();
    if (resolvedBaseResult.exitCode !== 0 || resolvedBase.length === 0) {
        return plainFail(`Unable to resolve BASE_REF to a commit: ${baseRef}`);
    }
    if ((await git(["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], currentWorktree, [0, 1])).exitCode === 0) {
        return plainFail(`Branch already exists: ${branchName}`);
    }
    if (currentWorktreeReal !== mainWorktreeReal) {
        if (currentStatus.length === 0) {
            const ancestorResult = await git(["merge-base", "--is-ancestor", "HEAD", resolvedBase], currentWorktree, [0, 1]);
            if (ancestorResult.exitCode === 0) {
                await git(["checkout", "-b", branchName, resolvedBase], currentWorktree);
                return lineOk({
                    MODE: "reuse",
                    WORKTREE_PATH: currentWorktree,
                    MESSAGE: "Reused clean managed worktree.",
                });
            }
            if (ancestorResult.exitCode !== 1) {
                return plainFail(`git merge-base --is-ancestor failed unexpectedly (exit ${ancestorResult.exitCode})`);
            }
        }
        return lineOk({
            MODE: "stop",
            WORKTREE_PATH: currentWorktree,
            MESSAGE: currentStatus.length > 0
                ? "Managed worktree has uncommitted changes; return to the primary checkout."
                : "Managed worktree has commits not in BASE_REF; return to the primary checkout.",
        });
    }
    const worktreesDir = path.join(currentWorktree, ".worktrees");
    const ignoreProbe = ".worktrees/.devcanon-ignore-probe";
    const ignoreResult = await git(["-C", currentWorktree, "check-ignore", "-q", ignoreProbe], currentWorktree, [0, 1]);
    if (ignoreResult.exitCode !== 0) {
        return plainFail("'.worktrees/' is not ignored in this repo.\nAdd '.worktrees/' to .gitignore and commit before re-running.");
    }
    if (await isSymlink(worktreesDir)) {
        return plainFail(".worktrees must be a normal directory inside the primary checkout.");
    }
    await mkdir(worktreesDir, { recursive: true });
    const worktreesDirReal = await realpath(worktreesDir);
    const expectedWorktreesDirReal = path.join(currentWorktreeReal, ".worktrees");
    if (worktreesDirReal !== expectedWorktreesDirReal) {
        return plainFail(".worktrees resolved outside the primary checkout.");
    }
    const newWorktreePath = path.join(worktreesDir, worktreeLeaf);
    if (await pathExists(newWorktreePath)) {
        return plainFail(`Target worktree path already exists: ${newWorktreePath}`);
    }
    await git(["worktree", "add", "-b", branchName, newWorktreePath, resolvedBase], currentWorktree);
    return lineOk({
        MODE: "new",
        WORKTREE_PATH: newWorktreePath,
        MESSAGE: "Created new managed worktree.",
    });
}
async function primaryWorktree(cwd) {
    const result = await git(["worktree", "list", "--porcelain", "-z"], cwd);
    for (const field of result.stdout.split("\0")) {
        if (field.startsWith("worktree ")) {
            return field.slice("worktree ".length);
        }
    }
    throw new Error("Unable to determine the primary worktree.");
}
async function git(args, cwd, allowExitCodes = [0]) {
    try {
        const { stdout, stderr } = await execFileAsync("git", [...args], {
            cwd,
            encoding: "utf8",
            shell: false,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        });
        return { exitCode: 0, stdout, stderr };
    }
    catch (err) {
        const error = err;
        const exitCode = typeof error.code === "number" ? error.code : Number(error.code ?? 1);
        const result = {
            exitCode: Number.isFinite(exitCode) ? exitCode : 1,
            stdout: error.stdout ?? "",
            stderr: error.stderr ?? error.message,
        };
        if (allowExitCodes.includes(result.exitCode)) {
            return result;
        }
        throw new Error(result.stderr.trim() || error.message);
    }
}
function requireEnv(env, name) {
    const value = env[name];
    if (value === undefined || value.length === 0) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
function validateBranchName(branchName) {
    validateNoLeadingDashOrLineBreak("BRANCH_NAME", branchName);
    const result = execFileSyncStatus("git", [
        "check-ref-format",
        "--branch",
        branchName,
    ]);
    if (result !== 0) {
        throw new Error(`Invalid BRANCH_NAME: ${branchName}`);
    }
}
function validateWorktreeLeaf(worktreeLeaf) {
    if (worktreeLeaf.length === 0 ||
        worktreeLeaf === "." ||
        path.isAbsolute(worktreeLeaf) ||
        worktreeLeaf.startsWith("-") ||
        worktreeLeaf.includes("/") ||
        worktreeLeaf.includes("\\") ||
        worktreeLeaf.includes("..") ||
        worktreeLeaf.includes("\n") ||
        worktreeLeaf.includes("\r")) {
        throw new Error(`Unsafe WORKTREE_LEAF: ${worktreeLeaf}`);
    }
}
function validateBaseRef(baseRef) {
    validateNoLeadingDashOrLineBreak("BASE_REF", baseRef);
}
function validateNoLeadingDashOrLineBreak(name, value) {
    if (value.length === 0 ||
        value.startsWith("-") ||
        value.includes("\n") ||
        value.includes("\r")) {
        throw new Error(`Unsafe ${name}: ${value}`);
    }
}
function execFileSyncStatus(command, args) {
    const child = spawnSync(command, [...args], {
        shell: false,
        windowsHide: true,
    });
    return child.status ?? 1;
}
function stripGitLineEnding(value) {
    return value.replace(/\r?\n$/u, "");
}
export function isUnsupportedWindowsGitMetadata(gitCommonDir, platform = process.platform) {
    if (platform === "win32")
        return false;
    return /^[A-Za-z]:[\\/]/u.test(gitCommonDir);
}
async function isSymlink(targetPath) {
    try {
        return (await lstat(targetPath)).isSymbolicLink();
    }
    catch {
        return false;
    }
}
async function pathExists(targetPath) {
    try {
        await lstat(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
function lineOk(fields) {
    return {
        exitCode: 0,
        stdout: `MODE=${fields.MODE}\nWORKTREE_PATH=${fields.WORKTREE_PATH}\nMESSAGE=${fields.MESSAGE}\n`,
        stderr: "",
    };
}
function plainFail(message) {
    return {
        exitCode: 1,
        stdout: "",
        stderr: `${message}\n`,
    };
}
