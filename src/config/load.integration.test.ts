import { writeFile } from "node:fs/promises";
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

  it("returns path from DEVCANON_CONFIG env var when file exists", async () => {
    const configPath = await createConfigFile(tempDir);
    vi.stubEnv("DEVCANON_CONFIG", configPath);
    try {
      const result = await findConfigPath();
      expect(result).toBe(path.resolve(configPath));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("throws UserError with hint when DEVCANON_CONFIG points to nonexistent file", async () => {
    const missing = path.join(tempDir, "gone.yaml");
    vi.stubEnv("DEVCANON_CONFIG", missing);
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

  it("does not use legacy AGENTS_MANAGER_CONFIG env var", async () => {
    const configPath = path.join(tempDir, "agents-manager.config.yaml");
    await writeFile(configPath, "version: 1\n", "utf8");
    const previousCwd = process.cwd();
    vi.stubEnv("AGENTS_MANAGER_CONFIG", configPath);
    try {
      process.chdir(tempDir);
      await expect(findConfigPath()).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        const ue = err as UserError;
        expect(ue.message).toBe(
          "No devcanon.config.yaml found in current directory.",
        );
        return true;
      });
    } finally {
      process.chdir(previousCwd);
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
    expect(result.library.skillsDir).toBe(path.resolve(configDir, "my-skills"));
    expect(result.library.agentsDir).toBe(path.resolve(configDir, "my-agents"));
  });

  it("warns about unknown top-level fields in non-strict mode but still returns config", async () => {
    const yaml = ["version: 1", "bogusField: surprise"].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result).toBeDefined();
    expect(result.configDir).toBeTruthy();
    expect(
      logCtx.testLogger.warnings.some((w) => w.includes("bogusField")),
    ).toBe(true);
  });

  it("throws UserError for unknown top-level field in strict mode", async () => {
    const yaml = ["version: 1", "bogusField: surprise"].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath, true)).rejects.toThrow(UserError);
  });

  it("throws UserError for invalid YAML syntax", async () => {
    const yaml = "version: 1\n  bad:\nindent: broken\n\t\tmixed";
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).filePath).toBe(configPath);
      expect((err as UserError).message).toContain("Invalid config YAML:");
      expect((err as UserError).message.length).toBeGreaterThan(
        "Invalid config YAML: ".length,
      );
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

  it("loads nested model tier profiles into resolved config", async () => {
    const yaml = [
      "version: 1",
      "modelTiers:",
      "  standard:",
      "    claude:",
      "      model: claude-sonnet-4-6",
      "      effort: medium",
      "    codex:",
      "      model: gpt-5.4",
      "      reasoning_effort: medium",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result.modelTiers?.standard.claude.model).toBe("claude-sonnet-4-6");
    expect(result.modelTiers?.standard.claude.effort).toBe("medium");
    expect(result.modelTiers?.standard.codex.model).toBe("gpt-5.4");
    expect(result.modelTiers?.standard.codex.reasoning_effort).toBe("medium");
  });

  it("warns about unknown nested model tier profile keys in non-strict mode", async () => {
    const yaml = [
      "version: 1",
      "modelTiers:",
      "  standard:",
      "    claude:",
      "      model: claude-sonnet-4-6",
      "      effort: medium",
      "      typo_field: true",
      "    codex:",
      "      model: gpt-5.4",
      "      reasoning_effort: medium",
      "    typo_target:",
      "      model: unexpected",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);

    const result = await loadConfig(configPath);

    expect(result.modelTiers?.standard.claude.model).toBe("claude-sonnet-4-6");
    expect(
      logCtx.testLogger.warnings.some((warning) =>
        warning.includes("modelTiers.standard.claude.typo_field"),
      ),
    ).toBe(true);
    expect(
      logCtx.testLogger.warnings.some((warning) =>
        warning.includes("modelTiers.standard.typo_target"),
      ),
    ).toBe(true);
  });

  it("rejects unknown nested model tier profile keys in strict mode", async () => {
    const yaml = [
      "version: 1",
      "modelTiers:",
      "  standard:",
      "    claude:",
      "      model: claude-sonnet-4-6",
      "      effort: medium",
      "      typo_field: true",
      "    codex:",
      "      model: gpt-5.4",
      "      reasoning_effort: medium",
      "      typo_field: true",
      "    typo_target:",
      "      model: unexpected",
    ].join("\n");
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath, true)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "modelTiers.standard.claude.typo_field",
        );
        expect((err as UserError).message).toContain(
          "modelTiers.standard.codex.typo_field",
        );
        expect((err as UserError).message).toContain(
          "modelTiers.standard.typo_target",
        );
        return true;
      },
    );
  });
});
