import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import { UserError } from "../utils/errors.js";
import { findConfigPath, loadConfig } from "./load.js";

describe("findConfigPath", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("returns resolved absolute path when explicit path points to existing file", async () => {
    const configPath = await createConfigFile(tempDir);
    const result = await findConfigPath(configPath);
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.resolve(configPath));
  });

  it("throws UserError with hint when explicit path points to nonexistent file", async () => {
    const missing = path.join(tempDir, "nope.yaml");
    await expect(findConfigPath(missing)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      const ue = err as UserError;
      expect(ue.hint).toBe("Check the path and try again.");
      return true;
    });
  });

  it("returns path from AGENTS_MANAGER_CONFIG env var when file exists", async () => {
    const configPath = await createConfigFile(tempDir);
    vi.stubEnv("AGENTS_MANAGER_CONFIG", configPath);
    try {
      const result = await findConfigPath();
      expect(result).toBe(path.resolve(configPath));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("throws UserError with hint when AGENTS_MANAGER_CONFIG points to nonexistent file", async () => {
    const missing = path.join(tempDir, "gone.yaml");
    vi.stubEnv("AGENTS_MANAGER_CONFIG", missing);
    try {
      await expect(findConfigPath()).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        const ue = err as UserError;
        expect(ue.hint).toBe("Check the environment variable value.");
        return true;
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("loadConfig", () => {
  let tempDir: string;
  let logCtx: ReturnType<typeof installTestLogger>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    logCtx = installTestLogger();
  });

  afterEach(async () => {
    logCtx.restore();
    await cleanupTempDir(tempDir);
  });

  it("returns ResolvedConfig with defaults for minimal YAML (version: 1)", async () => {
    const configPath = await createConfigFile(tempDir, "version: 1\n");
    const result = await loadConfig(configPath);

    expect(result.configDir).toBe(path.dirname(path.resolve(configPath)));
    expect(result.library.skillsDir).toBeTruthy();
    expect(result.library.agentsDir).toBeTruthy();
    expect(result.library.generatedDir).toBeTruthy();
    expect(result.defaults.installMode).toBe("symlink");
  });

  it("resolves tilde paths in targets to absolute paths without tilde", async () => {
    const yaml = [
      "version: 1",
      "targets:",
      "  claude:",
      "    enabled: true",
      "    skillsHome: ~/claude-skills",
      "    agentsHome: ~/claude-agents",
      "  codex:",
      "    enabled: true",
      "    skillsHome: ~/codex-skills",
      "    agentsHome: ~/codex-agents",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(path.isAbsolute(result.targets.claude.skillsHome)).toBe(true);
    expect(result.targets.claude.skillsHome).not.toContain("~");
    expect(path.isAbsolute(result.targets.claude.agentsHome)).toBe(true);
    expect(result.targets.claude.agentsHome).not.toContain("~");
    expect(path.isAbsolute(result.targets.codex.skillsHome)).toBe(true);
    expect(result.targets.codex.skillsHome).not.toContain("~");
    expect(path.isAbsolute(result.targets.codex.agentsHome)).toBe(true);
    expect(result.targets.codex.agentsHome).not.toContain("~");
  });

  it("resolves relative skillsDir and agentsDir relative to config file directory", async () => {
    const yaml = [
      "version: 1",
      "library:",
      "  skillsDir: ./my-skills",
      "  agentsDir: ./my-agents",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    const configDir = path.dirname(path.resolve(configPath));
    expect(result.library.skillsDir).toBe(
      path.resolve(configDir, "my-skills"),
    );
    expect(result.library.agentsDir).toBe(
      path.resolve(configDir, "my-agents"),
    );
  });

  it("warns about unknown top-level fields in non-strict mode but still returns config", async () => {
    const yaml = [
      "version: 1",
      "bogusField: surprise",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result).toBeDefined();
    expect(result.configDir).toBeTruthy();
    expect(
      logCtx.testLogger.warnings.some((w) => w.includes("bogusField")),
    ).toBe(true);
  });

  it("throws UserError for unknown top-level field in strict mode", async () => {
    const yaml = [
      "version: 1",
      "bogusField: surprise",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath, true)).rejects.toThrow(UserError);
  });

  it("throws a non-UserError for invalid YAML syntax", async () => {
    const yaml = "version: 1\n  bad:\nindent: broken\n\t\tmixed";
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeDefined();
      expect(err).not.toBeInstanceOf(UserError);
      return true;
    });
  });

  it("throws UserError for schema-invalid content (version: 2)", async () => {
    const yaml = "version: 2\n";
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath)).rejects.toThrow(UserError);
  });

  it("respects target-level installMode: copy overriding default symlink", async () => {
    const yaml = [
      "version: 1",
      "targets:",
      "  claude:",
      "    enabled: true",
      "    skillsHome: ~/claude-skills",
      "    agentsHome: ~/claude-agents",
      "    installMode: copy",
      "  codex:",
      "    enabled: true",
      "    skillsHome: ~/codex-skills",
      "    agentsHome: ~/codex-agents",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result.defaults.installMode).toBe("symlink");
    expect(result.targets.claude.installMode).toBe("copy");
    expect(result.targets.codex.installMode).toBe("symlink");
  });
});
