import { execFile } from "node:child_process";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";
import type { InstallMode, ResolvedConfig } from "../config/schema.js";
import { type SyncResult, sync } from "../install/sync.js";
import { renderAll } from "../render/pipeline.js";
import {
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
  makeResolvedConfig,
} from "./fixtures.js";
import { installTestLogger } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface RuntimeCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RuntimeConformanceFixtureOptions {
  consumerName?: string;
  adapterRelPath?: `scripts/${string}`;
  adapterContent?: string | Buffer;
  includeRuntime?: boolean;
}

export interface RuntimeConformanceFixture {
  tempDir: string;
  config: ResolvedConfig;
  consumerName: string;
  adapterRelPath: `scripts/${string}`;
  sourceAdapterPath: string;
  generatedAdapterPath: (target: "claude" | "codex") => string;
  installedAdapterPath: (target: "claude" | "codex") => string;
  cleanup: () => Promise<void>;
}

export function runtimeForwardingAdapterContent(): string {
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'script_path="${BASH_SOURCE[0]}"',
    'script_dir="$(cd -- "$(dirname -- "$script_path")" && pwd)"',
    'skills_root="$(cd -- "$script_dir/../.." && pwd)"',
    'runtime_resolver="$skills_root/devcanon-runtime/scripts/devcanon-runtime.sh"',
    'runtime_entrypoint="$("$runtime_resolver" resolve-entrypoint --from "$script_path" --entrypoint "scripts/devcanon-runtime.sh")"',
    'exec "$runtime_entrypoint" runtime "$@"',
    "",
  ].join("\n");
}

export async function copyRuntimeFixture(skillsDir: string): Promise<void> {
  await cp(
    path.resolve("skills/devcanon-runtime"),
    path.join(skillsDir, "devcanon-runtime"),
    { recursive: true },
  );
}

export async function createRuntimeConformanceFixture(
  options: RuntimeConformanceFixtureOptions = {},
): Promise<RuntimeConformanceFixture> {
  const tempDir = await createTempDir();
  const config = makeResolvedConfig(tempDir);
  const consumerName = options.consumerName ?? "runtime-consumer";
  const adapterRelPath = options.adapterRelPath ?? "scripts/adapter.sh";
  const adapterContent =
    options.adapterContent ?? runtimeForwardingAdapterContent();
  const { restore } = installTestLogger();

  try {
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    if (options.includeRuntime !== false) {
      await copyRuntimeFixture(config.library.skillsDir);
    }
    await createSkillFixture(
      config.library.skillsDir,
      consumerName,
      `---\nname: ${consumerName}\ndescription: A runtime-backed consumer fixture.\n---\n\n# Consumer\n`,
      ["scripts"],
    );

    const sourceAdapterPath = path.join(
      config.library.skillsDir,
      consumerName,
      adapterRelPath,
    );
    await mkdir(path.dirname(sourceAdapterPath), { recursive: true });
    await writeFile(sourceAdapterPath, adapterContent);
    await chmod(sourceAdapterPath, 0o755);

    return {
      tempDir,
      config,
      consumerName,
      adapterRelPath,
      sourceAdapterPath,
      generatedAdapterPath: (target) =>
        path.join(
          config.library.generatedDir,
          target,
          "skills",
          consumerName,
          adapterRelPath,
        ),
      installedAdapterPath: (target) =>
        path.join(
          config.targets[target].skillsHome,
          consumerName,
          adapterRelPath,
        ),
      cleanup: async () => {
        restore();
        await cleanupTempDir(tempDir);
      },
    };
  } catch (err) {
    restore();
    await cleanupTempDir(tempDir);
    throw err;
  }
}

export async function renderRuntimeConformanceFixture(
  fixture: RuntimeConformanceFixture,
): Promise<void> {
  await renderAll(fixture.config, true);
}

export async function syncRuntimeConformanceFixture(
  fixture: RuntimeConformanceFixture,
  mode: InstallMode,
): Promise<SyncResult> {
  return sync(fixture.config, {
    dryRun: false,
    force: false,
    strict: false,
    mode,
  });
}

export async function runRuntimeBackedAdapter(
  adapterPath: string,
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
): Promise<RuntimeCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [await toBashPath(adapterPath), ...args],
      {
        env: { ...process.env, ...env },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof execError.code === "number" ? execError.code : 1,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
    };
  }
}

export async function resolveRuntimeEntrypoint(
  resolverPath: string,
  consumerScriptPath: string,
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const bashResolverPath = await toBashPath(resolverPath);
  const bashConsumerScriptPath = await toBashPath(consumerScriptPath);
  const { stdout } = await execFileAsync(
    "bash",
    [
      bashResolverPath,
      "resolve-entrypoint",
      "--from",
      bashConsumerScriptPath,
      "--entrypoint",
      "scripts/devcanon-runtime.sh",
    ],
    {
      env: { ...process.env, ...env },
    },
  );
  return stdout.trim();
}

export async function toBashPath(nativePath: string): Promise<string> {
  const { stdout } = await execFileAsync("bash", [
    "-lc",
    'if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf "%s\\n" "$1"; fi',
    "bash",
    nativePath,
  ]);
  return stdout.trim();
}

export function normalizePathText(value: string): string {
  let normalized = value.replace(/\\/gu, "/");
  if (process.platform === "win32") {
    normalized = normalized.replace(
      /^\/([A-Za-z])\//u,
      (_match, drive: string) => `${drive}:/`,
    );
    normalized = normalized.replace(
      /^\/cygdrive\/([A-Za-z])\//u,
      (_match, drive: string) => `${drive}:/`,
    );
    if (/^[A-Za-z]:\//u.test(normalized)) {
      normalized = normalized.toLowerCase();
    }
  }
  return normalized;
}

export async function expectSameBashPath(
  actual: string,
  expectedNativePath: string,
): Promise<void> {
  expect(normalizePathText(actual)).toBe(
    normalizePathText(await toBashPath(expectedNativePath)),
  );
}

export async function expectFileBytesEqual(
  actualPath: string,
  expectedPath: string,
): Promise<void> {
  expect(await readFile(actualPath)).toEqual(await readFile(expectedPath));
}
