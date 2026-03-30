import pc from "picocolors";
import { loadConfig } from "../../config/load.js";
import { diffAll } from "../../diff/diff.js";
import { UserError } from "../../utils/errors.js";
import { getLogger } from "../../utils/output.js";

interface DiffCommandOptions {
  target?: string;
}

export async function diffAction(
  options: DiffCommandOptions,
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

  const results = await diffAll(
    config,
    options.target as "claude" | "codex" | undefined,
    strict,
  );

  const added = results.filter((r) => r.status === "added");
  const removed = results.filter((r) => r.status === "removed");
  const changed = results.filter((r) => r.status === "changed");
  const conflicts = results.filter((r) => r.status === "unmanaged-conflict");
  if (added.length > 0) {
    logger.info(pc.green(`\nAdded (${added.length}):`));
    for (const r of added) logger.info(`  + ${r.target}/${r.type}/${r.name}`);
  }

  if (removed.length > 0) {
    logger.info(pc.red(`\nRemoved (${removed.length}):`));
    for (const r of removed) logger.info(`  - ${r.target}/${r.type}/${r.name}`);
  }

  if (changed.length > 0) {
    logger.info(pc.yellow(`\nChanged (${changed.length}):`));
    for (const r of changed) {
      logger.info(`  ~ ${r.target}/${r.type}/${r.name}`);
      if (r.diff) logger.verbose(r.diff);
    }
  }

  if (conflicts.length > 0) {
    logger.info(pc.red(`\nUnmanaged conflicts (${conflicts.length}):`));
    for (const r of conflicts)
      logger.info(`  ! ${r.target}/${r.type}/${r.name} at ${r.installedPath}`);
  }

  if (
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    conflicts.length === 0
  ) {
    logger.info("Everything is up to date.");
  }

  if (globalOpts.json) {
    logger.json(results);
  }
}
