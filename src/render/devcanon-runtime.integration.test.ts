import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canMutateExecutableMode,
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createSkillFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { ResolvedConfig } from "../config/schema.js";
import { pathExists } from "../utils/fs.js";
import { renderDevcanonRuntimeForTarget } from "./devcanon-runtime.js";
import { renderAll } from "./pipeline.js";

const executableModeMutable = await canMutateExecutableMode();

describe("devcanon-runtime rendering", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const installed = installTestLogger();
    restoreLogger = installed.restore;
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("renders the support runtime beside consumer skills as support files only", async () => {
    await copyDevcanonRuntimeFixture(config.library.skillsDir);
    await createSkillFixture(config.library.skillsDir, "consumer-skill");

    await renderAll(config, true);

    const claudeRuntimeDir = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "devcanon-runtime",
    );
    const codexRuntimeDir = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "devcanon-runtime",
    );
    const codexConsumerDir = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "consumer-skill",
    );

    expect(await pathExists(claudeRuntimeDir)).toBe(true);
    expect(await pathExists(codexRuntimeDir)).toBe(true);
    expect(await pathExists(codexConsumerDir)).toBe(true);
    expect(path.dirname(codexRuntimeDir)).toBe(path.dirname(codexConsumerDir));

    expect(await pathExists(path.join(claudeRuntimeDir, "SKILL.md"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(codexRuntimeDir, "agents", "openai.yaml")),
    ).toBe(false);
    const runtimeScriptPath = path.join(
      codexRuntimeDir,
      "scripts",
      "devcanon-runtime.sh",
    );
    expect(await pathExists(runtimeScriptPath)).toBe(true);
    expect(await readFile(runtimeScriptPath, "utf-8")).toContain(
      "resolve-entrypoint",
    );
    expect((await stat(runtimeScriptPath)).mode & 0o777).toBe(
      (
        await stat(
          path.join(
            config.library.skillsDir,
            "devcanon-runtime",
            "scripts",
            "devcanon-runtime.sh",
          ),
        )
      ).mode & 0o777,
    );

    for (const runtimeModule of [
      "pr-review-result-validation.js",
      "pr-review-manifests.js",
      "pr-review-leases.js",
    ]) {
      const source = await readFile(
        path.join(
          config.library.skillsDir,
          "devcanon-runtime",
          "scripts",
          "runtime",
          runtimeModule,
        ),
      );
      await expect(
        readFile(
          path.join(claudeRuntimeDir, "scripts", "runtime", runtimeModule),
        ),
      ).resolves.toStrictEqual(source);
      await expect(
        readFile(
          path.join(codexRuntimeDir, "scripts", "runtime", runtimeModule),
        ),
      ).resolves.toStrictEqual(source);
    }
  });

  it("includes runtime files in rendered content hashes", async () => {
    await copyDevcanonRuntimeFixture(config.library.skillsDir);

    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const firstRuntime = await renderDevcanonRuntimeForTarget(
      runtimeDir,
      "codex",
      config,
    );

    await writeFile(
      path.join(
        config.library.skillsDir,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
      "#!/usr/bin/env bash\nset -euo pipefail\necho changed\n",
      "utf-8",
    );

    const secondRuntime = await renderDevcanonRuntimeForTarget(
      runtimeDir,
      "codex",
      config,
    );
    expect(secondRuntime.contentHash).not.toBe(firstRuntime.contentHash);
  });

  it.skipIf(!executableModeMutable)(
    "includes the passive runtime scripts directory mode in rendered content hashes",
    async () => {
      await copyDevcanonRuntimeFixture(config.library.skillsDir);
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const scriptsPath = path.join(runtimeDir, "scripts");
      const before = await renderDevcanonRuntimeForTarget(
        runtimeDir,
        "codex",
        config,
      );

      await chmod(scriptsPath, 0o711);

      const after = await renderDevcanonRuntimeForTarget(
        runtimeDir,
        "codex",
        config,
      );
      expect(after.contentHash).not.toBe(before.contentHash);
    },
  );

  it("frames passive runtime records with their paths", async () => {
    await copyDevcanonRuntimeFixture(config.library.skillsDir);
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const firstPath = path.join(
      runtimeDir,
      "scripts",
      "runtime",
      "artifacts.js",
    );
    const secondPath = path.join(
      runtimeDir,
      "scripts",
      "runtime",
      "command.js",
    );
    const first = await renderDevcanonRuntimeForTarget(
      runtimeDir,
      "codex",
      config,
    );
    const [firstBytes, secondBytes] = await Promise.all([
      readFile(firstPath),
      readFile(secondPath),
    ]);
    await Promise.all([
      writeFile(firstPath, secondBytes),
      writeFile(secondPath, firstBytes),
    ]);

    const second = await renderDevcanonRuntimeForTarget(
      runtimeDir,
      "codex",
      config,
    );
    expect(second.contentHash).not.toBe(first.contentHash);
  });
});
