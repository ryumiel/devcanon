import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_CAPABILITY_PROFILES,
  cleanupTempDir,
  createConfigFile,
  createTempDir,
  makeConfigYaml,
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

  it("returns ResolvedConfig with defaults and the required catalog", async () => {
    const configPath = await createConfigFile(tempDir, makeConfigYaml());
    const result = await loadConfig(configPath);

    expect(result.configDir).toBe(path.dirname(path.resolve(configPath)));
    expect(result.library.skillsDir).toBeTruthy();
    expect(result.library.agentsDir).toBeTruthy();
    expect(result.library.generatedDir).toBeTruthy();
    expect(result.defaults.installMode).toBe("symlink");
    expect(result.capabilityProfiles.balanced).toEqual({
      claude: "claude-sonnet-5",
      codex: "gpt-5.6-terra",
    });
  });

  it("resolves tilde paths in targets to absolute paths without tilde", async () => {
    const yaml = makeConfigYaml({
      targets: {
        claude: {
          enabled: true,
          skillsHome: "~/claude-skills",
          agentsHome: "~/claude-agents",
        },
        codex: {
          enabled: true,
          skillsHome: "~/codex-skills",
          agentsHome: "~/codex-agents",
        },
      },
    });
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
    const yaml = makeConfigYaml({
      library: {
        skillsDir: "./my-skills",
        agentsDir: "./my-agents",
      },
    });
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    const configDir = path.dirname(path.resolve(configPath));
    expect(result.library.skillsDir).toBe(path.resolve(configDir, "my-skills"));
    expect(result.library.agentsDir).toBe(path.resolve(configDir, "my-agents"));
  });

  it("resolves relative target homes and manifest path from the config directory outside the cwd", async () => {
    const configDir = path.join(tempDir, "project", "config");
    const elsewhere = path.join(tempDir, "elsewhere");
    await mkdir(elsewhere, { recursive: true });
    const yaml = makeConfigYaml({
      targets: {
        claude: {
          enabled: true,
          skillsHome: "./homes/claude/skills",
          agentsHome: "./homes/claude/agents",
        },
        codex: {
          enabled: true,
          skillsHome: "./homes/codex/skills",
          agentsHome: "./homes/codex/agents",
        },
      },
      manifest: { path: "./state/manifest.json" },
    });
    await mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "devcanon.config.yaml");
    await writeFile(configPath, yaml, "utf8");
    const previousCwd = process.cwd();

    try {
      process.chdir(elsewhere);
      const result = await loadConfig(configPath);

      expect(result.targets.claude.skillsHome).toBe(
        path.join(configDir, "homes", "claude", "skills"),
      );
      expect(result.targets.claude.agentsHome).toBe(
        path.join(configDir, "homes", "claude", "agents"),
      );
      expect(result.targets.codex.skillsHome).toBe(
        path.join(configDir, "homes", "codex", "skills"),
      );
      expect(result.targets.codex.agentsHome).toBe(
        path.join(configDir, "homes", "codex", "agents"),
      );
      expect(result.manifest.path).toBe(
        path.join(configDir, "state", "manifest.json"),
      );
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("resolves an absolute target-home spelling identically to its config-relative spelling", async () => {
    const configDir = path.join(tempDir, "project", "config");
    const absoluteClaudeSkillsHome = path.join(
      configDir,
      "homes",
      "claude",
      "skills",
    );
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "relative.config.yaml"),
      makeConfigYaml({
        targets: {
          claude: {
            enabled: true,
            skillsHome: "./homes/claude/skills",
            agentsHome: "./homes/claude/agents",
          },
          codex: {
            enabled: true,
            skillsHome: "./homes/codex/skills",
            agentsHome: "./homes/codex/agents",
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(configDir, "absolute.config.yaml"),
      makeConfigYaml({
        targets: {
          claude: {
            enabled: true,
            skillsHome: absoluteClaudeSkillsHome,
            agentsHome: "./homes/claude/agents",
          },
          codex: {
            enabled: true,
            skillsHome: "./homes/codex/skills",
            agentsHome: "./homes/codex/agents",
          },
        },
      }),
      "utf8",
    );

    const relativeConfig = await loadConfig(
      path.join(configDir, "relative.config.yaml"),
    );
    const absoluteConfig = await loadConfig(
      path.join(configDir, "absolute.config.yaml"),
    );

    expect(absoluteConfig.targets.claude.skillsHome).toBe(
      relativeConfig.targets.claude.skillsHome,
    );
    expect(absoluteConfig.targets.claude.skillsHome).toBe(
      absoluteClaudeSkillsHome,
    );
  });

  it("keeps a tilde target home user-home based instead of rebasing it from the config directory", async () => {
    const configDir = path.join(tempDir, "project", "config");
    await mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "devcanon.config.yaml");
    await writeFile(
      configPath,
      makeConfigYaml({
        targets: {
          claude: {
            enabled: true,
            skillsHome: "./homes/claude/skills",
            agentsHome: "./homes/claude/agents",
          },
          codex: {
            enabled: true,
            skillsHome: "./homes/codex/skills",
            agentsHome: "~/codex-agents",
          },
        },
      }),
      "utf8",
    );

    const result = await loadConfig(configPath);

    expect(result.targets.codex.agentsHome).toBe(
      path.join(os.homedir(), "codex-agents"),
    );
    expect(result.targets.codex.agentsHome).not.toBe(
      path.join(configDir, "codex-agents"),
    );
  });

  it("warns about unknown top-level fields in non-strict mode but still returns config", async () => {
    const yaml = makeConfigYaml({ bogusField: "surprise" });
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result).toBeDefined();
    expect(result.configDir).toBeTruthy();
    expect(
      logCtx.testLogger.warnings.some((w) => w.includes("bogusField")),
    ).toBe(true);
  });

  it("throws UserError for unknown top-level field in strict mode", async () => {
    const yaml = makeConfigYaml({ bogusField: "surprise" });
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

  it.each([false, true])(
    "rejects version 1 with an actionable migration diagnostic (strict=%s)",
    async (strict) => {
      const yaml = "version: 1\n";
      const configPath = await createConfigFile(tempDir, yaml);

      await expect(loadConfig(configPath, strict)).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(UserError);
          expect((err as UserError).filePath).toBe(configPath);
          expect((err as UserError).message).toMatch(
            /version 1.*no longer supported/i,
          );
          expect((err as UserError).hint).toMatch(
            /version: 2.*capabilityProfiles/i,
          );
          return true;
        },
      );
      expect(logCtx.testLogger.warnings).toEqual([]);
    },
  );

  it.each([false, true])(
    "rejects version 2 modelTiers before ordinary/strict validation (strict=%s)",
    async (strict) => {
      const yaml = makeConfigYaml({
        modelTiers: {
          balanced: {
            claude: { model: "claude-sonnet-5" },
            codex: { model: "gpt-5.6-terra" },
          },
        },
      });
      const configPath = await createConfigFile(tempDir, yaml);

      await expect(loadConfig(configPath, strict)).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(UserError);
          expect((err as UserError).filePath).toBe(configPath);
          expect((err as UserError).message).toMatch(
            /modelTiers.*no longer supported/i,
          );
          expect((err as UserError).hint).toMatch(/capabilityProfiles/i);
          return true;
        },
      );
      expect(logCtx.testLogger.warnings).toEqual([]);
    },
  );

  it("parses YAML before applying version migration preflight", async () => {
    const yaml = "version: 1\n  invalid: indentation";
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("Invalid config YAML:");
      expect((err as UserError).message).not.toContain("no longer supported");
      return true;
    });
  });

  it("respects target-level installMode: copy overriding default symlink", async () => {
    const yaml = makeConfigYaml({
      targets: {
        claude: {
          enabled: true,
          skillsHome: "~/claude-skills",
          agentsHome: "~/claude-agents",
          installMode: "copy",
        },
        codex: {
          enabled: true,
          skillsHome: "~/codex-skills",
          agentsHome: "~/codex-agents",
        },
      },
    });
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result.defaults.installMode).toBe("symlink");
    expect(result.targets.claude.installMode).toBe("copy");
    expect(result.targets.codex.installMode).toBe("symlink");
  });

  it("loads the Codex display name suffix into resolved config", async () => {
    const yaml = makeConfigYaml({
      targets: {
        codex: {
          enabled: true,
          skillsHome: "~/codex-skills",
          agentsHome: "~/codex-agents",
          skillDisplayNameSuffix: "devcanon",
        },
      },
    });
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result.targets.codex.skillDisplayNameSuffix).toBe("devcanon");
  });

  it("warns about unknown target fields in non-strict mode", async () => {
    const yaml = makeConfigYaml({
      targets: {
        codex: {
          skillsHome: "~/codex-skills",
          agentsHome: "~/codex-agents",
          displayNameSufix: "typo",
        },
      },
    });
    const configPath = await createConfigFile(tempDir, yaml);
    const result = await loadConfig(configPath);

    expect(result.targets.codex.skillDisplayNameSuffix).toBeUndefined();
    expect(
      logCtx.testLogger.warnings.some((warning) =>
        warning.includes("targets.codex.displayNameSufix"),
      ),
    ).toBe(true);
  });

  it("rejects unknown target fields in strict mode", async () => {
    const yaml = makeConfigYaml({
      targets: {
        claude: {
          skillsHome: "~/claude-skills",
          agentsHome: "~/claude-agents",
          skillDisplayNameSuffix: "devcanon",
        },
        codex: {
          skillsHome: "~/codex-skills",
          agentsHome: "~/codex-agents",
          displayNameSufix: "typo",
        },
      },
    });
    const configPath = await createConfigFile(tempDir, yaml);

    await expect(loadConfig(configPath, true)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(UserError);
        expect((err as UserError).message).toContain(
          "targets.claude.skillDisplayNameSuffix",
        );
        expect((err as UserError).message).toContain(
          "targets.codex.displayNameSufix",
        );
        return true;
      },
    );
  });

  it.each([false, true])(
    "loads the exact model-only catalog (strict=%s)",
    async (strict) => {
      const configPath = await createConfigFile(tempDir, makeConfigYaml());
      const result = await loadConfig(configPath, strict);

      expect(result.capabilityProfiles).toEqual(CANONICAL_CAPABILITY_PROFILES);
    },
  );

  for (const strict of [false, true]) {
    it.each([
      {
        name: "a missing profile",
        value: {
          balanced: CANONICAL_CAPABILITY_PROFILES.balanced,
          frontier: CANONICAL_CAPABILITY_PROFILES.frontier,
        },
      },
      {
        name: "an extra profile",
        value: {
          ...CANONICAL_CAPABILITY_PROFILES,
          experimental: { claude: "claude-test", codex: "gpt-test" },
        },
      },
      {
        name: "a missing target",
        value: {
          ...CANONICAL_CAPABILITY_PROFILES,
          balanced: { claude: "claude-sonnet-5" },
        },
      },
      {
        name: "an extra target",
        value: {
          ...CANONICAL_CAPABILITY_PROFILES,
          balanced: {
            ...CANONICAL_CAPABILITY_PROFILES.balanced,
            other: "model",
          },
        },
      },
      {
        name: "a nested model object",
        value: {
          ...CANONICAL_CAPABILITY_PROFILES,
          balanced: {
            ...CANONICAL_CAPABILITY_PROFILES.balanced,
            claude: { model: "claude-sonnet-5" },
          },
        },
      },
      {
        name: "effort metadata",
        value: {
          ...CANONICAL_CAPABILITY_PROFILES,
          balanced: {
            ...CANONICAL_CAPABILITY_PROFILES.balanced,
            effort: "high",
          },
        },
      },
      {
        name: "a blank model string",
        value: {
          ...CANONICAL_CAPABILITY_PROFILES,
          balanced: {
            ...CANONICAL_CAPABILITY_PROFILES.balanced,
            claude: "   ",
          },
        },
      },
      {
        name: "an unsafe model string",
        value: {
          ...CANONICAL_CAPABILITY_PROFILES,
          frontier: {
            ...CANONICAL_CAPABILITY_PROFILES.frontier,
            codex: `gpt${String.fromCharCode(0x85)}injected`,
          },
        },
      },
    ])(`rejects $name when strict=${strict}`, async ({ value }) => {
      const configPath = await createConfigFile(
        tempDir,
        makeConfigYaml({ capabilityProfiles: value }),
      );

      await expect(loadConfig(configPath, strict)).rejects.toThrow(UserError);
      expect(logCtx.testLogger.warnings).toEqual([]);
    });
  }
});
