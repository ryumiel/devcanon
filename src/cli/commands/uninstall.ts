import { loadConfig } from "../../config/load.js";
import { uninstall } from "../../install/uninstall.js";
import type { UninstallOptions } from "../../models/types.js";
import { UserError } from "../../utils/errors.js";
import { getLogger } from "../../utils/output.js";

interface UninstallCommandOptions {
  target?: string;
  dryRun?: boolean;
}

export async function uninstallAction(
  options: UninstallCommandOptions,
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

  const uninstallOptions: UninstallOptions = {
    target: options.target as "claude" | "codex" | undefined,
    dryRun: options.dryRun ?? false,
  };

  const result = await uninstall(config, uninstallOptions);

  if (!uninstallOptions.dryRun) {
    logger.info(`\nUninstall complete: ${result.removed} removed`);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        logger.error(`  Error: ${err}`);
      }
      process.exitCode = 1;
    }
  }

  if (globalOpts.json) {
    logger.json(result);
  }
}
