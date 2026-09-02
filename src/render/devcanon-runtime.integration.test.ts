import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import type { ResolvedConfig } from "../config/schema.js";
import { renderDevcanonRuntimeForTarget } from "./devcanon-runtime.js";
import { renderAll } from "./pipeline.js";

describe("devcanon-runtime rendering", () => {
  let tempDir: string;
  let config: ResolvedConfig;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await copyDevcanonRuntimeFixture(config.library.skillsDir);
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it("renders exactly the six-file runtime projection for each target", async () => {
    await renderAll(config, true);
    for (const target of ["claude", "codex"] as const) {
      const root = path.join(
        config.library.generatedDir,
        target,
        "skills",
        "devcanon-runtime",
      );
      await expect(readdir(root)).resolves.toEqual(["config", "scripts"]);
      await expect(readdir(path.join(root, "config"))).resolves.toEqual([
        "runtime-config.json",
      ]);
      await expect(readdir(path.join(root, "scripts"))).resolves.toEqual([
        "devcanon-runtime.sh",
        "resolve-bash.mjs",
        "runtime",
      ]);
      await expect(
        readdir(path.join(root, "scripts", "runtime")),
      ).resolves.toEqual([
        "THIRD_PARTY_LICENSES",
        "devcanon-runtime.mjs",
        "runtime-manifest.json",
      ]);
    }
  });

  it("uses target catalog projection rather than the protected source catalog", async () => {
    config.capabilityProfiles = {
      efficient: { claude: "claude-efficient", codex: "codex-efficient" },
      balanced: { claude: "claude-balanced", codex: "codex-updated" },
      frontier: { claude: "claude-frontier", codex: "codex-frontier" },
    };
    await renderAll(config, true);
    const sourceCatalog = path.join(
      config.library.skillsDir,
      "devcanon-runtime",
      "config",
      "runtime-config.json",
    );
    const sourceBefore = await readFile(sourceCatalog);
    await expect(
      readFile(
        path.join(
          config.library.generatedDir,
          "codex",
          "skills",
          "devcanon-runtime",
          "config",
          "runtime-config.json",
        ),
        "utf8",
      ),
    ).resolves.toContain("codex-updated");
    await expect(readFile(sourceCatalog)).resolves.toEqual(sourceBefore);
  });

  it("includes exact captured runtime bytes in the content hash", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const first = await renderDevcanonRuntimeForTarget(
      runtimeDir,
      "codex",
      config,
    );
    await writeFile(
      path.join(runtimeDir, "scripts", "runtime", "THIRD_PARTY_LICENSES"),
      "changed\n",
    );
    const second = await renderDevcanonRuntimeForTarget(
      runtimeDir,
      "codex",
      config,
    );
    expect(second.contentHash).not.toBe(first.contentHash);
  });
});
