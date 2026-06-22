import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

export interface RuntimeGitDigestResult {
  stdoutSha256: string;
  stderr: string;
}

export function providerBoundGitEnv(
  globalConfigFile: string,
): NodeJS.ProcessEnv {
  const blockedNames = new Set([
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_ATTR_SOURCE",
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
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_CONFIG") &&
        key !== "GIT_CONFIG_PARAMETERS" &&
        !blockedNames.has(key),
    ),
  );
  env.GIT_CONFIG_GLOBAL = globalConfigFile;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_ATTR_NOSYSTEM = "1";
  env.GIT_NO_REPLACE_OBJECTS = "1";
  return env;
}

export function providerBoundGitArgs(args: readonly string[]): string[] {
  return ["--no-replace-objects", ...args];
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

export async function runGitStdoutSha256(
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; stderrMaxBuffer?: number },
): Promise<RuntimeGitDigestResult> {
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
    const stderrChunks: Buffer[] = [];
    let stderrLength = 0;
    let settled = false;

    const finishReject = (err: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(err);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutHash.update(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
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

export async function runGitStatus(
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<number> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error) => {
        if (error && typeof error === "object" && "code" in error) {
          resolve(Number(error.code));
        } else {
          resolve(0);
        }
      },
    );
    child.on("error", () => resolve(128));
  });
}

export async function gitRevParse(
  rev: string,
  options: { cwd: string },
): Promise<string> {
  const result = await runGit(["rev-parse", rev], options);
  return result.stdout.trim();
}
