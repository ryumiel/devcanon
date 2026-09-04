import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
  linkDevcanonRuntimeFixture,
  makeResolvedConfig,
  providerFromRuntimeFixture,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { ResolvedConfig } from "../config/schema.js";
import { sync as syncWithProvider } from "../install/sync.js";
import { diffAll as diffAllWithProvider } from "./diff.js";

const symlinkAvailable = await canCreateSymlinks();

describe("devcanon-runtime diff", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restoreLogger: () => void;
  let provider: Awaited<ReturnType<typeof providerFromRuntimeFixture>>;

  const sync = (
    syncedConfig: ResolvedConfig,
    options: Parameters<typeof syncWithProvider>[1],
  ) => syncWithProvider(syncedConfig, options, provider);
  const diffAll = (
    comparedConfig: ResolvedConfig,
    targetFilter: "claude" | "codex" | undefined = undefined,
    strict = false,
  ) => diffAllWithProvider(comparedConfig, targetFilter, strict, provider);

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const { restore } = installTestLogger();
    restoreLogger = restore;
    await mkdir(config.library.skillsDir, { recursive: true });
    await linkDevcanonRuntimeFixture(config.library.skillsDir);
    provider = await providerFromRuntimeFixture(
      path.join(config.library.skillsDir, "devcanon-runtime"),
    );
    await mkdir(config.library.agentsDir, { recursive: true });
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("reports a drifted installed runtime catalog as changed", async () => {
    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });
    expect(result.errors).toEqual([]);
    const installedCatalog = path.join(
      config.targets.codex.skillsHome,
      "devcanon-runtime",
      "config",
      "runtime-config.json",
    );
    await writeFile(
      installedCatalog,
      '{"schema":"devcanon/runtime-config/v1","capabilityProfiles":{"efficient":{"claude":"a","codex":"b"},"balanced":{"claude":"c","codex":"d"},"frontier":{"claude":"e","codex":"f"}}}\n',
      "utf-8",
    );

    const results = await diffAll(config, "codex");
    expect(
      results.find(
        (entry) =>
          entry.target === "codex" && entry.name === "devcanon-runtime",
      ),
    ).toMatchObject({
      status: "changed",
      diff: "Runtime support bundle content has changed.",
    });
  });

  it.skipIf(!symlinkAvailable)(
    "reports a drifted symlink-installed runtime catalog as changed",
    async () => {
      const symlinkConfig = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { installMode: "symlink" },
        defaults: { installMode: "symlink" },
      });
      const result = await sync(symlinkConfig, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "symlink",
      });
      expect(result.errors).toEqual([]);
      await writeFile(
        path.join(
          symlinkConfig.targets.codex.skillsHome,
          "devcanon-runtime",
          "config",
          "runtime-config.json",
        ),
        '{"schema":"devcanon/runtime-config/v1","capabilityProfiles":{"efficient":{"claude":"a","codex":"b"},"balanced":{"claude":"c","codex":"d"},"frontier":{"claude":"e","codex":"f"}}}\n',
        "utf-8",
      );

      const results = await diffAll(symlinkConfig, "codex");
      expect(
        results.find(
          (entry) =>
            entry.target === "codex" && entry.name === "devcanon-runtime",
        ),
      ).toMatchObject({ status: "changed" });
    },
  );
});
