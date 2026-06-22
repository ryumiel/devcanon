import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RuntimeGitResult {
  stdout: string;
  stderr: string;
}

export interface RuntimeGitRawResult {
  stdout: Buffer;
  stderr: Buffer;
}

export async function runGit(
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<RuntimeGitResult> {
  const { stdout, stderr } = await execFileAsync("git", [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout, stderr };
}

export async function runGitRaw(
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer?: number },
): Promise<RuntimeGitRawResult> {
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

export async function gitRevParse(
  rev: string,
  options: { cwd: string },
): Promise<string> {
  const result = await runGit(["rev-parse", rev], options);
  return result.stdout.trim();
}
