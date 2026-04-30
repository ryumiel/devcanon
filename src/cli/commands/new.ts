import path from "node:path";
import { loadConfig } from "../../config/load.js";
import type { ModelTiers } from "../../config/schema.js";
import { UserError } from "../../utils/errors.js";
import { ensureDir, pathExists, writeTextFile } from "../../utils/fs.js";
import { FILESYSTEM_SAFE } from "../../utils/naming.js";
import { getLogger } from "../../utils/output.js";

function pickPreferredTier(tiers: ModelTiers | undefined): string | null {
  if (!tiers) return null;
  const keys = Object.keys(tiers);
  if (keys.length === 0) return null;
  return Object.hasOwn(tiers, "standard") ? "standard" : (keys[0] ?? null);
}

export async function newSkillAction(
  name: string,
  _options: unknown,
  command: { parent?: { parent?: { opts(): Record<string, unknown> } } },
): Promise<void> {
  if (!FILESYSTEM_SAFE.test(name)) {
    throw new UserError(
      `Invalid name "${name}". Must be lowercase alphanumeric with hyphens, dots, or underscores.`,
    );
  }
  const logger = getLogger();
  const globalOpts = command.parent?.parent?.opts() ?? {};
  const config = await loadConfig(globalOpts.config as string | undefined);

  const skillDir = path.join(config.library.skillsDir, name);
  if (await pathExists(skillDir)) {
    throw new UserError(`Skill "${name}" already exists at ${skillDir}`);
  }

  await ensureDir(skillDir);
  await writeTextFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Describe this skill.\n---\n\n# ${name}\n\nDescribe what this skill does.\n`,
  );

  logger.info(`Created skill: ${skillDir}/`);
}

export async function newAgentAction(
  name: string,
  _options: unknown,
  command: { parent?: { parent?: { opts(): Record<string, unknown> } } },
): Promise<void> {
  if (!FILESYSTEM_SAFE.test(name)) {
    throw new UserError(
      `Invalid name "${name}". Must be lowercase alphanumeric with hyphens, dots, or underscores.`,
    );
  }
  const logger = getLogger();
  const globalOpts = command.parent?.parent?.opts() ?? {};
  const config = await loadConfig(globalOpts.config as string | undefined);

  const agentPath = path.join(config.library.agentsDir, `${name}.yaml`);
  if (await pathExists(agentPath)) {
    throw new UserError(`Agent "${name}" already exists at ${agentPath}`);
  }

  const preferredTier = pickPreferredTier(config.modelTiers);
  const modelLine = preferredTier
    ? `  model: "{{model:${preferredTier}}}"\n`
    : "";

  await writeTextFile(
    agentPath,
    `name: ${name}\ndescription: Describe this agent.\ninstructions: |\n  Describe what this agent does.\n\nskills: []\n\nclaude:\n${modelLine}  tools:\n    - Read\n    - Grep\n\ncodex:\n${modelLine}  sandbox_mode: read-only\n`,
  );

  logger.info(`Created agent: ${agentPath}`);
}
