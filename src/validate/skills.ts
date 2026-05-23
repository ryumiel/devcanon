import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ZodIssue } from "zod";
import {
  type FileArtifacts,
  type ModelTiers,
  SkillSourceSchema,
  type ToolNames,
} from "../config/schema.js";
import type { LoadedSkill } from "../models/types.js";
import {
  type ParsedFrontmatter,
  parseFrontmatter,
} from "../render/frontmatter.js";
import { UserError } from "../utils/errors.js";
import { isDirectory, pathExists, readTextFile } from "../utils/fs.js";
import { collectProseSegments } from "../utils/markdown-prose.js";
import { FILESYSTEM_SAFE } from "../utils/naming.js";
import { getLogger } from "../utils/output.js";
import {
  SKILL_PROMPT_TOKEN_WARNING_THRESHOLD,
  measureSkillPrompt,
} from "../utils/token-count.js";

export const KNOWN_SUBDIRS = [
  "assets",
  "examples",
  "references",
  "scripts",
] as const;
const RAW_CLAUDE_ALIASES = ["sonnet", "opus", "haiku"] as const;
const TARGET_PATH_TOKENS = [".claude/", ".codex/", ".agents/"] as const;

export interface SkillValidationDiagnosticsOptions {
  enabled?: boolean;
  strict?: boolean;
  modelTiers?: ModelTiers;
  toolNames?: ToolNames;
  fileArtifacts?: FileArtifacts;
}

interface LoadAndValidateSkillsOptions {
  diagnostics?: SkillValidationDiagnosticsOptions;
}

interface DriftDiagnostic {
  token: string;
  reason: "model" | "tool" | "file" | "path";
}

function formatZodIssue(issue: ZodIssue): string {
  if (issue.code === "invalid_union") {
    return issue.unionErrors
      .flatMap((unionError) => unionError.issues.map(formatZodIssue))
      .join("; ");
  }

  if (issue.path.length === 0) return issue.message;
  return `${issue.path.join(".")}: ${issue.message}`;
}

export async function loadAndValidateSkills(
  skillsDir: string,
  options: LoadAndValidateSkillsOptions = {},
): Promise<LoadedSkill[]> {
  if (!(await pathExists(skillsDir))) return [];

  const diagnostics = options.diagnostics;
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: LoadedSkill[] = [];
  const names = new Set<string>();
  const errors: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    const dirPath = path.join(skillsDir, name);

    if (!FILESYSTEM_SAFE.test(name)) {
      errors.push(`Skill "${name}": name is not filesystem-safe.`);
      continue;
    }

    if (names.has(name)) {
      errors.push(`Skill "${name}": duplicate name.`);
      continue;
    }
    names.add(name);

    const skillMdPath = path.join(dirPath, "SKILL.md");
    if (!(await pathExists(skillMdPath))) {
      errors.push(`Skill "${name}": missing SKILL.md.`);
      continue;
    }

    const skillMdContent = await readTextFile(skillMdPath);

    let parsed: ParsedFrontmatter;
    try {
      parsed = parseFrontmatter(skillMdContent);
    } catch (e) {
      errors.push(`Skill "${name}": ${(e as Error).message}`);
      continue;
    }

    if (Object.keys(parsed.frontmatter).length === 0) {
      errors.push(
        `Skill "${name}": missing frontmatter (expected name and description).`,
      );
      continue;
    }

    const result = SkillSourceSchema.safeParse(parsed.frontmatter);
    if (!result.success) {
      const issues = result.error.issues.map(formatZodIssue).join("; ");
      errors.push(`Skill "${name}": ${issues}`);
      continue;
    }

    if (diagnostics?.enabled) {
      const promptMetrics = await measureSkillPrompt(skillMdContent);
      if (
        promptMetrics.estimatedTokens > SKILL_PROMPT_TOKEN_WARNING_THRESHOLD
      ) {
        getLogger().warn(formatSkillPromptSizeDiagnostic(name, promptMetrics));
      }
    }

    if (result.data.name !== name) {
      errors.push(
        `Skill "${name}": frontmatter name "${result.data.name}" does not match directory name.`,
      );
      continue;
    }

    const subdirs: string[] = [];
    for (const sub of KNOWN_SUBDIRS) {
      if (await isDirectory(path.join(dirPath, sub))) subdirs.push(sub);
    }

    if (diagnostics?.enabled) {
      const driftDiagnostics = collectDriftDiagnostics(
        [result.data.description, parsed.body],
        {
          modelTiers: diagnostics.modelTiers,
          toolNames: diagnostics.toolNames,
          fileArtifacts: diagnostics.fileArtifacts,
        },
      );

      for (const diagnostic of driftDiagnostics) {
        const message = formatDriftDiagnostic(name, diagnostic);
        if (diagnostics.strict) {
          errors.push(message);
        } else {
          getLogger().warn(message);
        }
      }
    }

    if (diagnostics?.enabled) {
      const childEntries = await readdir(dirPath, { withFileTypes: true });
      const allowedList = KNOWN_SUBDIRS.map((sub) => `${sub}/`).join(", ");
      for (const child of childEntries) {
        if (child.name.startsWith(".")) continue;
        // Stray top-level directories are intentionally out of scope (#98).
        if (child.isDirectory()) continue;
        if (child.name === "SKILL.md") continue;
        const message = `Skill "${name}": stray top-level file "${child.name}" — only SKILL.md and the ${allowedList} subdirs are installed. Move it under one of those subdirs (typically references/).`;
        if (diagnostics.strict) {
          errors.push(message);
        } else {
          getLogger().warn(message);
        }
      }
    }

    skills.push({
      name,
      dirPath,
      skillMdContent,
      source: result.data,
      body: parsed.body,
      subdirs,
    });
  }

  if (errors.length > 0) {
    throw new UserError(
      `Skill validation failed:\n  ${errors.join("\n  ")}`,
      skillsDir,
    );
  }

  return skills;
}

