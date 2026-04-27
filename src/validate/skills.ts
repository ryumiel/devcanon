import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ZodIssue } from "zod";
import { type ModelTiers, SkillSourceSchema } from "../config/schema.js";
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

const KNOWN_SUBDIRS = ["assets", "examples", "references", "scripts"];
const RAW_CLAUDE_ALIASES = ["sonnet", "opus", "haiku"] as const;
const TARGET_PATH_TOKENS = [".claude/", ".codex/"] as const;

export interface SkillValidationDiagnosticsOptions {
  enabled?: boolean;
  strict?: boolean;
  modelTiers?: ModelTiers;
}

interface LoadAndValidateSkillsOptions {
  diagnostics?: SkillValidationDiagnosticsOptions;
}

interface DriftDiagnostic {
  token: string;
  reason: "model" | "path";
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
        parsed.body,
        diagnostics.modelTiers,
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

function collectDriftDiagnostics(
  skillBody: string,
  modelTiers: ModelTiers | undefined,
): DriftDiagnostic[] {
  const proseSegments = collectProseSegments(skillBody);
  if (proseSegments.length === 0) return [];

  const found = new Map<string, DriftDiagnostic>();
  const modelTokens = new Set<string>(RAW_CLAUDE_ALIASES);

  if (modelTiers) {
    for (const tier of Object.values(modelTiers)) {
      modelTokens.add(tier.claude);
      modelTokens.add(tier.codex);
    }
  }

  for (const token of modelTokens) {
    if (proseSegments.some((segment) => containsToken(segment, token))) {
      found.set(token.toLowerCase(), { token, reason: "model" });
    }
  }

  for (const token of TARGET_PATH_TOKENS) {
    if (proseSegments.some((segment) => segment.includes(token))) {
      found.set(token.toLowerCase(), { token, reason: "path" });
    }
  }

  return [...found.values()];
}

function containsToken(input: string, token: string): boolean {
  const escapedToken = escapeRegExp(token);
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9._/-])${escapedToken}(?=$|[^A-Za-z0-9._/-])`,
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
  if (diagnostic.reason === "path") {
    return `Skill "${skillName}": drift-prone prose token "${diagnostic.token}" detected; avoid target-specific home paths in shared skill prose.`;
  }

  return `Skill "${skillName}": drift-prone prose token "${diagnostic.token}" detected; prefer {{model:<tier>}} placeholders or target-neutral wording.`;
}
