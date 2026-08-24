import { describe, expect, it } from "vitest";
import type { InstallMode } from "../config/schema.js";
import { resolveEffectiveInstallMode } from "./mode.js";

describe("resolveEffectiveInstallMode", () => {
  it.each([
    ["claude", "skill", "symlink", "symlink"],
    ["claude", "skill", "copy", "copy"],
    ["claude", "agent", "symlink", "symlink"],
    ["claude", "agent", "copy", "copy"],
    ["codex", "skill", "symlink", "symlink"],
    ["codex", "skill", "copy", "copy"],
    ["codex", "agent", "symlink", "copy"],
    ["codex", "agent", "copy", "copy"],
  ] as const)(
    "resolves %s %s requested %s to %s",
    (target, type, requestedMode, expectedMode) => {
      expect(resolveEffectiveInstallMode(target, type, requestedMode)).toBe(
        expectedMode satisfies InstallMode,
      );
    },
  );
});