interface DriftGlossaries {
  modelTiers?: ModelTiers;
  toolNames?: ToolNames;
  fileArtifacts?: FileArtifacts;
}

function collectDriftDiagnostics(
  sharedProseInputs: readonly string[],
  glossaries: DriftGlossaries,
): DriftDiagnostic[] {
  const proseSegments = sharedProseInputs.flatMap((input) =>
    collectProseSegments(input),
  );
  if (proseSegments.length === 0) return [];

  const found = new Map<string, DriftDiagnostic>();

  const modelTokens = new Set<string>(RAW_CLAUDE_ALIASES);
  if (glossaries.modelTiers) {
    for (const tier of Object.values(glossaries.modelTiers)) {
      modelTokens.add(tier.claude.model);
      modelTokens.add(tier.codex.model);
    }
  }

  const toolTokens = new Set<string>();
  if (glossaries.toolNames) {
    for (const tool of Object.values(glossaries.toolNames)) {
      toolTokens.add(tool.claude);
      toolTokens.add(tool.codex);
    }
  }

  const fileTokens = new Set<string>();
  if (glossaries.fileArtifacts) {
    for (const file of Object.values(glossaries.fileArtifacts)) {
      fileTokens.add(file.claude);
      fileTokens.add(file.codex);
    }
  }

  for (const token of modelTokens) {
    if (proseSegments.some((segment) => containsToken(segment, token))) {
      found.set(`model:${token}`, { token, reason: "model" });
    }
  }

  for (const token of toolTokens) {
    if (proseSegments.some((segment) => containsToken(segment, token))) {
      found.set(`tool:${token}`, { token, reason: "tool" });
    }
  }

  for (const token of fileTokens) {
    if (proseSegments.some((segment) => containsToken(segment, token))) {
      found.set(`file:${token}`, { token, reason: "file" });
    }
  }

  for (const token of TARGET_PATH_TOKENS) {
    if (proseSegments.some((segment) => segment.includes(token))) {
      found.set(`path:${token}`, { token, reason: "path" });
    }
  }

  return [...found.values()];
}

function containsToken(input: string, token: string): boolean {
  const escapedToken = escapeRegExp(token);
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_/-])${escapedToken}(?=$|[^A-Za-z0-9_/-])`,
    "iu",
  );
  return pattern.test(input);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDriftDiagnostic(
  skillName: string,
  diagnostic: DriftDiagnostic,
): string {
  switch (diagnostic.reason) {
    case "path":
      return `Skill "${skillName}": drift-prone prose token "${diagnostic.token}" detected; avoid target-specific home paths in shared skill prose.`;
    case "tool":
      return `Skill "${skillName}": drift-prone prose token "${diagnostic.token}" detected; prefer {{tool:<key>}} placeholders or target-neutral wording.`;
    case "file":
      return `Skill "${skillName}": drift-prone prose token "${diagnostic.token}" detected; prefer {{file:<key>}} placeholders or target-neutral wording.`;
    case "model":
      return `Skill "${skillName}": drift-prone prose token "${diagnostic.token}" detected; prefer {{model:<tier>}} placeholders or target-neutral wording.`;
    default: {
      const _exhaustive: never = diagnostic.reason;
      throw new Error(`unhandled drift reason: ${String(_exhaustive)}`);
    }
  }
}

interface SkillPromptMetrics {
  estimatedTokens: number;
  encoding: string;
  bytes: number;
  lines: number;
}

function formatSkillPromptSizeDiagnostic(
  skillName: string,
  metrics: SkillPromptMetrics,
): string {
  const tokens = metrics.estimatedTokens.toLocaleString("en-US");
  const threshold =
    SKILL_PROMPT_TOKEN_WARNING_THRESHOLD.toLocaleString("en-US");
  const bytes = metrics.bytes.toLocaleString("en-US");
  const lines = metrics.lines.toLocaleString("en-US");

  return `Skill "${skillName}": SKILL.md is large (~${tokens} GPT tokens estimated with ${metrics.encoding}; ${bytes} bytes; ${lines} lines; threshold ${threshold} tokens). Always-loaded skill prompts compete for context. Consider moving examples, rationale, branch-specific policy, or deterministic mechanics into references/ or scripts/.`;
}
