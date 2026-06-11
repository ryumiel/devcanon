import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function runGit(args, options) {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr };
}
export async function gitRevParse(rev, options) {
    const result = await runGit(["rev-parse", rev], options);
    return result.stdout.trim();
}
