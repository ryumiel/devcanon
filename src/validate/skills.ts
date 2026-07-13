import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ZodIssue } from "zod";
import { CONFIG_FILE_NAME } from "../config/identity.js";
import {
  type CapabilityProfiles,
  CapabilitySchema,
  type FileArtifacts,
  type SkillSource,
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
  SKILL_PROMPT_LINE_WARNING_THRESHOLD,
  SKILL_PROMPT_TARGET_TOKEN_RANGE,
  SKILL_PROMPT_TOKEN_WARNING_THRESHOLD,
  measureSkillPrompt,
} from "../utils/token-count.js";
import {
  type ValidationDiagnostic,
  type ValidationDiagnosticReporter,
  formatValidationDiagnostic,
} from "./diagnostics.js";

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
  capabilityProfiles: CapabilityProfiles;
  toolNames?: ToolNames;
  fileArtifacts?: FileArtifacts;
  reporter?: ValidationDiagnosticReporter;
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
  const activeModelErrorPaths = new Set<string>();
  let activeModelErrorCount = 0;

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
      if (isSkillPromptOversized(promptMetrics)) {
        emitSkillDiagnostic(
          createSkillPromptSizeDiagnostic(name, promptMetrics),
          diagnostics.reporter,
        );
      }
    }

    if (result.data.name !== name) {
      errors.push(
        `Skill "${name}": frontmatter name "${result.data.name}" does not match directory name.`,
      );
      continue;
    }

    if (diagnostics?.enabled) {
      const placeholderErrors = collectActiveModelPlaceholderErrors(
        name,
        result.data,
        parsed.body,
        ["claude", "codex"],
        diagnostics.capabilityProfiles,
        skillMdPath,
      );
      if (placeholderErrors.length > 0) {
        activeModelErrorPaths.add(skillMdPath);
        activeModelErrorCount += placeholderErrors.length;
        errors.push(...placeholderErrors);
      }
    }

    const subdirs: string[] = [];
    for (const sub of KNOWN_SUBDIRS) {
      if (await isDirectory(path.join(dirPath, sub))) subdirs.push(sub);
    }

    if (diagnostics?.enabled) {
      const driftDiagnostics = collectDriftDiagnostics(
        [result.data.description, parsed.body],
        {
          capabilityProfiles: diagnostics.capabilityProfiles,
          toolNames: diagnostics.toolNames,
          fileArtifacts: diagnostics.fileArtifacts,
        },
      );

      for (const diagnostic of driftDiagnostics) {
        const validationDiagnostic = createDriftTokenDiagnostic(
          name,
          diagnostic,
        );
        const message = formatValidationDiagnostic(validationDiagnostic);
        if (diagnostics.strict) {
          diagnostics.reporter?.(validationDiagnostic);
          errors.push(message);
        } else {
          emitSkillDiagnostic(validationDiagnostic, diagnostics.reporter);
        }
      }
    }

    if (diagnostics?.enabled) {
      const childEntries = await readdir(dirPath, { withFileTypes: true });
      const allowedList = KNOWN_SUBDIRS.map((sub) => `${sub}/`).join(", ");
      const knownSubdirs = new Set<string>(KNOWN_SUBDIRS);
      for (const child of childEntries) {
        if (child.name.startsWith(".")) continue;
        if (child.name === "SKILL.md") continue;
        const validationDiagnostic = child.isDirectory()
          ? knownSubdirs.has(child.name)
            ? undefined
            : createUnknownSubdirDiagnostic(name, child.name, allowedList)
          : createStrayFileDiagnostic(name, child.name, allowedList);
        if (!validationDiagnostic) continue;
        const message = formatValidationDiagnostic(validationDiagnostic);
        if (diagnostics.strict) {
          diagnostics.reporter?.(validationDiagnostic);
          errors.push(message);
        } else {
          emitSkillDiagnostic(validationDiagnostic, diagnostics.reporter);
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
    const [onlyActiveModelErrorPath] = activeModelErrorPaths;
    throw new UserError(
      `Skill validation failed:\n  ${errors.join("\n  ")}`,
      activeModelErrorCount === errors.length &&
        activeModelErrorPaths.size === 1
        ? onlyActiveModelErrorPath
        : skillsDir,
    );
  }

  return skills;
}

const ACTIVE_MODEL_PLACEHOLDER = /(?<!\\)\{\{model:([^{}\r\n]*)\}\}/g;

export function collectActiveModelPlaceholderErrors(
  skillName: string,
  source: SkillSource,
  body: string,
  targets: readonly ("claude" | "codex")[],
  capabilityProfiles: CapabilityProfiles,
  sourceFilePath: string,
): string[] {
  const errors: string[] = [];
  const supported = CapabilitySchema.options
    .map((capability) => `{{model:${capability}}}`)
    .join(", ");

  for (const target of targets) {
    const targetOverride = source[target];
    const inputs = [
      body,
      ...Object.values(targetOverride ?? {}).filter(
        (value): value is string => typeof value === "string",
      ),
    ];
    const seenTokens = new Set<string>();

    for (const input of inputs) {
      for (const segment of collectProseSegments(input)) {
        for (const match of segment.matchAll(ACTIVE_MODEL_PLACEHOLDER)) {
          const value = match[1];
          const token = match[0];
          const capability = CapabilitySchema.safeParse(value);
          if (
            (capability.success &&
              Object.hasOwn(capabilityProfiles, capability.data)) ||
            seenTokens.has(token)
          ) {
            continue;
          }
          seenTokens.add(token);
          errors.push(
            `Skill "${skillName}" (${target}): unsupported model capability "${value}" in token "${token}" — use ${supported}; capabilityProfiles in ${CONFIG_FILE_NAME} defines the target model strings (source: ${sourceFilePath})`,
          );
        }
      }
    }
  }

  return errors;
}

interface DriftGlossaries {
  capabilityProfiles: CapabilityProfiles;
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
  for (const profile of Object.values(glossaries.capabilityProfiles)) {
    modelTokens.add(profile.claude);
    modelTokens.add(profile.codex);
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

function createDriftTokenDiagnostic(
  skillName: string,
  diagnostic: DriftDiagnostic,
): ValidationDiagnostic {
  const hint = getDriftDiagnosticHint(diagnostic.reason);
  return {
    code: "skill.drift-token",
    area: "skill",
    subject: skillName,
    strictBehavior: "strictable",
    summary: `drift-prone prose token "${diagnostic.token}" detected`,
    details: [`token: ${diagnostic.token}`, `reason: ${diagnostic.reason}`],
    hint,
  };
}

function getDriftDiagnosticHint(reason: DriftDiagnostic["reason"]): string {
  switch (reason) {
    case "path":
      return "Avoid target-specific home paths in shared skill prose.";
    case "tool":
      return "Prefer {{tool:<key>}} placeholders or target-neutral wording.";
    case "file":
      return "Prefer {{file:<key>}} placeholders or target-neutral wording.";
    case "model":
      return "Prefer {{model:<capability>}} placeholders or target-neutral wording.";
    default: {
      const _exhaustive: never = reason;
      throw new Error(`unhandled drift reason: ${String(_exhaustive)}`);
    }
  }
}

function createStrayFileDiagnostic(
  skillName: string,
  fileName: string,
  allowedList: string,
): ValidationDiagnostic {
  return {
    code: "skill.stray-file",
    area: "skill",
    subject: skillName,
    strictBehavior: "strictable",
    summary: `stray top-level file "${fileName}"`,
    details: [`file: ${fileName}`, `allowed subdirs: ${allowedList}`],
    hint: `only SKILL.md and the ${allowedList} subdirs are installed. Move it under one of those subdirs (typically references/).`,
  };
}

function createUnknownSubdirDiagnostic(
  skillName: string,
  dirName: string,
  allowedList: string,
): ValidationDiagnostic {
  return {
    code: "skill.unknown-subdir",
    area: "skill",
    subject: skillName,
    strictBehavior: "strictable",
    summary: `unknown top-level support directory "${dirName}"`,
    details: [
      `directory: ${dirName}/`,
      `allowed subdirs: ${allowedList}`,
      "unknown support directories are not rendered or mirrored into generated skills.",
    ],
    hint: `unknown support directories are not rendered or mirrored; only SKILL.md and the ${allowedList} subdirs are installed. Rename it or move material under one of those subdirs (typically references/).`,
  };
}

function createSkillPromptSizeDiagnostic(
  skillName: string,
  metrics: SkillPromptMetrics,
): ValidationDiagnostic {
  const tokens = metrics.estimatedTokens.toLocaleString("en-US");
  const softTokenLimit =
    SKILL_PROMPT_TOKEN_WARNING_THRESHOLD.toLocaleString("en-US");
  const targetMin = SKILL_PROMPT_TARGET_TOKEN_RANGE.min.toLocaleString("en-US");
  const targetMax = SKILL_PROMPT_TARGET_TOKEN_RANGE.max.toLocaleString("en-US");
  const lineLimit = SKILL_PROMPT_LINE_WARNING_THRESHOLD.toLocaleString("en-US");
  const bytes = metrics.bytes.toLocaleString("en-US");
  const lines = metrics.lines.toLocaleString("en-US");

  return {
    code: "skill.prompt-size",
    area: "skill",
    subject: skillName,
    strictBehavior: "advisory",
    summary: `SKILL.md is large (~${tokens} GPT tokens estimated with ${metrics.encoding}; ${bytes} bytes; ${lines} lines; target ${targetMin}-${targetMax} tokens; soft upper bound ${softTokenLimit} tokens or ${lineLimit} lines).`,
    details: [
      "Always-loaded skill prompts compete for context.",
      `Target: ${targetMin}-${targetMax} tokens.`,
      `Soft upper bound: ${softTokenLimit} tokens or ${lineLimit} lines.`,
    ],
    metrics: {
      estimatedTokens: metrics.estimatedTokens,
      encoding: metrics.encoding,
      bytes: metrics.bytes,
      lines: metrics.lines,
      targetTokenMin: SKILL_PROMPT_TARGET_TOKEN_RANGE.min,
      targetTokenMax: SKILL_PROMPT_TARGET_TOKEN_RANGE.max,
      softTokenLimit: SKILL_PROMPT_TOKEN_WARNING_THRESHOLD,
      softLineLimit: SKILL_PROMPT_LINE_WARNING_THRESHOLD,
    },
    hint: `Keep critical instructions, safety rules, and output contracts before token ${softTokenLimit}; consider moving examples, rationale, branch-specific policy, or deterministic mechanics into references/ or scripts/.`,
  };
}

function emitSkillDiagnostic(
  diagnostic: ValidationDiagnostic,
  reporter?: ValidationDiagnosticReporter,
): void {
  if (reporter) {
    reporter(diagnostic);
    return;
  }

  getLogger().warn(formatValidationDiagnostic(diagnostic));
}

interface SkillPromptMetrics {
  estimatedTokens: number;
  encoding: string;
  bytes: number;
  lines: number;
}

function isSkillPromptOversized(metrics: SkillPromptMetrics): boolean {
  return (
    metrics.estimatedTokens > SKILL_PROMPT_TOKEN_WARNING_THRESHOLD ||
    metrics.lines >= SKILL_PROMPT_LINE_WARNING_THRESHOLD
  );
}
