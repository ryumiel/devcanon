import path from "node:path";
import { loadConfig } from "../../config/load.js";
import { UserError } from "../../utils/errors.js";
import { ensureDir, pathExists, writeTextFile } from "../../utils/fs.js";
import { getLogger } from "../../utils/output.js";

const FILESYSTEM_SAFE = /^[a-z0-9][a-z0-9._-]*$/;

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

  await writeTextFile(
    agentPath,
    `name: ${name}\ndescription: Describe this agent.\ninstructions: |\n  Describe what this agent does.\n\nskills: []\n\nclaude:\n  model: sonnet\n  tools:\n    - Read\n    - Grep\n\ncodex:\n  sandbox_mode: read-only\n`,
  );

  logger.info(`Created agent: ${agentPath}`);
}
