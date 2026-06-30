import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BASH_PATH_CONVERSION_TIMEOUT_MS = 1000;
const bashPathCache = new Map<string, string>();
const bashPathConverterCache = new Map<string, "wslpath" | "cygpath" | null>();
const gitBashCache = new Map<string, boolean>();

export const BASH_HELPER_PATH_ENV_KEYS = [
  "FINDINGS_FILE",
  "PLAY_VALIDATE_REVIEW_ARTIFACTS_SCRIPT",
  "PRIOR_THREADS_FILE",
  "PROVIDER_SCOPE_EVIDENCE_FILE",
  "SCOPE_DECISION_FILE",
] as const;

export async function toBashPath(
  nativePath: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  if (process.platform !== "win32") {
    return nativePath;
  }
  const fallback = fallbackWindowsBashPath(nativePath);
  if (fallback !== nativePath && (await usesGitBash(env))) {
    return fallback;
  }
  const cacheKey = cacheKeyFor(nativePath, env);
  const cached = bashPathCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const converter = await getBashPathConverter(env);
  const converted =
    (converter === null
      ? null
      : await convertPathWithBash(nativePath, converter, env)) ?? fallback;
  bashPathCache.set(cacheKey, converted);
  return converted;
}

export async function normalizeBashScriptEnvPaths(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): Promise<NodeJS.ProcessEnv> {
  const normalized = { ...env };
  for (const name of names) {
    const value = normalized[name];
    if (value !== undefined && value.length > 0) {
      normalized[name] = await toBashPath(value, normalized);
    }
  }
  return normalized;
}

async function convertPathWithBash(
  nativePath: string,
  command: "wslpath" | "cygpath",
  env: NodeJS.ProcessEnv | undefined,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "bash",
      [
        "-lc",
        'case "$DEVCANON_BASH_PATH_COMMAND" in wslpath|cygpath) command -v "$DEVCANON_BASH_PATH_COMMAND" >/dev/null 2>&1 && "$DEVCANON_BASH_PATH_COMMAND" -u "$DEVCANON_BASH_PATH_INPUT" ;; *) exit 127 ;; esac',
      ],
      {
        env: {
          ...env,
          DEVCANON_BASH_PATH_COMMAND: command,
          DEVCANON_BASH_PATH_INPUT: nativePath,
        },
        timeout: BASH_PATH_CONVERSION_TIMEOUT_MS,
      },
    );
    const converted = stdout.trim();
    return isUsableConvertedPath(converted) ? converted : null;
  } catch (err) {
    if (isExecTimeoutError(err)) {
      throw new Error(
        `Timed out converting Windows path for Bash with ${command}: ${nativePath}`,
      );
    }
    return null;
  }
}

async function getBashPathConverter(
  env: NodeJS.ProcessEnv | undefined,
): Promise<"wslpath" | "cygpath" | null> {
  const key = envPath(env) ?? "";
  if (bashPathConverterCache.has(key)) {
    return bashPathConverterCache.get(key) ?? null;
  }

  const converter = (await bashHasCommand("wslpath", env))
    ? "wslpath"
    : (await bashHasCommand("cygpath", env))
      ? "cygpath"
      : null;
  bashPathConverterCache.set(key, converter);
  return converter;
}

async function bashHasCommand(
  command: "wslpath" | "cygpath",
  env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
  try {
    await execFileAsync(
      "bash",
      [
        "-lc",
        'case "$DEVCANON_BASH_PATH_COMMAND" in wslpath|cygpath) command -v "$DEVCANON_BASH_PATH_COMMAND" >/dev/null 2>&1 ;; *) exit 127 ;; esac',
      ],
      {
        env: {
          ...env,
          DEVCANON_BASH_PATH_COMMAND: command,
        },
        timeout: BASH_PATH_CONVERSION_TIMEOUT_MS,
      },
    );
    return true;
  } catch (err) {
    if (isExecTimeoutError(err)) {
      throw new Error(`Timed out probing Bash path converter: ${command}`);
    }
    return false;
  }
}

async function usesGitBash(
  env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
  const key = envPath(env) ?? "";
  const cached = gitBashCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const found = await findFirstBashOnPath(env);
  const isGitBash =
    found !== null &&
    /[\\/]git[\\/]((usr[\\/]bin)|(bin))[\\/]bash\.exe$/iu.test(found);
  gitBashCache.set(key, isGitBash);
  return isGitBash;
}

async function findFirstBashOnPath(
  env: NodeJS.ProcessEnv | undefined,
): Promise<string | null> {
  for (const entry of pathEntries(env)) {
    const candidate = path.join(entry, "bash.exe");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep scanning PATH; missing or inaccessible entries are normal.
    }
  }
  return null;
}

function pathEntries(env: NodeJS.ProcessEnv | undefined): string[] {
  return (envPath(env) ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isUsableConvertedPath(converted: string): boolean {
  return converted.length > 1 && converted !== "." && converted !== "/";
}

function isExecTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "killed" in error &&
    error.killed === true
  );
}

function fallbackWindowsBashPath(nativePath: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(nativePath);
  if (match === null) {
    return nativePath;
  }

  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/gu, "/");
  return `/${drive}/${rest}`;
}

function cacheKeyFor(
  value: string,
  env: NodeJS.ProcessEnv | undefined,
): string {
  return `${envPath(env) ?? ""}\0${value}`;
}

function envPath(env: NodeJS.ProcessEnv | undefined): string | undefined {
  if (env === undefined) {
    return process.env.PATH ?? process.env.Path;
  }
  return env.PATH ?? env.Path ?? process.env.PATH ?? process.env.Path;
}
