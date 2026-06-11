import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
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
import type { ResolvedConfig } from "../config/schema.js";
import { pathExists } from "../utils/fs.js";
import { sync } from "./sync.js";

const symlinkAvailable = await canCreateSymlinks();
const executableModeMutable = await canMutateExecutableMode();

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
    const packageJson = JSON.parse(
      await readFile(path.resolve("package.json"), "utf-8"),
    ) as { files?: string[] };

    expect(packageJson.files).toContain("skills/devcanon-runtime");
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

    const manifest = JSON.parse(
      await readFile(config.manifest.path, "utf-8"),
    ) as {
      records: Array<{
        name?: string;
        installedPath: string;
        contentHash: string;
        installMode: string;
      }>;
    };
    const runtimeRecord = manifest.records.find(
      (record) => record.installedPath === installedRuntime,
    );
    expect(runtimeRecord?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(runtimeRecord?.installMode).toBe("copy");
  });

  it.skipIf(!executableModeMutable)(
    "repairs copy-installed runtime files when executable metadata drifts",
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

      expect(secondResult.errors).toEqual([]);
      expect(secondResult.updated).toBeGreaterThan(0);
      expect((await stat(installedScript)).mode & 0o111).not.toBe(0);
    },
  );

  it.skipIf(!executableModeMutable)(
    "repairs copy-installed runtime files when executable metadata is removed",
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

      const secondResult = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "copy",
      });

      expect(secondResult.errors).toEqual([]);
      expect(secondResult.updated).toBeGreaterThan(0);
      expect((await stat(installedScript)).mode & 0o111).toBe(0);
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

  it.skipIf(!executableModeMutable)(
    "dry-run planning uses source executable metadata instead of stale generated previews",
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
      const dryRunResult = await sync(config, {
        dryRun: true,
        force: false,
        strict: false,
        mode: "copy",
      });

      expect(dryRunResult.errors).toEqual([]);
      expect(testLogger.infos).toContain(
        "  ~ [update] codex/skill/devcanon-runtime",
      );
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
        "devcanon-runtime",
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
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
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
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
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
      expect(path.dirname(installedRuntime)).toBe(
        path.dirname(
          path.join(config.targets.codex.skillsHome, "consumer-skill"),
        ),
      );
    },
  );
});
