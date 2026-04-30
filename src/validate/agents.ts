import { readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ZodIssue } from "zod";
import {
  AGENT_SOURCE_FIELDS,
  AgentSourceSchema,
  CLAUDE_TARGET_FIELDS,
  CODEX_APPROVAL_POLICY_FIELDS,
  CODEX_APPROVAL_POLICY_GRANULAR_FIELDS,
  CODEX_TARGET_FIELDS,
  type ModelTiers,
} from "../config/schema.js";
import type { LoadedAgent, LoadedSkill } from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { pathExists, readTextFile } from "../utils/fs.js";
import { getLogger } from "../utils/output.js";

function collectUnknownFields(
  value: Record<string, unknown>,
  knownKeys: readonly string[],
  pathPrefix = "",
): string[] {
  const known = new Set(knownKeys);
  return Object.keys(value)
    .filter((key) => !known.has(key))
    .map((key) => `${pathPrefix}${key}`);
}

function formatZodIssue(issue: ZodIssue): string {
  if (issue.code === "invalid_union") {
    return issue.unionErrors
      .flatMap((unionError) => unionError.issues.map(formatZodIssue))
      .join("; ");
  }

  if (issue.path.length === 0) {
    return issue.message;
  }

  return `${issue.path.join(".")}: ${issue.message}`;
}

export async function loadAndValidateAgents(
  agentsDir: string,
  skills: LoadedSkill[],
  options: boolean | { strict?: boolean; modelTiers?: ModelTiers } = false,
): Promise<LoadedAgent[]> {
  const strict =
    typeof options === "boolean" ? options : (options.strict ?? false);
  const modelTiers =
    typeof options === "boolean" ? undefined : options.modelTiers;
  if (!(await pathExists(agentsDir))) {
    return [];
  }

  const entries = await readdir(agentsDir, { withFileTypes: true });
  const agents: LoadedAgent[] = [];
  const names = new Set<string>();
  const errors: string[] = [];
  const skillNames = new Set(skills.map((s) => s.name));

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;

    const filePath = path.join(agentsDir, entry.name);
    const raw = await readTextFile(filePath);
    let parsed: unknown;

    try {
      parsed = parseYaml(raw);
    } catch (e) {
      errors.push(
        `Agent "${entry.name}": invalid YAML - ${(e as Error).message}`,
      );
      continue;
    }

    // Check for unknown fields
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const parsedRecord = parsed as Record<string, unknown>;
      const unknownFields = collectUnknownFields(
        parsedRecord,
        AGENT_SOURCE_FIELDS,
      );

      if (
        parsedRecord.claude &&
        typeof parsedRecord.claude === "object" &&
        !Array.isArray(parsedRecord.claude)
      ) {
        unknownFields.push(
          ...collectUnknownFields(
            parsedRecord.claude as Record<string, unknown>,
            CLAUDE_TARGET_FIELDS,
            "claude.",
          ),
        );
      }

      if (
        parsedRecord.codex &&
        typeof parsedRecord.codex === "object" &&
        !Array.isArray(parsedRecord.codex)
      ) {
        unknownFields.push(
          ...collectUnknownFields(
            parsedRecord.codex as Record<string, unknown>,
            CODEX_TARGET_FIELDS,
            "codex.",
          ),
        );

        const approvalPolicy = (parsedRecord.codex as Record<string, unknown>)
          .approval_policy;
        if (
          approvalPolicy &&
          typeof approvalPolicy === "object" &&
          !Array.isArray(approvalPolicy)
        ) {
          unknownFields.push(
            ...collectUnknownFields(
              approvalPolicy as Record<string, unknown>,
              CODEX_APPROVAL_POLICY_FIELDS,
              "codex.approval_policy.",
            ),
          );
          const granular = (approvalPolicy as Record<string, unknown>).granular;
          if (
            granular &&
            typeof granular === "object" &&
            !Array.isArray(granular)
          ) {
            unknownFields.push(
              ...collectUnknownFields(
                granular as Record<string, unknown>,
                CODEX_APPROVAL_POLICY_GRANULAR_FIELDS,
                "codex.approval_policy.granular.",
              ),
            );
          }
        }
      }

      for (const field of unknownFields) {
        if (strict) {
          errors.push(`Agent "${entry.name}": unknown field "${field}".`);
        } else {
          getLogger().warn(`Warning: unknown field "${field}" in ${filePath}`);
        }
      }
    }

    const result = AgentSourceSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(formatZodIssue).join("; ");
      errors.push(`Agent "${entry.name}": ${issues}`);
      continue;
    }

    const source = result.data;

    if (names.has(source.name)) {
      errors.push(`Agent "${source.name}": duplicate name.`);
      continue;
    }
    names.add(source.name);

    // Validate skill references
    for (const skillRef of source.skills) {
      if (!skillNames.has(skillRef)) {
        errors.push(
          `Agent "${source.name}": references unknown skill "${skillRef}".`,
        );
      }
    }

    validateAgentModelTierReference(
      source.name,
      "claude.model",
      source.claude?.model,
      modelTiers,
      errors,
    );
    validateAgentModelTierReference(
      source.name,
      "codex.model",
      source.codex?.model,
      modelTiers,
      errors,
    );

    agents.push({ name: source.name, filePath, source });
  }

  // Warn about .yml files
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".yml")) {
      getLogger().warn(
        `Warning: ${entry.name} uses .yml extension. Rename to .yaml to be recognized.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new UserError(
      `Agent validation failed:\n  ${errors.join("\n  ")}`,
      agentsDir,
    );
  }

  return agents;
}

const MODEL_TIER_PLACEHOLDER = /^\{\{model:(\w+)\}\}$/;

function validateAgentModelTierReference(
  agentName: string,
  fieldPath: "claude.model" | "codex.model",
  value: string | undefined,
  modelTiers: ModelTiers | undefined,
  errors: string[],
): void {
  if (!value) return;

  const tier = value.match(MODEL_TIER_PLACEHOLDER)?.[1];
  if (!tier) return;

  if (!modelTiers) {
    errors.push(
      `Agent "${agentName}": ${fieldPath} references model tier "${tier}" but modelTiers is not configured.`,
    );
    return;
  }

  if (!modelTiers[tier]) {
    errors.push(
      `Agent "${agentName}": ${fieldPath} references unknown model tier "${tier}".`,
    );
  }
}
