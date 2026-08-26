import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function runResolveBashCommand(args, env = process.env, platform = process.platform) {
    if (args.length > 0) {
        return plainFail("resolve-bash does not accept arguments");
    }
    try {
        const executable = platform === "win32"
            ? await resolveGitForWindowsBash(env)
            : await resolvePosixBash(env);
        return { exitCode: 0, stdout: `${executable}\n`, stderr: "" };
    }
    catch (err) {
        return plainFail(err.message);
    }
}
async function resolveGitForWindowsBash(env) {
    const candidates = new Set();
    if (env.DEVCANON_GIT_BASH)
        candidates.add(env.DEVCANON_GIT_BASH);
    const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
    const whereExecutable = systemRoot
        ? path.win32.join(systemRoot, "System32", "where.exe")
        : "where.exe";
    try {
        const { stdout } = await execFileAsync(whereExecutable, ["git.exe"], {
            env,
            shell: false,
            windowsHide: true,
            timeout: 5_000,
        });
        for (const gitExecutable of stdout
            .split(/\r?\n/gu)
            .filter((entry) => path.win32.isAbsolute(entry))) {
            const gitDirectory = path.win32.dirname(gitExecutable);
            candidates.add(path.win32.resolve(gitDirectory, "..", "bin", "bash.exe"));
            candidates.add(path.win32.resolve(gitDirectory, "..", "usr", "bin", "bash.exe"));
        }
    }
    catch {
        // The explicit override may still provide a valid installation.
    }
    for (const candidate of candidates) {
        if (isRejectedWindowsLauncher(candidate))
            continue;
        try {
            if (!path.win32.isAbsolute(candidate))
                continue;
            const stat = await lstat(candidate);
            if (!stat.isFile() || stat.isSymbolicLink())
                continue;
            await access(candidate, constants.X_OK);
            await execFileAsync(candidate, [
                "--noprofile",
                "--norc",
                "-lc",
                "builtin pwd -W >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1 && git --version >/dev/null 2>&1",
            ], {
                env,
                shell: false,
                windowsHide: true,
                timeout: 10_000,
            });
            return await realpath(candidate);
        }
        catch {
            // Continue through the bounded candidate list.
        }
    }
    throw new Error("Git-for-Windows Bash is unavailable or unusable. Install Git for Windows, put git.exe on PATH, or set DEVCANON_GIT_BASH to an absolute Git Bash path; WindowsApps and WSL launchers are not accepted.");
}
async function resolvePosixBash(env) {
    for (const directory of (env.PATH ?? "").split(path.delimiter)) {
        if (!directory)
            continue;
        const candidate = path.resolve(directory, "bash");
        try {
            const resolvedCandidate = await realpath(candidate);
            const stat = await lstat(resolvedCandidate);
            if (!stat.isFile())
                continue;
            await access(resolvedCandidate, constants.X_OK);
            await execFileAsync(resolvedCandidate, ["--noprofile", "--norc", "-c", "exit 0"], {
                env,
                shell: false,
                timeout: 10_000,
            });
            return resolvedCandidate;
        }
        catch {
            // Continue through PATH entries without trusting a failed candidate.
        }
    }
    throw new Error("Bash is unavailable or unusable. Install Bash or rerun from a supported POSIX environment.");
}
export function isRejectedWindowsLauncher(candidate) {
    const normalized = path.win32.normalize(candidate).toLowerCase();
    const directory = path.win32.dirname(normalized);
    const basename = path.win32.basename(normalized);
    return (normalized.includes("\\windowsapps\\") ||
        basename === "wsl.exe" ||
        (basename === "bash.exe" &&
            ["system32", "sysnative", "syswow64"].includes(path.win32.basename(directory))));
}
function plainFail(message) {
    return { exitCode: 1, stdout: "", stderr: `${message}\n` };
}
