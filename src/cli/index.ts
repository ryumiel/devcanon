#!/usr/bin/env node

import { Command } from "commander";
import { CLI_COMMAND } from "../config/identity.js";
import { EnvironmentError, UserError } from "../utils/errors.js";
import { type LogLevel, createLogger, setLogger } from "../utils/output.js";
import { diffAction } from "./commands/diff.js";
import { doctorAction } from "./commands/doctor.js";
import { initAction } from "./commands/init.js";
import { listAction } from "./commands/list.js";
import { newAgentAction, newSkillAction } from "./commands/new.js";
import { renderAction } from "./commands/render.js";
import { syncAction } from "./commands/sync.js";
import { uninstallAction } from "./commands/uninstall.js";
import { validateAction } from "./commands/validate.js";

const program = new Command();

program
  .name(CLI_COMMAND)
  .description(
    "Manage personal AI skills and generate native agent files for Claude Code and Codex.",
  )
  .version("0.1.0")
  .option("--config <path>", "path to config file")
  .option("--json", "output machine-readable JSON")
  .option("--log-level <level>", "quiet | normal | verbose | debug", "normal")
  .option("--strict", "treat warnings as errors")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    const validLevels = ["quiet", "normal", "verbose", "debug"];
    if (!validLevels.includes(opts.logLevel)) {
      console.error(
        `Invalid log level "${opts.logLevel}". Must be one of: ${validLevels.join(", ")}`,
      );
      process.exit(1);
    }
    const logger = createLogger(opts.logLevel as LogLevel, opts.json ?? false);
    setLogger(logger);
  });

// init
program
  .command("init")
  .description("Initialize a new DevCanon library")
  .action(initAction);

// new skill / new agent
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

// validate
program
  .command("validate")
  .description("Validate config, skills, and agents")
  .option("--strict", "treat warnings as errors")
  .action(validateAction);

// render
program
  .command("render")
  .description("Generate outputs to generated/ without installing")
  .option("--target <target>", "claude or codex")
  .action(renderAction);

// sync
program
  .command("sync")
  .description("Render and install managed outputs")
  .option("--target <target>", "claude or codex")
  .option("--mode <mode>", "symlink or copy")
  .option("--dry-run", "show plan without executing")
  .option("--force", "overwrite unmanaged files")
  .option("--reconcile-manifest", "remove foreign legacy manifest records")
  .action(syncAction);

// uninstall
program
  .command("uninstall")
  .description("Remove managed outputs recorded in the manifest")
  .option("--target <target>", "claude or codex")
  .option("--dry-run", "show plan without executing")
  .action(uninstallAction);

// diff
program
  .command("diff")
  .description("Compare generated vs installed outputs")
  .option("--target <target>", "claude or codex")
  .action(diffAction);

// doctor
program
  .command("doctor")
  .description("Inspect environment health")
  .action(doctorAction);

// list
program
  .command("list")
  .description("List known skills and agents")
  .option("--target <target>", "claude or codex")
  .action(listAction);

async function main(): Promise<void> {
  try {
    await program.parseAsync();
  } catch (err: unknown) {
    if (err instanceof UserError) {
      console.error(`Error: ${err.message}`);
      if (err.filePath) console.error(`  File: ${err.filePath}`);
      if (err.hint) console.error(`  Hint: ${err.hint}`);
      process.exit(1);
    }
    if (err instanceof EnvironmentError) {
      console.error(`Environment error: ${err.message}`);
      if (err.hint) console.error(`  Hint: ${err.hint}`);
      process.exit(2);
    }
    console.error(`Unexpected error: ${(err as Error).message}`);
    if (process.env.DEBUG) console.error((err as Error).stack);
    process.exit(3);
  }
}

main();
