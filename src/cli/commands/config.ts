import {
  formatRuntimeConfigScalar,
  getRuntimeConfigScalar,
  selectRuntimeConfig,
} from "../../config/runtime-config.js";
import { getLogger } from "../../utils/output.js";

export async function configPathAction(
  _options: unknown,
  command: CommandWithOptions,
): Promise<void> {
  const globalOptions = rootOptions(command);
  const selected = await selectRuntimeConfig(
    globalOptions.config as string | undefined,
    Boolean(globalOptions.strict),
  );
  const logger = getLogger();

  if (globalOptions.json) {
    logger.json({ path: selected.path, source: selected.source });
    return;
  }
  logger.info(selected.path);
}

export async function configGetAction(
  key: string,
  _options: unknown,
  command: CommandWithOptions,
): Promise<void> {
  const globalOptions = rootOptions(command);
  const selected = await selectRuntimeConfig(
    globalOptions.config as string | undefined,
    Boolean(globalOptions.strict),
  );
  const value = getRuntimeConfigScalar(selected.value, key);
  const logger = getLogger();

  if (globalOptions.json) {
    logger.json({
      path: selected.path,
      source: selected.source,
      key,
      value,
    });
    return;
  }
  logger.info(formatRuntimeConfigScalar(value));
}

interface CommandWithOptions {
  opts(): Record<string, unknown>;
  parent?: CommandWithOptions;
}

function rootOptions(command: CommandWithOptions): Record<string, unknown> {
  let current = command;
  while (current.parent) current = current.parent;
  return current.opts();
}
