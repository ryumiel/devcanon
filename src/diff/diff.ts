import { lstat, realpath } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import type { ResolvedConfig } from "../config/schema.js";
import {
  hashDevcanonRuntimePayload,
  verifyManagedOutputIdentity,
} from "../install/identity.js";
import {
  ManifestIdentityError,
  normalizeManifestIdentity,
} from "../install/manifest-identity.js";
import { loadManifestWithSnapshot } from "../install/manifest.js";
import { resolveEffectiveInstallMode } from "../install/mode.js";
import type { DiffResult } from "../models/types.js";
import { renderAllWithValidatedRuntime } from "../render/pipeline.js";
import type { AcceptedProvider } from "../runtime-build/provider.js";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import {
  bundledDevcanonRuntimeDir,
  devcanonRuntimeDir,
  validateDevcanonRuntime,
} from "../validate/devcanon-runtime.js";

export async function diffAll(
  config: ResolvedConfig,
  targetFilter: "claude" | "codex" | undefined,
  strict: boolean,
  provider: AcceptedProvider | (() => Promise<AcceptedProvider>),
): Promise<DiffResult[]> {
  const loaded = await loadManifestWithSnapshot(config.manifest.path);
  let normalized: ReturnType<typeof normalizeManifestIdentity>;
  try {
    normalized = normalizeManifestIdentity(loaded.manifest, config);
  } catch (error) {
    if (!(error instanceof ManifestIdentityError)) throw error;
    const message = (error as Error).message;
    if (!message.startsWith("Manifest boundary mismatch")) {
      throw new UserError(
        `Manifest identity is invalid: ${message}`,
        config.manifest.path,
      );
    }
    throw new UserError(
      `Manifest boundary does not match the configured homes: ${message}`,
      config.manifest.path,
      "Use the manifest with its original configured homes; boundary mismatches cannot be reconciled.",
    );
  }
  if (normalized.records.some((record) => record.ownership === "foreign")) {
    if (!loaded.manifest.boundary) {
      throw new UserError(
        "Legacy manifest contains foreign records; rerun sync with --reconcile-manifest.",
        config.manifest.path,
        "Run sync --reconcile-manifest to safely reconcile the legacy manifest.",
      );
    }
    throw new UserError(
      "Bound manifest contains foreign records; automatic reconciliation is forbidden.",
      config.manifest.path,
      "Restore matching configured homes or repair the manifest from a verified backup.",
    );
  }
  const manifest = normalized.manifest;
  const acceptedProvider =
    typeof provider === "function" ? await provider() : provider;
  const validatedRuntime = await validateDevcanonRuntime(
    devcanonRuntimeDir(config.library.skillsDir),
    {
      adapterSourceDir: bundledDevcanonRuntimeDir(),
      provider: acceptedProvider,
    },
  );
  const { outputs } = await renderAllWithValidatedRuntime(
    config,
    validatedRuntime,
    false,
    strict,
    targetFilter,
  );
  const results: DiffResult[] = [];

  for (const output of outputs) {
    if (output.type === "agent") {
      results.push(
        await diffAgentFile(
          output.content,
          output,
          manifest.records,
          config.targets[output.target].installMode,
        ),
      );
    } else if (output.type === "skill") {
      // For skills, just check if installed and hash matches
      const exists = await pathExists(output.installedPath);
      if (!exists) {
        results.push({
          status: "added",
          target: output.target,
          type: output.type,
          name: output.name,
          installedPath: output.installedPath,
          diff: null,
        });
      } else {
        const record = manifest.records.find((candidate) =>
          recordMatchesOutput(candidate, output),
        );
        if (record && record.contentHash === output.contentHash) {
          if (
            output.name === "devcanon-runtime" &&
            !(await hasMatchingRuntimeIdentity(
              config,
              record,
              output,
              output.contentHash,
            ))
          ) {
            results.push({
              status: "changed",
              target: output.target,
              type: output.type,
              name: output.name,
              installedPath: output.installedPath,
              diff: "Runtime support bundle content has changed.",
            });
            continue;
          }
          results.push({
            status: "up-to-date",
            target: output.target,
            type: output.type,
            name: output.name,
            installedPath: output.installedPath,
            diff: null,
          });
        } else if (record) {
          results.push({
            status: "changed",
            target: output.target,
            type: output.type,
            name: output.name,
            installedPath: output.installedPath,
            diff: "Skill directory content has changed.",
          });
        } else {
          results.push({
            status: "unmanaged-conflict",
            target: output.target,
            type: output.type,
            name: output.name,
            installedPath: output.installedPath,
            diff: null,
          });
        }
      }
    }
  }

  // Check for removed outputs
  const currentPaths = new Set(outputs.map(outputKey));
  for (const record of manifest.records) {
    if (!currentPaths.has(recordKey(record))) {
      const filterMatch = !targetFilter || record.target === targetFilter;
      if (filterMatch) {
        results.push({
          status: "removed",
          target: record.target,
          type: record.type,
          name: recordName(record),
          installedPath: record.installedPath,
          diff: null,
        });
      }
    }
  }

  return results;
}

