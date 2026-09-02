import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  canMutateExecutableMode,
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createDevcanonRuntimeProviderFixture,
  createTempDir,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../../__test-helpers__/logger.js";
import { loadConfig } from "../../config/load.js";
import {
  AgentSourceSchema,
  ConfigSchema,
  type ResolvedConfig,
} from "../../config/schema.js";
import { sync } from "../../install/sync.js";
import { renderAll } from "../../render/pipeline.js";
import type { AcceptedProvider } from "../../runtime-build/provider.js";
import type { UserError } from "../../utils/errors.js";
import { pathExists, readTextFile } from "../../utils/fs.js";
import { validateBundledDevcanonRuntime } from "../../validate/devcanon-runtime.js";
import { initAction } from "./init.js";

const executableModeMutable = await canMutateExecutableMode();

describe("initAction", () => {
  let tempDir: string;
  let originalCwd: string;
  let testLogger: TestLoggerResult;
  let restoreLogger: () => void;
  let provider: AcceptedProvider;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    restoreLogger = installed.restore;
    provider = await createDevcanonRuntimeProviderFixture(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("seeds the packaged passive runtime bundle into fresh libraries", async () => {
    await initAction({}, provider);

    expect(
      await pathExists(
        path.join(tempDir, "skills", "devcanon-runtime", "SKILL.md"),
      ),
    ).toBe(false);
    await expect(
      readFile(
        path.join(
          tempDir,
          "skills",
          "devcanon-runtime",
          "config",
          "runtime-config.json",
        ),
        "utf-8",
      ),
    ).resolves.toContain('"schema": "devcanon/runtime-config/v1"');
    expect(
      await pathExists(
        path.join(
          tempDir,
          "skills",
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);
    expect(testLogger.infos).toContain(
      "Seeded support runtime: skills/devcanon-runtime/",
    );
  });

  it("composes a package-origin provider when packaged authored inputs have no derived subtree", async () => {
    const packageRuntime = path.join(tempDir, "package-runtime");
    await mkdir(path.join(packageRuntime, "config"), { recursive: true });
    await mkdir(path.join(packageRuntime, "scripts"), { recursive: true });
    await Promise.all([
      cp(
        path.join(
          originalCwd,
          "skills",
          "devcanon-runtime",
          "config",
          "runtime-config.json",
        ),
        path.join(packageRuntime, "config", "runtime-config.json"),
      ),
      cp(
        path.join(
          originalCwd,
          "skills",
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
        path.join(packageRuntime, "scripts", "devcanon-runtime.sh"),
      ),
      cp(
        path.join(
          originalCwd,
          "skills",
          "devcanon-runtime",
          "scripts",
          "resolve-bash.mjs",
        ),
        path.join(packageRuntime, "scripts", "resolve-bash.mjs"),
      ),
    ]);

    const provider = await createDevcanonRuntimeProviderFixture(tempDir);
    await expect(
      validateBundledDevcanonRuntime(packageRuntime, {
        adapterSourceDir: packageRuntime,
        provider,
      }),
    ).resolves.toBeUndefined();
    await initAction({ runtimeSourceDir: packageRuntime }, provider);

    expect(
      await readdir(
        path.join(tempDir, "skills", "devcanon-runtime", "scripts", "runtime"),
      ),
    ).toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
  });

  it("emits the exact version 2 capability profile catalog", async () => {
    await initAction({}, provider);

    const raw = await readTextFile(path.join(tempDir, "devcanon.config.yaml"));
    const config = ConfigSchema.parse(parseYaml(raw));

    expect(config.version).toBe(2);
    expect(config.capabilityProfiles).toEqual({
      efficient: {
        claude: "claude-haiku-4-5-20251001",
        codex: "gpt-5.6-luna",
      },
      balanced: {
        claude: "claude-sonnet-5",
        codex: "gpt-5.6-terra",
      },
      frontier: {
        claude: "claude-opus-4-8",
        codex: "gpt-5.6-sol",
      },
    });
  });

  it("emits a balanced sample agent without target model or effort fields", async () => {
    await initAction({}, provider);

    const raw = await readTextFile(
      path.join(tempDir, "agents", "example-agent.yaml"),
    );
    const agent = AgentSourceSchema.parse(parseYaml(raw));

    expect(agent.capability).toBe("balanced");
    expect(agent.claude).toEqual({ tools: ["Read", "Grep"] });
    expect(agent.codex).toEqual({ sandbox_mode: "read-only" });
  });

  it("checks config collision before runtime preflight", async () => {
    const configPath = path.join(tempDir, "devcanon.config.yaml");
    await writeFile(configPath, "existing config\n", "utf-8");

    await expect(
      initAction({ runtimeSourceDir: path.join(tempDir, "missing-runtime") }),
    ).rejects.toMatchObject({
      message: "devcanon.config.yaml already exists in this directory.",
      filePath: expect.stringMatching(/devcanon\.config\.yaml$/u),
    } satisfies Partial<UserError>);
    expect(await readFile(configPath, "utf-8")).toBe("existing config\n");
  });

  it("preserves partial scaffold state after a post-config write failure", async () => {
    const blockedSamplePath = path.join(
      tempDir,
      "skills",
      "example-skill",
      "SKILL.md",
    );
    await mkdir(blockedSamplePath, { recursive: true });

    await expect(initAction({}, provider)).rejects.toThrow();

    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      true,
    );
    expect(await pathExists(blockedSamplePath)).toBe(true);
    expect(
      await pathExists(path.join(tempDir, "agents", "example-agent.yaml")),
    ).toBe(false);
  });

  it("preserves an existing matching passive runtime bundle path", async () => {
    const fixtureSkillsDir = path.join(tempDir, ".fixture-package", "skills");
    await copyDevcanonRuntimeFixture(fixtureSkillsDir);
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await cp(
      path.join(fixtureSkillsDir, "devcanon-runtime"),
      path.join(tempDir, "skills", "devcanon-runtime"),
      { recursive: true },
    );

    await initAction(
      {
        runtimeSourceDir: path.join(fixtureSkillsDir, "devcanon-runtime"),
      },
      provider,
    );

    expect(testLogger.infos).toContain(
      "Support runtime already present: skills/devcanon-runtime/",
    );
  });

  it("fails with repair guidance rather than overwriting a modified passive runtime bundle", async () => {
    const customRuntimeSkill = path.join(tempDir, "skills", "devcanon-runtime");
    await mkdir(customRuntimeSkill, { recursive: true });
    await writeFile(
      path.join(customRuntimeSkill, "SKILL.md"),
      "custom runtime marker\n",
      "utf-8",
    );

    await expect(initAction({}, provider)).rejects.toMatchObject({
      message:
        "Existing skills/devcanon-runtime/ does not match the bundled support runtime.",
      filePath: expect.stringMatching(/skills[/\\]devcanon-runtime$/u),
    } satisfies Partial<UserError>);

    expect(
      await readFile(path.join(customRuntimeSkill, "SKILL.md"), "utf-8"),
    ).toBe("custom runtime marker\n");
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it.skipIf(!executableModeMutable)(
    "fails with repair guidance rather than preserving a non-executable runtime entrypoint",
    async () => {
      const runtimeSkill = path.join(tempDir, "skills", "devcanon-runtime");
      const runtimeEntrypoint = path.join(
        runtimeSkill,
        "scripts",
        "devcanon-runtime.sh",
      );
      await copyBundledRuntimeTo(
        path.join(originalCwd, "skills", "devcanon-runtime"),
        runtimeSkill,
      );
      await chmod(runtimeEntrypoint, 0o644);

      await expect(initAction({}, provider)).rejects.toMatchObject({
        message:
          "Existing skills/devcanon-runtime/ does not match the bundled support runtime.",
        filePath: expect.stringMatching(/skills[/\\]devcanon-runtime$/u),
      } satisfies Partial<UserError>);

      expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
        false,
      );
    },
  );

  it("renders the seeded runtime without treating it as an installable skill", async () => {
    await initAction({}, provider);

    const config = withTemporaryInstallHomes(
      await loadConfig(path.join(tempDir, "devcanon.config.yaml")),
      tempDir,
    );

    const renderResult = await renderAll(config, false);
    expect(
      renderResult.outputs
        .filter(
          (output) =>
            output.type === "skill" && output.name === "devcanon-runtime",
        )
        .map((output) => output.target)
        .sort(),
    ).toEqual(["claude", "codex"]);

    const syncResult = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });

    expect(syncResult.errors).toEqual([]);
    expect(
      await pathExists(
        path.join(
          config.library.generatedDir,
          "codex",
          "skills",
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);
  });

  it("preflights bundled runtime availability before writing init files", async () => {
    const missingRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );

    await expect(
      initAction({ runtimeSourceDir: missingRuntimeDir }),
    ).rejects.toMatchObject({
      message:
        "Fixed passive runtime support bundle devcanon-runtime is missing.",
      filePath: missingRuntimeDir,
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, "skills"))).toBe(false);
  });

  it("preflights incomplete bundled runtime contents before writing init files", async () => {
    const incompleteRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await mkdir(incompleteRuntimeDir, { recursive: true });

    await expect(
      initAction({ runtimeSourceDir: incompleteRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Passive runtime adapter pair is missing.",
      filePath: path.join(incompleteRuntimeDir, "scripts"),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it("preflights broken bundled runtime payload before writing init files", async () => {
    const brokenRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await copyDevcanonRuntimeFixture(path.dirname(brokenRuntimeDir));
    await writeFile(
      path.join(brokenRuntimeDir, "scripts", "runtime", "devcanon-runtime.mjs"),
      [
        'if (process.argv[2] === "runtime" && process.argv[3] === "resolve-bash") process.stdout.write("/bin/bash\\n");',
        'else if (process.argv[2] === "runtime" && process.argv[3] === "contract") process.stdout.write("{}\\n");',
        "",
      ].join("\n"),
      "utf-8",
    );

    await expect(
      validateBundledDevcanonRuntime(brokenRuntimeDir, {
        adapterSourceDir: brokenRuntimeDir,
      }),
    ).rejects.toMatchObject({
      message:
        "Fixed passive runtime support bundle devcanon-runtime contract check failed.",
      filePath: path.join(
        brokenRuntimeDir,
        "scripts",
        "runtime",
        "devcanon-runtime.mjs",
      ),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it("rejects a garbage but executable bundled shell adapter before writing init files", async () => {
    const brokenRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await copyBundledRuntimeTo(
      path.join(originalCwd, "skills", "devcanon-runtime"),
      brokenRuntimeDir,
    );
    await writeFile(
      path.join(brokenRuntimeDir, "scripts", "devcanon-runtime.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "printf '%s\\n' not-json",
        "",
      ].join("\n"),
      "utf-8",
    );

    await expect(
      initAction({ runtimeSourceDir: brokenRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Passive runtime adapter pair is mixed.",
      filePath: path.join(brokenRuntimeDir, "scripts"),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it("rejects an unusable but executable bundled shell adapter before writing init files", async () => {
    const brokenRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await copyBundledRuntimeTo(
      path.join(originalCwd, "skills", "devcanon-runtime"),
      brokenRuntimeDir,
    );
    await writeFile(
      path.join(brokenRuntimeDir, "scripts", "devcanon-runtime.sh"),
      [
        "#!/devcanon/missing/bash",
        'printf \'%s\\n\' \'{"command_group":"devcanon-runtime","major_version":1}\'',
        "",
      ].join("\n"),
      "utf-8",
    );

    await expect(
      initAction({ runtimeSourceDir: brokenRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Passive runtime adapter pair is mixed.",
      filePath: path.join(brokenRuntimeDir, "scripts"),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });
});

async function copyBundledRuntimeTo(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
  });
}

function withTemporaryInstallHomes(
  config: ResolvedConfig,
  tempDir: string,
): ResolvedConfig {
  return {
    ...config,
    defaults: {
      ...config.defaults,
      installMode: "copy",
    },
    manifest: {
      ...config.manifest,
      path: path.join(tempDir, "home", "devcanon", "manifest.json"),
    },
    targets: {
      claude: {
        ...config.targets.claude,
        skillsHome: path.join(tempDir, "home", "claude", "skills"),
        agentsHome: path.join(tempDir, "home", "claude", "agents"),
        installMode: "copy",
      },
      codex: {
        ...config.targets.codex,
        skillsHome: path.join(tempDir, "home", "codex", "skills"),
        agentsHome: path.join(tempDir, "home", "codex", "agents"),
        installMode: "copy",
      },
    },
  };
}
