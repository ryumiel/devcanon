import { execFile } from "node:child_process";
import { cp, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
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
import {
  ensureDir,
  isDirectory,
  pathExists,
  pathOrSymlinkExists,
  writeTextFile,
} from "../../utils/fs.js";
import { hashDirectory } from "../../utils/hash.js";
import { getLogger } from "../../utils/output.js";

const RUNTIME_SKILL_NAME = "devcanon-runtime";
const RUNTIME_ENTRYPOINT = path.join("scripts", "devcanon-runtime.sh");
const RUNTIME_JS_DIR = path.join("scripts", "runtime");
const RUNTIME_JS_ENTRYPOINT = path.join(RUNTIME_JS_DIR, "cli.js");
const RUNTIME_JS_INDEX = path.join(RUNTIME_JS_DIR, "index.js");
const REQUIRED_RUNTIME_JS_FILES = [
  "artifacts.js",
  "cli.js",
  "command.js",
  "git.js",
  "index.js",
  "paths.js",
  "pr-review-leases.js",
  "pr-review-manifests.js",
  "review-artifacts.js",
  "schema.js",
] as const;
const REQUIRED_RUNTIME_FILES = [
  "SKILL.md",
  RUNTIME_ENTRYPOINT,
  path.join(RUNTIME_JS_DIR, "package.json"),
  ...REQUIRED_RUNTIME_JS_FILES.map((fileName) =>
    path.join(RUNTIME_JS_DIR, fileName),
  ),
] as const;
const execFileAsync = promisify(execFile);

type InitActionOptions = {
  runtimeSourceDir?: string;
};

export async function initAction(
  options: InitActionOptions = {},
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

  await seedRuntimeSkill(cwd, runtimeSourceDir);

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

async function seedRuntimeSkill(cwd: string, sourceDir: string): Promise<void> {
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
  if (!(await isDirectory(sourceDir))) {
    throw runtimeSourceMissingError(sourceDir);
  }

  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    if (!(await isRegularFile(path.join(sourceDir, relativePath)))) {
      throw runtimeSourceIncompleteError(sourceDir, relativePath);
    }
  }

  const entrypoint = path.join(sourceDir, RUNTIME_ENTRYPOINT);
  if (!(await hasExecutableBit(entrypoint))) {
    throw runtimeSourceIncompleteError(sourceDir, RUNTIME_ENTRYPOINT);
  }

  await requireRuntimeCommandContract(sourceDir);
  await requireRuntimeModuleSurface(sourceDir);
}

function runtimeSourceMissingError(sourceDir: string): UserError {
  return new UserError(
    `Bundled ${RUNTIME_SKILL_NAME} support skill is missing.`,
    sourceDir,
    "Reinstall DevCanon or run from a complete source checkout.",
  );
}

function runtimeSourceIncompleteError(
  sourceDir: string,
  relativePath: string,
): UserError {
  return new UserError(
    `Bundled ${RUNTIME_SKILL_NAME} support skill is incomplete.`,
    path.join(sourceDir, relativePath),
    `Reinstall DevCanon or restore ${relativePath} in the bundled support runtime.`,
  );
}

async function requireRuntimeCommandContract(sourceDir: string): Promise<void> {
  const jsEntrypoint = path.join(sourceDir, RUNTIME_JS_ENTRYPOINT);
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [jsEntrypoint, "contract"],
      {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const contract = JSON.parse(stdout) as unknown;
    if (!isRuntimeContract(contract)) {
      throw new Error("contract output did not match devcanon-runtime/v1");
    }
  } catch (err) {
    throw new UserError(
      `Bundled ${RUNTIME_SKILL_NAME} support skill contract check failed.`,
      jsEntrypoint,
      `Reinstall DevCanon or restore the bundled ${RUNTIME_SKILL_NAME} runtime payload. ${(err as Error).message}`,
    );
  }
}

async function requireRuntimeModuleSurface(sourceDir: string): Promise<void> {
  const indexEntrypoint = path.join(sourceDir, RUNTIME_JS_INDEX);
  try {
    const runtimeModule = (await import(
      pathToFileURL(indexEntrypoint).href
    )) as Record<string, unknown>;
    for (const exportName of [
      "normalizeRuntimePath",
      "runRuntimeCommand",
      "validateRuntimeSchema",
    ]) {
      if (typeof runtimeModule[exportName] !== "function") {
        throw new Error(`runtime export missing: ${exportName}`);
      }
    }
  } catch (err) {
    throw new UserError(
      `Bundled ${RUNTIME_SKILL_NAME} support skill module surface check failed.`,
      indexEntrypoint,
      `Reinstall DevCanon or restore the bundled ${RUNTIME_SKILL_NAME} runtime payload. ${(err as Error).message}`,
    );
  }
}

function isRuntimeContract(
  value: unknown,
): value is { command_group: "devcanon-runtime"; major_version: 1 } {
  return (
    value !== null &&
    typeof value === "object" &&
    "command_group" in value &&
    value.command_group === "devcanon-runtime" &&
    "major_version" in value &&
    value.major_version === 1
  );
}

async function requireMatchingRuntimeSkill(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  if (!(await isDirectory(targetDir))) {
    throw runtimeConflictError(targetDir);
  }

  for (const relativePath of REQUIRED_RUNTIME_FILES) {
    if (!(await isRegularFile(path.join(targetDir, relativePath)))) {
      throw runtimeConflictError(targetDir);
    }
  }

  if (!(await hasExecutableBit(path.join(targetDir, RUNTIME_ENTRYPOINT)))) {
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

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function hasExecutableBit(filePath: string): Promise<boolean> {
  if (process.platform === "win32") return true;
  try {
    return ((await stat(filePath)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
