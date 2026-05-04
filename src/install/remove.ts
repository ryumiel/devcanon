import { rm } from "node:fs/promises";
import type { PlanAction } from "../models/types.js";
import { getLogger } from "../utils/output.js";

export async function executeRemove(action: PlanAction): Promise<void> {
  const logger = getLogger();
  await rm(action.installedPath, { recursive: true, force: true });
  logger.info(`  - ${action.target}/${action.type}/${action.name}`);
}

export function formatRemoveDryRunLine(action: PlanAction): string {
  return `  - [remove] ${action.target}/${action.type}/${action.name}`;
}
