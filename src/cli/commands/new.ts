import path from "node:path";
import { loadConfig } from "../../config/load.js";
import { UserError } from "../../utils/errors.js";
import { ensureDir, pathExists, writeTextFile } from "../../utils/fs.js";
import { FILESYSTEM_SAFE } from "../../utils/naming.js";
import { getLogger } from "../../utils/output.js";

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

  if (!config.modelTiers?.standard) {
    throw new UserError(
      "Cannot scaffold an agent with `{{model:standard}}` because `modelTiers.standard` is not configured.",
    );
  }

  await writeTextFile(
    agentPath,
    `name: ${name}\ndescription: Describe this agent.\ninstructions: |\n  Describe what this agent does.\n\nskills: []\n\nclaude:\n  model: "{{model:standard}}"\n  tools:\n    - Read\n    - Grep\n\ncodex:\n  model: "{{model:standard}}"\n  sandbox_mode: read-only\n`,
  );

  logger.info(`Created agent: ${agentPath}`);
}
