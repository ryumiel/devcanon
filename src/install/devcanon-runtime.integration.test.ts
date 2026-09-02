import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  canMutateExecutableMode,
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../__test-helpers__/logger.js";
import type { InstallMode, ResolvedConfig } from "../config/schema.js";
import { pathExists } from "../utils/fs.js";
import { sync } from "./sync.js";
import { uninstall } from "./uninstall.js";

const symlinkAvailable = await canCreateSymlinks();
const executableModeMutable = await canMutateExecutableMode();
const execFileAsync = promisify(execFile);

async function copyRuntimeFixture(skillsDir: string): Promise<void> {
  await cp(
    path.resolve("skills/devcanon-runtime"),
    path.join(skillsDir, "devcanon-runtime"),
    { recursive: true },
  );
}

async function prepareRuntimeSyncFixture(
  config: ResolvedConfig,
): Promise<void> {
  await mkdir(config.library.skillsDir, { recursive: true });
  await mkdir(config.library.agentsDir, { recursive: true });
  await copyRuntimeFixture(config.library.skillsDir);
  await createSkillFixture(config.library.skillsDir, "consumer-skill");
}

describe("devcanon-runtime sync", () => {
  let tempDir: string;
  let testLogger: TestLoggerResult;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    restoreLogger = installed.restore;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("publishes the support runtime skill with packaged installs", async () => {
    await execFileAsync("pnpm", ["run", "prepack"], { cwd: process.cwd() });
    const packed = JSON.parse(
      (
        await execFileAsync("npm", ["pack", "--json", "--ignore-scripts"], {
          cwd: process.cwd(),
        })
      ).stdout,
    ) as {
      devcanon: { filename: string; files: Array<{ path: string }> };
    };
    const archivePath = path.resolve(packed.devcanon.filename);
    try {
      const packedPaths = packed.devcanon.files.map((file) => file.path);
      expect(
        packedPaths.filter(
          (packedPath) =>
            packedPath.startsWith("dist/devcanon-runtime/") ||
            packedPath.startsWith("skills/devcanon-runtime/"),
        ),
      ).toEqual([
        "dist/devcanon-runtime/package/devcanon-runtime.mjs",
        "dist/devcanon-runtime/package/runtime-manifest.json",
        "dist/devcanon-runtime/package/THIRD_PARTY_LICENSES",
        "skills/devcanon-runtime/config/runtime-config.json",
        "skills/devcanon-runtime/scripts/devcanon-runtime.sh",
        "skills/devcanon-runtime/scripts/resolve-bash.mjs",
      ]);
      expect(packedPaths).toEqual(
        expect.not.arrayContaining([
          "dist/cli/source.js",
          "dist/devcanon-runtime/source-build/devcanon-runtime.mjs",
          "dist/runtime-build/producer.js",
          "skills/devcanon-runtime/scripts/runtime/devcanon-runtime.mjs",
        ]),
      );
    } finally {
      await rm(archivePath, { force: true });
    }
  });

  it("installs runtime files in copy mode and records the runtime manifest hash", async () => {
    const config = makeResolvedConfig(tempDir);
    await prepareRuntimeSyncFixture(config);

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });

    expect(result.errors).toEqual([]);
    const installedRuntime = path.join(
      config.targets.codex.skillsHome,
      "devcanon-runtime",
    );
    expect(
      await pathExists(
        path.join(installedRuntime, "scripts", "devcanon-runtime.sh"),
      ),
    ).toBe(true);
    await expect(
      readFile(
        path.join(installedRuntime, "config", "runtime-config.json"),
        "utf-8",
      ),
    ).resolves.toContain('"schema": "devcanon/runtime-config/v1"');
    expect(await readdir(installedRuntime)).toEqual(["config", "scripts"]);
    expect(await readdir(path.join(installedRuntime, "config"))).toEqual([
      "runtime-config.json",
    ]);
    expect(await readdir(path.join(installedRuntime, "scripts"))).toEqual([
      "devcanon-runtime.sh",
      "resolve-bash.mjs",
      "runtime",
    ]);
    expect(
      await readdir(path.join(installedRuntime, "scripts", "runtime")),
    ).toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);

    const manifest = JSON.parse(
      await readFile(config.manifest.path, "utf-8"),
    ) as {
      records: Array<{
        name?: string;
        installedPath: string;
        contentHash: string;
        installMode: string;
        sourcePath: string;
      }>;
    };
    const runtimeRecord = manifest.records.find(
      (record) => record.installedPath === installedRuntime,
    );
    expect(runtimeRecord?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(runtimeRecord?.installMode).toBe("copy");
    expect(runtimeRecord?.sourcePath).toBe(
      path.join(config.library.skillsDir, "devcanon-runtime"),
    );
  });

  it.skipIf(!executableModeMutable)(
    "refuses an update when a copy-installed runtime executable mode drifts",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await prepareRuntimeSyncFixture(config);

      const firstResult = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "copy",
      });
      expect(firstResult.errors).toEqual([]);

      const installedScript = path.join(
        config.targets.codex.skillsHome,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      );
      const generatedScript = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      );
      expect((await stat(generatedScript)).mode & 0o111).not.toBe(0);

      await chmod(installedScript, 0o644);
      expect((await stat(installedScript)).mode & 0o111).toBe(0);

      const secondResult = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "copy",
      });

      expect(secondResult.errors).toEqual([
        expect.stringContaining(
          "Passive runtime adapter pair is posix-mode-invalid",
        ),
      ]);
      expect(secondResult.updated).toBe(0);
      expect((await stat(installedScript)).mode & 0o111).toBe(0);
    },
  );

  it.skipIf(!executableModeMutable)(
    "blocks sync before mutation when the source runtime executable mode is removed",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await prepareRuntimeSyncFixture(config);

      const firstResult = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "copy",
      });
      expect(firstResult.errors).toEqual([]);

      const sourceScript = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      );
      const installedScript = path.join(
        config.targets.codex.skillsHome,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      );
      expect((await stat(installedScript)).mode & 0o111).not.toBe(0);

      await chmod(sourceScript, 0o644);
      expect((await stat(sourceScript)).mode & 0o111).toBe(0);

      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          mode: "copy",
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "Passive runtime adapter pair is posix-mode-invalid",
        ),
      });
      expect((await stat(installedScript)).mode & 0o111).not.toBe(0);
    },
  );

  it("dry-run planning does not require generated preview directories", async () => {
    const config = makeResolvedConfig(tempDir);
    await prepareRuntimeSyncFixture(config);

    const firstResult = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });
    expect(firstResult.errors).toEqual([]);

    await rm(config.library.generatedDir, { recursive: true, force: true });
    expect(await pathExists(config.library.generatedDir)).toBe(false);

    const dryRunResult = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      mode: "copy",
    });

    expect(dryRunResult.errors).toEqual([]);
  });

  it("refuses a manifest-owned copy when a prompt-bearing SKILL.md is added", async () => {
    const config = makeResolvedConfig(tempDir);
    await prepareRuntimeSyncFixture(config);

    await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });
    const installedRuntime = path.join(
      config.targets.codex.skillsHome,
      "devcanon-runtime",
    );
    const promptPath = path.join(installedRuntime, "SKILL.md");
    await writeFile(promptPath, "---\nname: devcanon-runtime\n---\n", "utf-8");

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });

    expect(result.errors).toEqual([
      expect.stringContaining("must not contain SKILL.md"),
    ]);
    expect(await readFile(promptPath, "utf-8")).toContain("name:");
  });

  it.skipIf(!executableModeMutable)(
    "blocks dry-run planning when source runtime executable metadata is invalid",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await prepareRuntimeSyncFixture(config);

      const firstResult = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "copy",
      });
      expect(firstResult.errors).toEqual([]);

      const sourceScript = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      );
      const generatedScript = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      );
      const installedScript = path.join(
        config.targets.codex.skillsHome,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      );
      expect((await stat(generatedScript)).mode & 0o111).not.toBe(0);
      expect((await stat(installedScript)).mode & 0o111).not.toBe(0);

      await chmod(sourceScript, 0o644);
      expect((await stat(sourceScript)).mode & 0o111).toBe(0);
      expect((await stat(generatedScript)).mode & 0o111).not.toBe(0);

      testLogger.infos.length = 0;
      await expect(
        sync(config, {
          dryRun: true,
          force: false,
          strict: false,
          mode: "copy",
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "Passive runtime adapter pair is posix-mode-invalid",
        ),
      });
      expect(testLogger.infos).toEqual([]);
    },
  );

  it.skipIf(!executableModeMutable)(
    "ignores executable source files outside mirrored skill subdirectories",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await prepareRuntimeSyncFixture(config);

      const firstResult = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "copy",
      });
      expect(firstResult.errors).toEqual([]);

      const strayExecutable = path.join(
        config.library.skillsDir,
        "consumer-skill",
        "local-helper.sh",
      );
      await writeFile(strayExecutable, "#!/bin/sh\n", "utf-8");
      await chmod(strayExecutable, 0o755);

      testLogger.infos.length = 0;
      const dryRunResult = await sync(config, {
        dryRun: true,
        force: false,
        strict: false,
        mode: "copy",
      });

      expect(dryRunResult.errors).toEqual([]);
      expect(testLogger.infos).toContain(
        "  = [skip-up-to-date] codex/skill/devcanon-runtime",
      );
      expect(testLogger.infos).not.toContain(
        "  ~ [update] codex/skill/devcanon-runtime",
      );
    },
  );

  it("ignores regular files using mirrored skill subdirectory names", async () => {
    const config = makeResolvedConfig(tempDir);
    await prepareRuntimeSyncFixture(config);
    await createSkillFixture(config.library.skillsDir, "file-named-scripts");
    await writeFile(
      path.join(config.library.skillsDir, "file-named-scripts", "scripts"),
      "not a directory\n",
      "utf-8",
    );

    const firstResult = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });
    expect(firstResult.errors).toEqual([]);

    testLogger.infos.length = 0;
    const dryRunResult = await sync(config, {
      dryRun: true,
      force: false,
      strict: false,
      mode: "copy",
    });

    expect(dryRunResult.errors).toEqual([]);
    expect(testLogger.infos).toContain(
      "  = [skip-up-to-date] codex/skill/file-named-scripts",
    );
    expect(testLogger.infos).not.toContain(
      "  ~ [update] codex/skill/file-named-scripts",
    );
  });

  it.skipIf(!symlinkAvailable)(
    "ignores symlinked directories using mirrored skill subdirectory names",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await prepareRuntimeSyncFixture(config);
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "symlinked-scripts",
      );
      const externalScripts = path.join(tempDir, "external-scripts");
      await mkdir(externalScripts, { recursive: true });
      await writeFile(
        path.join(externalScripts, "helper.sh"),
        "#!/bin/sh\n",
        "utf-8",
      );
      await symlink(externalScripts, path.join(skillDir, "scripts"));

      const firstResult = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "copy",
      });
      expect(firstResult.errors).toEqual([]);

      testLogger.infos.length = 0;
      const dryRunResult = await sync(config, {
        dryRun: true,
        force: false,
        strict: false,
        mode: "copy",
      });

      expect(dryRunResult.errors).toEqual([]);
      expect(testLogger.infos).toContain(
        "  = [skip-up-to-date] codex/skill/symlinked-scripts",
      );
      expect(testLogger.infos).not.toContain(
        "  ~ [update] codex/skill/symlinked-scripts",
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "installs the runtime as a sibling skill symlink in symlink mode",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { installMode: "symlink" },
        defaults: { installMode: "symlink" },
      });
      await prepareRuntimeSyncFixture(config);

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "symlink",
      });

      expect(result.errors).toEqual([]);
      const installedRuntime = path.join(
        config.targets.codex.skillsHome,
        "devcanon-runtime",
      );
      expect((await lstat(installedRuntime)).isSymbolicLink()).toBe(true);
      expect(
        await pathExists(
          path.join(installedRuntime, "scripts", "devcanon-runtime.sh"),
        ),
      ).toBe(true);
      await expect(
        readFile(
          path.join(installedRuntime, "config", "runtime-config.json"),
          "utf-8",
        ),
      ).resolves.toContain('"schema": "devcanon/runtime-config/v1"');
      await expect(
        sync(config, {
          dryRun: false,
          force: false,
          strict: false,
          mode: "symlink",
        }),
      ).resolves.toMatchObject({ errors: [] });
      expect(path.dirname(installedRuntime)).toBe(
        path.dirname(
          path.join(config.targets.codex.skillsHome, "consumer-skill"),
        ),
      );
    },
  );

  it.each(["copy", ...(symlinkAvailable ? ["symlink"] : [])] as InstallMode[])(
    "uninstalls a source-absent runtime in %s mode",
    async (mode) => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: mode },
        codex: { installMode: mode },
        defaults: { installMode: mode },
      });
      await prepareRuntimeSyncFixture(config);
      await sync(config, { dryRun: false, force: false, strict: false, mode });

      const installedRuntime = path.join(
        config.targets.codex.skillsHome,
        "devcanon-runtime",
      );
      await expect(
        readFile(
          path.join(installedRuntime, "config", "runtime-config.json"),
          "utf-8",
        ),
      ).resolves.toContain('"schema": "devcanon/runtime-config/v1"');
      await rm(path.join(config.library.skillsDir, "devcanon-runtime"), {
        recursive: true,
        force: true,
      });

      const result = await uninstall(config, {
        target: "codex",
        dryRun: false,
      });

      expect(result.errors).toEqual([]);
      expect(await pathExists(installedRuntime)).toBe(false);
    },
  );
});
