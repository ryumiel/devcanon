import { chmod, cp, lstat, mkdir, readFile, stat } from "node:fs/promises";
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
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const installed = installTestLogger();
    restoreLogger = installed.restore;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
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
