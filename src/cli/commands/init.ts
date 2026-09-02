import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { reconcileDevcanonRuntimeSubtree } from "../../render/devcanon-runtime.js";
import type { AcceptedProvider } from "../../runtime-build/provider.js";
import { UserError } from "../../utils/errors.js";
import {
  ensureDir,
  pathExists,
  pathOrSymlinkExists,
  writeTextFile,
} from "../../utils/fs.js";
import { hashDirectory } from "../../utils/hash.js";
import { getLogger } from "../../utils/output.js";
import {
  bundledDevcanonRuntimeDir,
  validateBundledDevcanonRuntime,
  validateDevcanonRuntime,
} from "../../validate/devcanon-runtime.js";

const RUNTIME_SKILL_NAME = "devcanon-runtime";

type InitActionOptions = {
  runtimeSourceDir?: string;
};

export async function initAction(
  options: InitActionOptions = {},
  provider?: AcceptedProvider,
): Promise<void> {
  const logger = getLogger();
  const cwd = process.cwd();
  const configPath = path.join(cwd, CONFIG_FILE_NAME);
  const runtimeSourceDir = options.runtimeSourceDir ?? bundledRuntimeSkillDir();

  if (await pathExists(configPath)) {
    throw new UserError(
      `${CONFIG_FILE_NAME} already exists in this directory.`,
      configPath,
      "Remove it first or run from a different directory.",
    );
  }

  await preflightRuntimeSkill(cwd, runtimeSourceDir);

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

  await seedRuntimeSkill(cwd, runtimeSourceDir, provider);

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

async function seedRuntimeSkill(
  cwd: string,
  sourceDir: string,
  provider?: AcceptedProvider,
): Promise<void> {
  const logger = getLogger();
  const targetDir = path.join(cwd, "skills", RUNTIME_SKILL_NAME);

  if (await pathOrSymlinkExists(targetDir)) {
    await requireMatchingRuntimeSkill(sourceDir, targetDir);
    logger.info(
      `Support runtime already present: skills/${RUNTIME_SKILL_NAME}/`,
    );
    return;
  }

  await cp(sourceDir, targetDir, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  if (provider) await reconcileDevcanonRuntimeSubtree(targetDir, provider);
  logger.info(`Seeded support runtime: skills/${RUNTIME_SKILL_NAME}/`);
}

async function preflightRuntimeSkill(
  cwd: string,
  sourceDir: string,
): Promise<void> {
  await requireBundledRuntimeSkill(sourceDir);

  const targetDir = path.join(cwd, "skills", RUNTIME_SKILL_NAME);
  if (await pathOrSymlinkExists(targetDir)) {
    await requireMatchingRuntimeSkill(sourceDir, targetDir);
  }
}

async function requireBundledRuntimeSkill(sourceDir: string): Promise<void> {
  await validateBundledDevcanonRuntime(sourceDir);
}

async function requireMatchingRuntimeSkill(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  try {
    await validateDevcanonRuntime(targetDir, {
      adapterSourceDir: bundledDevcanonRuntimeDir(),
    });
  } catch {
    throw runtimeConflictError(targetDir);
  }

  if ((await hashDirectory(sourceDir)) === (await hashDirectory(targetDir))) {
    return;
  }

  throw runtimeConflictError(targetDir);
}

function runtimeConflictError(targetDir: string): UserError {
  return new UserError(
    `Existing skills/${RUNTIME_SKILL_NAME}/ does not match the bundled support runtime.`,
    targetDir,
    `Move or remove skills/${RUNTIME_SKILL_NAME}/, then rerun ${CLI_COMMAND} init. DevCanon will not overwrite an existing support runtime path.`,
  );
}

function bundledRuntimeSkillDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "../../../skills", RUNTIME_SKILL_NAME);
}
