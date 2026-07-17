import { loadConfig } from "../../config/load.js";
import { sync } from "../../install/sync.js";
import type { SyncOptions } from "../../models/types.js";
import { UserError } from "../../utils/errors.js";
import { getLogger } from "../../utils/output.js";

interface SyncCommandOptions {
  target?: string;
  mode?: string;
  dryRun?: boolean;
  force?: boolean;
  reconcileManifest?: boolean;
}

export async function syncAction(
  options: SyncCommandOptions,
  command: { parent?: { opts(): Record<string, unknown> } },
): Promise<void> {
  const logger = getLogger();
  const globalOpts = command.parent?.opts() ?? {};
  if (options.target && !["claude", "codex"].includes(options.target)) {
    throw new UserError(
      `Invalid target "${options.target}". Must be "claude" or "codex".`,
    );
  }
  if (options.mode && !["symlink", "copy"].includes(options.mode)) {
    throw new UserError(
      `Invalid mode "${options.mode}". Must be "symlink" or "copy".`,
    );
  }
  const strict = (globalOpts.strict as boolean) ?? false;
  const config = await loadConfig(
    globalOpts.config as string | undefined,
    strict,
  );

  const syncOptions: SyncOptions = {
    target: options.target as "claude" | "codex" | undefined,
    mode: options.mode as "symlink" | "copy" | undefined,
    dryRun: options.dryRun ?? false,
    force: options.force ?? false,
    strict,
    reconcileManifest: options.reconcileManifest ?? false,
  };

  const result = await sync(config, syncOptions);

  if (!syncOptions.dryRun) {
    logger.info(
      `\nSync complete: ${result.installed} installed, ${result.updated} updated, ${result.removed} removed, ${result.skipped} skipped, ${result.conflicts} conflicts`,
    );

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
