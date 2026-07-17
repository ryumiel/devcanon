import { realpath } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { ResolvedConfig } from "../config/schema.js";
import { normalizeManifestIdentity } from "../install/manifest-identity.js";
import { loadManifestWithSnapshot } from "../install/manifest.js";
import type { DiffResult } from "../models/types.js";
import { renderAll } from "../render/pipeline.js";
import { pathExists, readTextFile } from "../utils/fs.js";

export async function diffAll(
  config: ResolvedConfig,
  targetFilter?: "claude" | "codex",
  strict = false,
): Promise<DiffResult[]> {
  const loaded = await loadManifestWithSnapshot(config.manifest.path);
  const normalized = normalizeManifestIdentity(loaded.manifest, config);
  if (normalized.records.some((record) => record.ownership === "foreign")) {
    throw new Error("Manifest contains foreign records; refusing to diff.");
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
        const record = manifest.records.find(
          (r) => r.installedPath === output.installedPath,
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
  const currentPaths = new Set(outputs.map((o) => o.installedPath));
  for (const record of manifest.records) {
    if (!currentPaths.has(record.installedPath)) {
      const filterMatch = !targetFilter || record.target === targetFilter;
      if (filterMatch) {
        results.push({
          status: "removed",
          target: record.target,
          type: record.type,
          name: path.basename(record.installedPath),
          installedPath: record.installedPath,
          diff: null,
        });
      }
    }
  }

  return results;
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
