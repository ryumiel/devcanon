import { loadConfig } from "../config/load.js";
import type { ResolvedConfig } from "../config/schema.js";

export async function validateConfig(
  configPath?: string,
  strict?: boolean,
): Promise<ResolvedConfig> {
  return loadConfig(configPath, strict);
}