async function hasMatchingRuntimeIdentity(
  config: ResolvedConfig,
  record: Parameters<typeof verifyManagedOutputIdentity>[0]["record"],
  output: Parameters<typeof verifyManagedOutputIdentity>[0]["output"],
  expectedHash: string,
): Promise<boolean> {
  try {
    await verifyManagedOutputIdentity({ config, record, output });
    if (record.installMode === "symlink") {
      return (
        (await hashDevcanonRuntimePayload(
          await realpath(record.installedPath),
          config,
        )) === expectedHash
      );
    }
    return true;
  } catch {
    return false;
  }
}

function recordMatchesOutput(
  record: {
    target: string;
    type: string;
    name?: string;
    installedPath: string;
  },
  output: { target: string; type: string; name: string; installedPath: string },
): boolean {
  return (
    record.target === output.target &&
    record.type === output.type &&
    record.name === output.name &&
    record.installedPath === output.installedPath
  );
}

function outputKey(output: {
  target: string;
  type: string;
  name: string;
  installedPath: string;
}): string {
  return JSON.stringify([
    output.target,
    output.type,
    output.name,
    output.installedPath,
  ]);
}

function recordKey(record: {
  target: string;
  type: string;
  name?: string;
  installedPath: string;
}): string {
  return JSON.stringify([
    record.target,
    record.type,
    record.name,
    record.installedPath,
  ]);
}

function recordName(record: { name?: string }): string {
  if (record.name === undefined) {
    throw new Error("Managed manifest record is missing its normalized name");
  }
  return record.name;
}

async function diffAgentFile(
  generatedContent: string,
  output: { target: string; type: string; name: string; installedPath: string },
  records: Array<{
    target: string;
    type: string;
    name?: string;
    installedPath: string;
    installMode: "symlink" | "copy";
  }>,
  requestedMode: "symlink" | "copy",
): Promise<DiffResult> {
  const exists = await pathExists(output.installedPath);
  if (!exists) {
    return {
      status: "added",
      target: output.target as "claude" | "codex",
      type: output.type as "skill" | "agent",
      name: output.name,
      installedPath: output.installedPath,
      diff: null,
    };
  }

  const record = records.find((candidate) =>
    recordMatchesOutput(candidate, output),
  );
  if (!record) {
    return {
      status: "unmanaged-conflict",
      target: output.target as "claude" | "codex",
      type: output.type as "skill" | "agent",
      name: output.name,
      installedPath: output.installedPath,
      diff: null,
    };
  }

  const expectedMode = resolveEffectiveInstallMode(
    output.target as "claude" | "codex",
    output.type as "skill" | "agent",
    requestedMode,
  );
  if (
    output.target === "codex" &&
    output.type === "agent" &&
    expectedMode === "copy"
  ) {
    const installedStat = await lstat(output.installedPath);
    if (record.installMode !== expectedMode || !installedStat.isFile()) {
      return {
        status: "changed",
        target: "codex",
        type: "agent",
        name: output.name,
        installedPath: output.installedPath,
        diff: "Managed Codex agent must be installed as a regular file in copy mode.",
      };
    }
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(output.installedPath);
  } catch {
    resolvedPath = output.installedPath;
  }

  let installedContent: string;
  try {
    installedContent = await readTextFile(resolvedPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ELOOP" || code === "EINVAL") {
      // Broken symlink or missing file — treat as not yet installed
      return {
        status: "added",
        target: output.target as "claude" | "codex",
        type: output.type as "skill" | "agent",
        name: output.name,
        installedPath: output.installedPath,
        diff: null,
      };
    }
    throw err;
  }

  if (installedContent === generatedContent) {
    return {
      status: "up-to-date",
      target: output.target as "claude" | "codex",
      type: output.type as "skill" | "agent",
      name: output.name,
      installedPath: output.installedPath,
      diff: null,
    };
  }

  const patch = createTwoFilesPatch(
    `installed/${output.name}`,
    `generated/${output.name}`,
    installedContent,
    generatedContent,
  );

  return {
    status: "changed",
    target: output.target as "claude" | "codex",
    type: output.type as "skill" | "agent",
    name: output.name,
    installedPath: output.installedPath,
    diff: patch,
  };
}
