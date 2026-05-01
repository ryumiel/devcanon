import path from "node:path";
import {
  CLAUDE_TARGET_FIELDS,
  MODEL_TIER_PLACEHOLDER_PREFIX,
  type ResolvedConfig,
} from "../config/schema.js";
import type {
  LoadedAgent,
  LoadedSkill,
  RenderedAgent,
} from "../models/types.js";
import { UserError } from "../utils/errors.js";
import { sha256 } from "../utils/hash.js";
import {
  extractModelTierKey,
  resolveTierProfile,
} from "./model-tier-profiles.js";
import {
  SAFE_PASSTHROUGH_KEY,
  describeValueShape,
  isHomogeneousScalarArray,
  isPassthroughPrimitive,
  sortedUnknownEntries,
  warnPassthroughSkip,
} from "./passthrough.js";

/**
 * Emit one YAML frontmatter line for an unknown Claude field, or `null` when
 * the value or key is not safely renderable. Strings are JSON-stringified
 * (valid YAML 1.2 flow scalars), arrays use JSON flow form `[...]` — both
 * guard against characters (`:`, `#`, newlines) that would break frontmatter
 * parsing. The bare comma-joined `tools:` shape is a Claude convention for
 * that specific field and is not extrapolated here.
 */
function renderClaudePassthroughLine(
  key: string,
  value: unknown,
  agentName: string,
): string | null {
  if (!SAFE_PASSTHROUGH_KEY.test(key)) {
    warnPassthroughSkip(
      "claude",
      agentName,
      key,
      `key must match ${SAFE_PASSTHROUGH_KEY}`,
    );
    return null;
  }

  if (value === undefined) return null;

  if (isPassthroughPrimitive(value)) {
    if (typeof value === "string") return `${key}: ${JSON.stringify(value)}`;
    if (value === null) return `${key}: null`;
    return `${key}: ${String(value)}`;
  }

  if (isHomogeneousScalarArray(value)) {
    const items = value.map((item) =>
      typeof item === "string" ? JSON.stringify(item) : String(item),
    );
    return `${key}: [${items.join(", ")}]`;
  }

  warnPassthroughSkip(
    "claude",
    agentName,
    key,
    `unsupported value shape: ${describeValueShape(value)}`,
  );
  return null;
}

export function renderClaudeAgent(
  agent: LoadedAgent,
  skills: Map<string, LoadedSkill>,
  config: ResolvedConfig,
): RenderedAgent {
  const lines: string[] = [];

  // Frontmatter - explicit ordering for determinism
  lines.push("---");
  lines.push(`name: ${agent.source.name}`);
  lines.push(`description: ${JSON.stringify(agent.source.description)}`);

  const claude = agent.source.claude;
  // If the model field looks like a tier placeholder but the strict
  // anchored regex did not match (e.g. surrounding whitespace, hyphens),
  // refuse to emit the literal placeholder string into rendered output.
  // Validation usually catches this earlier; this is defense in depth.
  if (
    claude?.model?.includes(MODEL_TIER_PLACEHOLDER_PREFIX) &&
    extractModelTierKey(claude.model) === null
  ) {
    throw new UserError(
      `Agent "${agent.name}": claude.model has invalid model placeholder syntax "${claude.model}".`,
      agent.filePath,
    );
  }
  const tierKey = extractModelTierKey(claude?.model);
  const tierProfile = tierKey
    ? resolveTierProfile(tierKey, "claude", config.modelTiers)
    : null;

  if (claude?.tools?.length) {
    lines.push(`tools: ${claude.tools.join(", ")}`);
  }
  const model = tierProfile?.model ?? claude?.model;
  if (model) {
    lines.push(`model: ${model}`);
  }
  const effort = claude?.effort ?? tierProfile?.effort;
  if (effort) {
    lines.push(`effort: ${effort}`);
  }

  for (const [key, value] of sortedUnknownEntries(
    claude as Record<string, unknown> | undefined,
    CLAUDE_TARGET_FIELDS,
  )) {
    const line = renderClaudePassthroughLine(key, value, agent.name);
    if (line !== null) lines.push(line);
  }

  lines.push("---");
  lines.push("");

  // Instructions body directly (no ## Instructions wrapper)
  lines.push(agent.source.instructions.trimEnd());

  // Skills section
  const agentSkills = agent.source.skills;
  if (agentSkills.length > 0) {
    lines.push("");
    lines.push("## Skills");
    lines.push("");
    for (const skillName of agentSkills) {
      const installPath = path
        .join(config.targets.claude.skillsHome, skillName)
        .replaceAll("\\", "/");
      lines.push(`- **${skillName}** (\`${installPath}\`)`);
    }
  }

  lines.push("");

  const content = lines.join("\n");
  return {
    target: "claude",
    type: "agent",
    name: agent.name,
    sourcePath: agent.filePath,
    generatedPath: path.join(
      config.library.generatedDir,
      "claude",
      "agents",
      `${agent.name}.md`,
    ),
    installedPath: path.join(
      config.targets.claude.agentsHome,
      `${agent.name}.md`,
    ),
    content,
    contentHash: sha256(content),
  };
}
