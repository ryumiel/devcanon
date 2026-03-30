import { loadConfig } from "../../config/load.js";
import { getLogger } from "../../utils/output.js";
import { loadAndValidateAgents } from "../../validate/agents.js";
import { loadAndValidateSkills } from "../../validate/skills.js";

interface ValidateOptions {
  strict?: boolean;
}

export async function validateAction(
  options: ValidateOptions,
  command: { parent?: { opts(): Record<string, unknown> } },
): Promise<void> {
  const logger = getLogger();
  const globalOpts = command.parent?.opts() ?? {};
  const strict = options.strict ?? (globalOpts.strict as boolean) ?? false;

  const config = await loadConfig(
    globalOpts.config as string | undefined,
    strict,
  );
  logger.info("Config: valid");

  const skills = await loadAndValidateSkills(config.library.skillsDir);
  logger.info(`Skills: ${skills.length} valid`);

  const agents = await loadAndValidateAgents(
    config.library.agentsDir,
    skills,
    strict,
  );
  logger.info(`Agents: ${agents.length} valid`);

  logger.info("\nAll validations passed.");

  if (globalOpts.json) {
    logger.json({
      config: "valid",
      skills: skills.map((s) => s.name),
      agents: agents.map((a) => a.name),
    });
  }
}
