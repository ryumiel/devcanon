import { realpath } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import type { ResolvedConfig } from "../config/schema.js";
import {
  ManifestIdentityError,
  normalizeManifestIdentity,
} from "../install/manifest-identity.js";
import { loadManifestWithSnapshot } from "../install/manifest.js";
import type { DiffResult } from "../models/types.js";
import { renderAll } from "../render/pipeline.js";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";

export async function diffAll(
  config: ResolvedConfig,
  targetFilter?: "claude" | "codex",
  strict = false,
): Promise<DiffResult[]> {
  const loaded = await loadManifestWithSnapshot(config.manifest.path);
  let normalized: ReturnType<typeof normalizeManifestIdentity>;
  try {
    normalized = normalizeManifestIdentity(loaded.manifest, config);
  } catch (error) {
    if (!(error instanceof ManifestIdentityError)) throw error;
    throw new UserError(
      `Manifest boundary does not match the configured homes: ${(error as Error).message}`,
      config.manifest.path,
      "Use the manifest with its original configured homes; boundary mismatches cannot be reconciled.",
    );
  }
  if (normalized.records.some((record) => record.ownership === "foreign")) {
    throw new UserError(
      "Manifest contains foreign legacy records; run sync --reconcile-manifest before diffing.",
      config.manifest.path,
    );
  }
  const manifest = normalized.manifest;
  const { outputs } = await renderAll(config, false, strict, targetFilter);
  const results: DiffResult[] = [];

  for (const output of outputs) {
    if (output.type === "agent") {
      results.push(await diffAgentFile(output.content, output));
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
