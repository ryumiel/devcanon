import path from "node:path";
import {
  DEFAULT_CONFIG_YAML,
  SAMPLE_AGENT_YAML,
  SAMPLE_SKILL_MD,
} from "../../config/defaults.js";
import {
  CLI_COMMAND,
  CONFIG_FILE_NAME,
  PRODUCT_NAME,
} from "../../config/identity.js";
import { UserError } from "../../utils/errors.js";
import { ensureDir, pathExists, writeTextFile } from "../../utils/fs.js";
import { getLogger } from "../../utils/output.js";

export async function initAction(): Promise<void> {
  const logger = getLogger();
  const cwd = process.cwd();
  const configPath = path.join(cwd, CONFIG_FILE_NAME);

  if (await pathExists(configPath)) {
    throw new UserError(
      `${CONFIG_FILE_NAME} already exists in this directory.`,
      configPath,
      "Remove it first or run from a different directory.",
    );
  }

  // Create config
  await writeTextFile(configPath, DEFAULT_CONFIG_YAML);
  logger.info(`Created ${CONFIG_FILE_NAME}`);

  // Create source directories
  await ensureDir(path.join(cwd, "skills"));
  await ensureDir(path.join(cwd, "agents"));
  await ensureDir(path.join(cwd, "generated"));
  logger.info("Created skills/, agents/, generated/ directories");

  // Create sample skill
  const sampleSkillDir = path.join(cwd, "skills", "example-skill");
  await ensureDir(sampleSkillDir);
  await writeTextFile(path.join(sampleSkillDir, "SKILL.md"), SAMPLE_SKILL_MD);
  logger.info("Created sample skill: skills/example-skill/");

  // Create sample agent
  await writeTextFile(
    path.join(cwd, "agents", "example-agent.yaml"),
    SAMPLE_AGENT_YAML,
  );
  logger.info("Created sample agent: agents/example-agent.yaml");

  logger.info(
    `\nDone! Run '${CLI_COMMAND} validate' to verify your ${PRODUCT_NAME} setup.`,
  );
}
