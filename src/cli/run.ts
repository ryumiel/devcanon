import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { CLI_COMMAND } from "../config/identity.js";
import type {
  AcceptedProvider,
  ArtifactOrigin,
} from "../runtime-build/provider.js";
import { verifyProvider } from "../runtime-build/provider.js";
import { EnvironmentError, UserError } from "../utils/errors.js";
import { type LogLevel, createLogger, setLogger } from "../utils/output.js";
import { configGetAction, configPathAction } from "./commands/config.js";
import { diffAction } from "./commands/diff.js";
import { doctorAction } from "./commands/doctor.js";
import { initAction } from "./commands/init.js";
import { listAction } from "./commands/list.js";
import { newAgentAction, newSkillAction } from "./commands/new.js";
import { renderAction } from "./commands/render.js";
import { syncAction } from "./commands/sync.js";
import { uninstallAction } from "./commands/uninstall.js";
import { validateAction } from "./commands/validate.js";

export type RuntimeProviderResolver = () => Promise<AcceptedProvider>;

export function createCliProgram(
  resolveProvider: RuntimeProviderResolver,
): Command {
  const program = new Command();
  program
    .name(CLI_COMMAND)
    .description(
      "Manage personal AI skills and generate native agent files for Claude Code and Codex.",
    )
    .version("2.0.0")
    .option("--config <path>", "path to config file")
    .option("--json", "output machine-readable JSON")
    .option("--log-level <level>", "quiet | normal | verbose | debug", "normal")
    .option("--strict", "treat warnings as errors")
    .hook("preAction", (thisCommand) => {
      const opts = thisCommand.opts();
      const validLevels = ["quiet", "normal", "verbose", "debug"];
      if (!validLevels.includes(opts.logLevel))
        throw new UserError(
          `Invalid log level "${opts.logLevel}". Must be one of: ${validLevels.join(", ")}`,
        );
      setLogger(createLogger(opts.logLevel as LogLevel, opts.json ?? false));
    });
  program
    .command("init")
    .description("Initialize a new DevCanon library")
    .action(async (options) => initAction(options, await resolveProvider()));
  const newCmd = program
    .command("new")
    .description("Create a new skill or agent");
  newCmd
    .command("skill <name>")
    .description("Scaffold a new skill directory with SKILL.md")
    .action(newSkillAction);
  newCmd
    .command("agent <name>")
    .description("Scaffold a new agent YAML file")
    .action(newAgentAction);
  const configCmd = program
    .command("config")
    .description("Inspect the selected DevCanon configuration");
  configCmd
    .command("path")
    .description("Print the selected configuration path")
    .action(configPathAction);
  configCmd
    .command("get <key>")
    .description("Print a scalar configuration value")
    .action(configGetAction);
  program
    .command("validate")
    .description(
      "Validate config, the passive runtime bundle, skills, and agents",
    )
    .option("--strict", "treat warnings as errors")
    .action(async (options, command) =>
      validateAction(options, command, resolveProvider),
    );
  program
    .command("render")
    .description("Generate outputs to generated/ without installing")
    .option("--target <target>", "claude or codex")
    .action(async (options, command) =>
      renderAction(options, command, await resolveProvider()),
    );
  program
    .command("sync")
    .description("Render and install managed outputs")
    .option("--target <target>", "claude or codex")
    .option("--mode <mode>", "symlink or copy")
    .option("--dry-run", "show plan without executing")
    .option("--force", "overwrite unmanaged files")
    .option("--reconcile-manifest", "remove foreign legacy manifest records")
    .action((options, command) =>
      syncAction(options, command, resolveProvider),
    );
  program
    .command("uninstall")
    .description("Remove managed outputs recorded in the manifest")
    .option("--target <target>", "claude or codex")
    .option("--dry-run", "show plan without executing")
    .action(uninstallAction);
  program
    .command("diff")
    .description("Compare generated vs installed outputs")
    .option("--target <target>", "claude or codex")
    .action((options, command) =>
      diffAction(options, command, resolveProvider),
    );
  program
    .command("doctor")
    .description("Inspect environment health")
    .action(doctorAction);
  program
    .command("list")
    .description("List known skills and agents")
    .option("--target <target>", "claude or codex")
    .action(listAction);
  return program;
}

export async function runCli(
  origin: ArtifactOrigin,
  distributionRoot: string,
): Promise<void> {
  let provider: Promise<AcceptedProvider> | undefined;
  const resolveProvider = (): Promise<AcceptedProvider> => {
    if (provider === undefined) {
      provider = acceptProvider(origin, distributionRoot);
    }
    return provider;
  };
  try {
    await createCliProgram(resolveProvider).parseAsync();
  } catch (error) {
    if (error instanceof UserError) {
      console.error(`Error: ${error.message}`);
      if (error.filePath) console.error(`  File: ${error.filePath}`);
      if (error.hint) console.error(`  Hint: ${error.hint}`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof EnvironmentError) {
      console.error(`Environment error: ${error.message}`);
      if (error.hint) console.error(`  Hint: ${error.hint}`);
      process.exitCode = 2;
      return;
    }
    console.error(`Unexpected error: ${(error as Error).message}`);
    if (process.env.DEBUG) console.error((error as Error).stack);
    process.exitCode = 3;
  }
}

async function acceptProvider(
  origin: ArtifactOrigin,
  distributionRoot: string,
): Promise<AcceptedProvider> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(distributionRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    if (typeof packageJson.version !== "string")
      throw new Error("package.json has no version");
    const root = path.join(
      distributionRoot,
      "dist",
      "devcanon-runtime",
      origin,
    );
    if (origin === "package")
      return verifyProvider({
        root,
        origin,
        devcanonVersion: packageJson.version,
      });
    const { verifySourceProvider } = await import(
      "../runtime-build/producer.js"
    );
    return verifySourceProvider({
      repositoryRoot: distributionRoot,
      root,
      devcanonVersion: packageJson.version,
    });
  } catch (error) {
    throw new EnvironmentError(
      `Runtime provider (${origin}) is unavailable or invalid: ${(error as Error).message}`,
      origin === "source-build"
        ? "Run pnpm run build:runtime and retry."
        : "Reinstall the DevCanon package and retry.",
    );
  }
}
