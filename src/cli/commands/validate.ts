import { loadConfig } from "../../config/load.js";
import { getLogger } from "../../utils/output.js";
import { loadAndValidateAgents } from "../../validate/agents.js";
import {
  type ValidationDiagnostic,
  formatValidationDiagnosticReport,
} from "../../validate/diagnostics.js";
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
  const json = Boolean(globalOpts.json);
  const skillDiagnostics: ValidationDiagnostic[] = [];

  const config = await loadConfig(
    globalOpts.config as string | undefined,
    strict,
  );
  if (!json) logger.info("Config: valid");

  const skills = await loadAndValidateSkills(config.library.skillsDir, {
    diagnostics: {
      enabled: true,
      strict,
      modelTiers: config.modelTiers,
      toolNames: config.toolNames,
      fileArtifacts: config.fileArtifacts,
      reporter: (diagnostic) => skillDiagnostics.push(diagnostic),
    },
  });
  if (!json) {
    logger.info(formatSkillsStatus(skills.length, skillDiagnostics.length));
  }

  const agents = await loadAndValidateAgents(config.library.agentsDir, skills, {
    strict,
    modelTiers: config.modelTiers,
  });
  if (!json) logger.info(`Agents: ${agents.length} valid`);

  if (!json) {
    for (const line of formatValidationDiagnosticReport(skillDiagnostics)) {
      logger.info(line);
    }

    logger.info(
      skillDiagnostics.length > 0
        ? "\nAll validations passed with warnings."
        : "\nAll validations passed.",
    );
  }

  if (json) {
    logger.json({
      config: "valid",
      skills: skills.map((s) => s.name),
      agents: agents.map((a) => a.name),
    });
  }
}

function formatSkillsStatus(skillCount: number, warningCount: number): string {
  if (warningCount === 0) return `Skills: ${skillCount} valid`;
  const warningLabel = warningCount === 1 ? "warning" : "warnings";
  return `Skills: ${skillCount} valid, ${warningCount} ${warningLabel}`;
}
