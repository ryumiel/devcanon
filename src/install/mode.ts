import type { InstallMode } from "../config/schema.js";
import type { RenderedOutput } from "../models/types.js";

export function resolveEffectiveInstallMode(
  target: RenderedOutput["target"],
  type: RenderedOutput["type"],
  requestedMode: InstallMode,
): InstallMode {
  return target === "codex" && type === "agent" ? "copy" : requestedMode;
}
