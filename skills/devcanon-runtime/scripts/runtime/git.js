import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
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
export async function gitRevParse(rev, options) {
    const result = await runGit(["rev-parse", rev], options);
    return result.stdout.trim();
}
