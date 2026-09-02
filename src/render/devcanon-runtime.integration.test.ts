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
import { ImmutableProviderBytes } from "../runtime-build/provider.js";
import { validateDevcanonRuntime } from "../validate/devcanon-runtime.js";
import { renderDevcanonRuntimeForTarget } from "./devcanon-runtime.js";
import { reconcileDevcanonRuntimeSource } from "./devcanon-runtime.js";
import { writeRenderedDevcanonRuntime } from "./devcanon-runtime.js";
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

  it("writes the validated provider snapshot even when source leaves change afterward", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const authority = path.resolve("skills/devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: authority,
    });
    const original = validated.providerLeaves.get("THIRD_PARTY_LICENSES");
    await writeFile(
      path.join(runtimeDir, "scripts", "runtime", "THIRD_PARTY_LICENSES"),
      "changed after validation\n",
    );
    const target = path.join(tempDir, "rendered-runtime");

    await writeRenderedDevcanonRuntime(runtimeDir, target, config, validated);

    await expect(
      readFile(path.join(target, "scripts", "runtime", "THIRD_PARTY_LICENSES")),
    ).resolves.toEqual(original);
  });

  it("stages a launchable pair and subtree without replacing unrelated scripts", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = {
      origin: "source-build",
      root: runtime,
      manifest: JSON.parse(
        (
          await readFile(path.join(runtime, "runtime-manifest.json"))
        ).toString(),
      ),
      bundle: new ImmutableProviderBytes(
        requiredProviderLeaf(validated, "devcanon-runtime.mjs"),
      ),
      manifestBytes: new ImmutableProviderBytes(
        requiredProviderLeaf(validated, "runtime-manifest.json"),
      ),
      licenses: new ImmutableProviderBytes(
        requiredProviderLeaf(validated, "THIRD_PARTY_LICENSES"),
      ),
    } as const;
    const unrelated = path.join(runtimeDir, "scripts", "unrelated.sh");
    await writeFile(unrelated, "keep\n");

    await reconcileDevcanonRuntimeSource(
      runtimeDir,
      provider,
      validated.adapterPair,
    );

    await expect(readFile(unrelated, "utf8")).resolves.toBe("keep\n");
    await expect(
      readdir(path.join(runtimeDir, "scripts", "runtime")),
    ).resolves.toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
  });

  it("rejects an unlaunchable staged adapter before publication", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = {
      origin: "source-build",
      root: runtime,
      manifest: JSON.parse(
        (
          await readFile(path.join(runtime, "runtime-manifest.json"))
        ).toString(),
      ),
      bundle: new ImmutableProviderBytes(
        requiredProviderLeaf(validated, "devcanon-runtime.mjs"),
      ),
      manifestBytes: new ImmutableProviderBytes(
        requiredProviderLeaf(validated, "runtime-manifest.json"),
      ),
      licenses: new ImmutableProviderBytes(
        requiredProviderLeaf(validated, "THIRD_PARTY_LICENSES"),
      ),
    } as const;
    const before = await readFile(
      path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
    );

    await expect(
      reconcileDevcanonRuntimeSource(runtimeDir, provider, {
        shell: Buffer.from("#!/usr/bin/env bash\nexit 0\n"),
        resolver: validated.adapterPair.resolver,
      }),
    ).rejects.toThrow(/staged runtime contract|unexpected end of JSON/i);
    await expect(
      readFile(path.join(runtimeDir, "scripts", "devcanon-runtime.sh")),
    ).resolves.toEqual(before);
  });
});

function requiredProviderLeaf(
  validated: Awaited<ReturnType<typeof validateDevcanonRuntime>>,
  leaf: string,
): Buffer {
  const bytes = validated.providerLeaves.get(leaf);
  if (bytes === undefined)
    throw new Error(`missing provider test leaf: ${leaf}`);
  return bytes;
}
