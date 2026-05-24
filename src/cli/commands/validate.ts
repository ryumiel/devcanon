import { loadConfig } from "../../config/load.js";
import { getLogger } from "../../utils/output.js";
import { loadAndValidateAgents } from "../../validate/agents.js";
import {
  type ValidationDiagnostic,
  formatValidationDiagnosticReport,
  formatValidationDiagnosticWarnings,
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

  let skillWarningsPrinted = false;
  const printSkillWarnings = (): void => {
    if (skillWarningsPrinted) return;
    if (json) {
      for (const line of formatValidationDiagnosticWarnings(skillDiagnostics)) {
        logger.warn(line);
      }
    } else {
      for (const line of formatValidationDiagnosticReport(skillDiagnostics)) {
        logger.info(line);
      }
    }
    skillWarningsPrinted = true;
  };

  const skills = await loadAndValidateSkills(config.library.skillsDir, {
    diagnostics: {
      enabled: true,
      strict,
      modelTiers: config.modelTiers,
      toolNames: config.toolNames,
      fileArtifacts: config.fileArtifacts,
      reporter: (diagnostic) => skillDiagnostics.push(diagnostic),
    },
  }).catch((error: unknown) => {
    printSkillWarnings();
    throw error;
  });
  if (!json) {
    logger.info(formatSkillsStatus(skills.length, skillDiagnostics.length));
    printSkillWarnings();
  }

  const agents = await loadAndValidateAgents(config.library.agentsDir, skills, {
    strict,
    modelTiers: config.modelTiers,
  }).catch((error: unknown) => {
    printSkillWarnings();
    throw error;
  });
  if (!json) logger.info(`Agents: ${agents.length} valid`);

  if (!json) {
    logger.info(
      skillDiagnostics.length > 0
        ? "\nAll validations passed with warnings."
        : "\nAll validations passed.",
    );
  }

  if (json) {
    printSkillWarnings();
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
