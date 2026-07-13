import { loadConfig } from "../../config/load.js";
import { UserError } from "../../utils/errors.js";
import { getLogger } from "../../utils/output.js";
import { loadAndValidateAgents } from "../../validate/agents.js";
import { loadAndValidateSkills } from "../../validate/skills.js";

interface ListOptions {
  target?: string;
}

export async function listAction(
  options: ListOptions,
  command: { parent?: { opts(): Record<string, unknown> } },
): Promise<void> {
  const logger = getLogger();
  const globalOpts = command.parent?.opts() ?? {};
  if (options.target && !["claude", "codex"].includes(options.target)) {
    throw new UserError(
      `Invalid target "${options.target}". Must be "claude" or "codex".`,
    );
  }
  const strict = (globalOpts.strict as boolean) ?? false;
  const config = await loadConfig(
    globalOpts.config as string | undefined,
    strict,
  );

  const skills = await loadAndValidateSkills(config.library.skillsDir, {
    diagnostics: {
      enabled: false,
      capabilityProfiles: config.capabilityProfiles,
      toolNames: config.toolNames,
      fileArtifacts: config.fileArtifacts,
    },
  });
  const agents = await loadAndValidateAgents(config.library.agentsDir, skills, {
    strict,
  });

  if (skills.length > 0) {
    logger.info("Skills:");
    for (const skill of skills) {
      logger.info(`  ${skill.name}`);
      if (skill.subdirs.length > 0)
        logger.verbose(`    subdirs: ${skill.subdirs.join(", ")}`);
    }
  }

  if (agents.length > 0) {
    logger.info("\nAgents:");
    for (const agent of agents) {
      logger.info(`  ${agent.name}: ${agent.source.description}`);
      if (agent.source.skills.length > 0)
        logger.verbose(`    skills: ${agent.source.skills.join(", ")}`);
    }
  }

  if (skills.length === 0 && agents.length === 0) {
    logger.info("No skills or agents found.");
  }

  if (globalOpts.json) {
    logger.json({
      skills: skills.map((s) => ({ name: s.name, subdirs: s.subdirs })),
      agents: agents.map((a) => ({
        name: a.name,
        description: a.source.description,
        skills: a.source.skills,
      })),
    });
  }
}
