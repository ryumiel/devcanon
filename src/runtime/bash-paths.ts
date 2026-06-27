import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const bashPathCache = new Map<string, string>();
const bashScriptPathCache = new Map<string, boolean>();

export async function toBashPath(
  nativePath: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  if (process.platform !== "win32") {
    return nativePath;
  }
  const cacheKey = cacheKeyFor(nativePath, env);
  const cached = bashPathCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const converted =
    (await convertPathWithBash(nativePath, "wslpath", env)) ??
    (await convertPathWithBash(nativePath, "cygpath", env)) ??
    (await fallbackWindowsBashPath(nativePath, env));
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
      },
    );
    const converted = stdout.trim();
    return isUsableConvertedPath(converted) &&
      (await bashCanOpenScript(converted, env))
      ? converted
      : null;
  } catch {
    return null;
  }
}

async function bashCanOpenScript(
  bashPath: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<boolean> {
  const cacheKey = cacheKeyFor(bashPath, env);
  const cached = bashScriptPathCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const exists = await execFileAsync("bash", ["-n", bashPath], { env })
    .then(() => true)
    .catch(() => false);
  bashScriptPathCache.set(cacheKey, exists);
  return exists;
}

function isUsableConvertedPath(converted: string): boolean {
  return converted.length > 1 && converted !== "." && converted !== "/";
}

async function fallbackWindowsBashPath(
  nativePath: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(nativePath);
  if (match === null) {
    return nativePath;
  }

  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/gu, "/");
  const wslPath = `/mnt/${drive}/${rest}`;
  if (await bashCanOpenScript(wslPath, env)) {
    return wslPath;
  }
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
