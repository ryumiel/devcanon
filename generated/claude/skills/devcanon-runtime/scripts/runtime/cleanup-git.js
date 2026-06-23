import { execFile, spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function git(args, cwd, allowExitCodes = [0]) {
    try {
        const { stdout, stderr } = await execFileAsync("git", ["-C", cwd, ...args], {
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
export async function canonicalPath(targetPath) {
    if (targetPath.length === 0) {
        return null;
    }
    try {
        const stat = await lstat(targetPath);
        if (!stat.isDirectory()) {
            return null;
        }
        return await realpath(targetPath);
    }
    catch {
        return null;
    }
}
export async function requireCanonicalDirectory(targetPath, label) {
    const resolved = await canonicalPath(targetPath);
    if (resolved === null) {
        throw new CleanupUsageError(`${label} does not resolve to a directory: ${targetPath}`);
    }
    return resolved;
}
export async function isInsideWorktree(cwd) {
    const result = await git(["rev-parse", "--is-inside-work-tree"], cwd, [0, 128]);
    return result.exitCode === 0 && result.stdout.trim() === "true";
}
export async function isBareRepository(cwd) {
    const result = await git(["rev-parse", "--is-bare-repository"], cwd, [0, 128]);
    return result.exitCode !== 0 || result.stdout.trim() === "true";
}
export async function showTopLevel(cwd) {
    return stripGitLineEnding((await git(["rev-parse", "--show-toplevel"], cwd)).stdout);
}
export async function currentBranch(cwd) {
    const result = await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd, [0, 1]);
    return result.exitCode === 0 ? result.stdout.trim() : "";
}
export async function collectWorktrees(cwd) {
    const result = await git(["worktree", "list", "--porcelain", "-z"], cwd);
    const records = [];
    let current = null;
    async function append() {
        if (current === null) {
            return;
        }
        if (current.prunable) {
            records.push(current);
        }
        else {
            const real = await canonicalPath(current.path);
            if (real !== null) {
                records.push({ ...current, realPath: real });
            }
        }
        current = null;
    }
    for (const field of result.stdout.split("\0")) {
        if (field.length === 0) {
            continue;
        }
        if (field.startsWith("worktree ")) {
            await append();
            const worktreePath = field.slice("worktree ".length);
            current = {
                path: worktreePath,
                realPath: worktreePath,
                branch: "",
                locked: false,
                lockedReason: "",
                prunable: false,
            };
        }
        else if (current !== null && field.startsWith("branch refs/heads/")) {
            current.branch = field.slice("branch refs/heads/".length);
        }
        else if (current !== null && field.startsWith("locked")) {
            current.locked = true;
            current.lockedReason = field.slice("locked".length).trimStart();
        }
        else if (current !== null && field.startsWith("prunable")) {
            current.prunable = true;
        }
    }
    await append();
    return records;
}
export async function worktreeStatus(worktreePath) {
    return (await git(["status", "--porcelain=v1", "--untracked-files=normal"], worktreePath)).stdout.trim();
}
export async function resolveDefaultBranch(cwd) {
    const symbolicRef = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd, [0, 1]);
    const symbolicBranch = symbolicRef.stdout.trim();
    if (symbolicBranch.length > 0) {
        return symbolicBranch.replace(/^origin\//u, "");
    }
    for (const fallback of ["main", "master"]) {
        const result = await git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${fallback}`], cwd, [0, 1]);
        if (result.exitCode === 0) {
            return fallback;
        }
    }
    return null;
}
export async function localBranches(cwd) {
    const result = await git(["for-each-ref", "--format=%(refname)", "refs/heads"], cwd);
    return result.stdout.split(/\r?\n/u).filter(Boolean);
}
export async function showRefExists(cwd, ref) {
    return ((await git(["show-ref", "--verify", "--quiet", ref], cwd, [0, 1]))
        .exitCode === 0);
}
export async function revParse(cwd, rev) {
    return (await git(["rev-parse", rev], cwd)).stdout.trim();
}
export async function validateBranchName(value) {
    if (value.length === 0 ||
        value.startsWith("-") ||
        value.includes("\n") ||
        value.includes("\r")) {
        return false;
    }
    return (execFileSyncStatus("git", ["check-ref-format", "--branch", value]) === 0);
}
export function validateSha(value) {
    return /^[0-9a-f]{40}$/u.test(value);
}
export async function normalizeRemoteUrl(value) {
    let remoteUrl = value;
    if (remoteUrl.startsWith("git@github.com:")) {
        remoteUrl = `https://github.com/${remoteUrl.slice("git@github.com:".length)}`;
    }
    else if (remoteUrl.startsWith("ssh://git@github.com/")) {
        remoteUrl = `https://github.com/${remoteUrl.slice("ssh://git@github.com/".length)}`;
    }
    else if (remoteUrl.startsWith("file://")) {
        remoteUrl = remoteUrl.slice("file://".length);
    }
    if (path.isAbsolute(remoteUrl)) {
        const resolved = await canonicalPath(remoteUrl);
        if (resolved !== null) {
            return resolved;
        }
    }
    return remoteUrl.replace(/\/$/u, "").replace(/\.git$/u, "");
}
export function countStatusLines(status) {
    return status.length === 0 ? 0 : status.split(/\r?\n/u).length;
}
export function stripGitLineEnding(value) {
    return value.replace(/\r?\n$/u, "");
}
export function lineOutput(fields) {
    return `${fields.map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}
export class CleanupUsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "CleanupUsageError";
    }
}
function execFileSyncStatus(command, args) {
    const child = spawnSync(command, [...args], {
        shell: false,
        windowsHide: true,
    });
    return child.status ?? 1;
}
