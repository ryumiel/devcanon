import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export function providerBoundGitEnv(globalConfigFile) {
    const blockedNames = new Set([
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_ATTR_SOURCE",
        "GIT_COMMON_DIR",
        "GIT_DIFF_OPTS",
        "GIT_DIR",
        "GIT_EXTERNAL_DIFF",
        "GIT_GLOB_PATHSPECS",
        "GIT_ICASE_PATHSPECS",
        "GIT_INDEX_FILE",
        "GIT_LITERAL_PATHSPECS",
        "GIT_NAMESPACE",
        "GIT_NOGLOB_PATHSPECS",
        "GIT_OBJECT_DIRECTORY",
        "GIT_REPLACE_REF_BASE",
        "GIT_WORK_TREE",
    ]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_CONFIG") &&
        key !== "GIT_CONFIG_PARAMETERS" &&
        !blockedNames.has(key)));
    env.GIT_CONFIG_GLOBAL = globalConfigFile;
    env.GIT_CONFIG_NOSYSTEM = "1";
    env.GIT_ATTR_NOSYSTEM = "1";
    env.GIT_NO_REPLACE_OBJECTS = "1";
    return env;
}
export function providerBoundGitArgs(args) {
    return ["--no-replace-objects", ...args];
}
export async function runGit(args, options) {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr };
}
export async function runGitRaw(args, options) {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
        cwd: options.cwd,
        env: options.env,
        encoding: "buffer",
        shell: false,
        windowsHide: true,
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    });
    return { stdout, stderr };
}
export async function runGitStdoutSha256(args, options) {
    const stderrMaxBuffer = options.stderrMaxBuffer ?? 10 * 1024 * 1024;
    return new Promise((resolve, reject) => {
        const child = spawn("git", [...args], {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const stdoutHash = createHash("sha256");
        const stderrChunks = [];
        let stderrLength = 0;
        let settled = false;
        const finishReject = (err) => {
            if (settled) {
                return;
            }
            settled = true;
            reject(err);
        };
        child.stdout.on("data", (chunk) => {
            stdoutHash.update(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderrLength += chunk.length;
            if (stderrLength > stderrMaxBuffer) {
                child.kill();
                finishReject(new Error("git stderr exceeded maxBuffer"));
                return;
            }
            stderrChunks.push(chunk);
        });
        child.on("error", finishReject);
        child.on("close", (code) => {
            if (settled) {
                return;
            }
            settled = true;
            const stderr = Buffer.concat(stderrChunks).toString("utf8");
            if (code !== 0) {
                reject(new Error(stderr.length > 0 ? stderr : "git command failed"));
                return;
            }
            resolve({ stdoutSha256: stdoutHash.digest("hex"), stderr });
        });
    });
}
export async function runGitStatus(args, options) {
    return new Promise((resolve) => {
        const child = execFile("git", [...args], {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        }, (error) => {
            resolve(gitStatusCodeFromExecError(error));
        });
        child.on("error", () => resolve(128));
    });
}
export function gitStatusCodeFromExecError(error) {
    if (error === null) {
        return 0;
    }
    if (typeof error === "object" && "code" in error) {
        const code = error.code;
        return typeof code === "number" && Number.isInteger(code) ? code : 128;
    }
    return 128;
}
export async function gitRevParse(rev, options) {
    const result = await runGit(["rev-parse", rev], options);
    return result.stdout.trim();
}
