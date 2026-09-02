import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
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
import {
  hashDevcanonRuntimePayload,
  renderDevcanonRuntimeForTarget,
} from "./devcanon-runtime.js";
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

  it("renders current authoritative adapters from a pristine legacy compose state", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const legacy = {
      shell: await readFile(
        path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
      ),
      resolver: await readFile(
        path.join(runtimeDir, "scripts", "resolve-bash.mjs"),
      ),
      shellMode: 0o755,
      resolverMode: 0o644,
    };
    const authority = path.join(tempDir, "current-authority");
    await mkdir(path.join(authority, "scripts"), { recursive: true });
    const currentShell = Buffer.from(
      '#!/usr/bin/env bash\nnode "$(cd -- "$(dirname -- "$0")" && pwd)/runtime/devcanon-runtime.mjs" "$@"\n',
    );
    const currentResolver = Buffer.from("console.log('/bin/bash');\n");
    await writeFile(
      path.join(authority, "scripts", "devcanon-runtime.sh"),
      currentShell,
    );
    await chmod(path.join(authority, "scripts", "devcanon-runtime.sh"), 0o755);
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      currentResolver,
    );
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: authority,
      pristineLegacyPair: legacy,
      operation: "compose",
    });
    const target = path.join(tempDir, "legacy-rendered-runtime");

    await writeRenderedDevcanonRuntime(runtimeDir, target, config, validated);

    expect(validated.adapterState).toBe("pristine-legacy");
    await expect(
      readFile(path.join(target, "scripts", "devcanon-runtime.sh")),
    ).resolves.toEqual(currentShell);
    await expect(
      readFile(path.join(target, "scripts", "resolve-bash.mjs")),
    ).resolves.toEqual(currentResolver);
  });

  it("publishes the exact adapter bytes and modes captured for its content hash", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const hashBeforeMutation = await hashDevcanonRuntimePayload(
      runtimeDir,
      config,
      validated,
    );
    const shell = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
    const resolver = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
    await writeFile(shell, "#!/usr/bin/env bash\nexit 99\n");
    await writeFile(resolver, "throw new Error('changed');\n");
    if (process.platform !== "win32") await chmod(shell, 0o700);
    const target = path.join(tempDir, "snapshot-runtime");

    await writeRenderedDevcanonRuntime(runtimeDir, target, config, validated);

    expect(
      await hashDevcanonRuntimePayload(runtimeDir, config, validated),
    ).toBe(hashBeforeMutation);
    await expect(
      readFile(path.join(target, "scripts", "devcanon-runtime.sh")),
    ).resolves.toEqual(validated.adapterPair.shell);
    await expect(
      readFile(path.join(target, "scripts", "resolve-bash.mjs")),
    ).resolves.toEqual(validated.adapterPair.resolver);
    if (process.platform !== "win32") {
      await expect(
        stat(path.join(target, "scripts", "devcanon-runtime.sh")),
      ).resolves.toMatchObject({
        mode: expect.any(Number),
      });
      expect(
        (await stat(path.join(target, "scripts", "devcanon-runtime.sh"))).mode &
          0o777,
      ).toBe(validated.adapterPair.shellMode);
      expect(
        (await stat(path.join(target, "scripts", "resolve-bash.mjs"))).mode &
          0o777,
      ).toBe(validated.adapterPair.resolverMode);
    }
  });

  it("defensively copies snapshot inputs before hashing and publication", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const expectedShell = Buffer.from(validated.adapterPair.shell);
    const expectedProvider = Buffer.from(
      validated.providerLeaves.get("THIRD_PARTY_LICENSES") ?? [],
    );
    const hashBeforeMutation = await hashDevcanonRuntimePayload(
      runtimeDir,
      config,
      validated,
    );

    const exposedPair = validated.adapterPair;
    exposedPair.shell.fill(0);
    expect(validated.authoritativeAdapterPair.shell).toEqual(expectedShell);
    validated.authoritativeAdapterPair.resolver.fill(0);
    const exposedLeaves = validated.providerLeaves as Map<string, Buffer>;
    exposedLeaves.get("THIRD_PARTY_LICENSES")?.fill(0);
    exposedLeaves.clear();
    const target = path.join(tempDir, "immutable-snapshot-runtime");

    await writeRenderedDevcanonRuntime(runtimeDir, target, config, validated);

    expect(
      await hashDevcanonRuntimePayload(runtimeDir, config, validated),
    ).toBe(hashBeforeMutation);
    await expect(
      readFile(path.join(target, "scripts", "devcanon-runtime.sh")),
    ).resolves.toEqual(expectedShell);
    await expect(
      readFile(path.join(target, "scripts", "runtime", "THIRD_PARTY_LICENSES")),
    ).resolves.toEqual(expectedProvider);
  });

  it("rejects reconciliation evidence validated for a different runtime root", async () => {
    const runtimeA = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeA, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const secondSkills = path.join(tempDir, "second-skills");
    await copyDevcanonRuntimeFixture(secondSkills);
    const runtimeB = path.join(secondSkills, "devcanon-runtime");
    const modifiedShell = "#!/usr/bin/env bash\nexit 23\n";
    await writeFile(
      path.join(runtimeB, "scripts", "devcanon-runtime.sh"),
      modifiedShell,
    );

    await expect(
      reconcileDevcanonRuntimeSource(
        runtimeB,
        await providerFromValidated(
          path.join(runtimeA, "scripts", "runtime"),
          validated,
        ),
        validated,
      ),
    ).rejects.toThrow(/different runtime directory/i);
    await expect(
      readFile(path.join(runtimeB, "scripts", "devcanon-runtime.sh"), "utf8"),
    ).resolves.toBe(modifiedShell);
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
    const priorSibling = path.join(runtimeDir, "scripts.prior");
    const oldBackupName = path.join(
      runtimeDir,
      "scripts",
      ".devcanon-runtime.runtime.prior",
    );
    await writeFile(unrelated, "keep\n");
    await writeFile(priorSibling, "keep prior\n");
    await writeFile(oldBackupName, "keep old name\n");

    await reconcileDevcanonRuntimeSource(runtimeDir, provider, validated);

    await expect(readFile(unrelated, "utf8")).resolves.toBe("keep\n");
    await expect(readFile(priorSibling, "utf8")).resolves.toBe("keep prior\n");
    await expect(readFile(oldBackupName, "utf8")).resolves.toBe(
      "keep old name\n",
    );
    await expect(
      readdir(path.join(runtimeDir, "scripts", "runtime")),
    ).resolves.toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
  });

  it("rejects a contract-shaped but non-authoritative adapter before publication", async () => {
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
      reconcileDevcanonRuntimeSource(
        runtimeDir,
        provider,
        forgedSnapshot(validated, {
          adapterPair: {
            ...validated.adapterPair,
            shell: Buffer.from(
              '#!/usr/bin/env bash\nprintf \'%s\\n\' \'{"command_group":"devcanon-runtime","major_version":1}\'\n',
            ),
          },
        }),
      ),
    ).rejects.toThrow(/does not match the authoritative validated snapshot/i);
    await expect(
      readFile(path.join(runtimeDir, "scripts", "devcanon-runtime.sh")),
    ).resolves.toEqual(before);
  });

  it("rejects a staged resolver that emits a nonexistent bash path before publication", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = await providerFromValidated(runtime, validated);
    const brokenPair = {
      ...validated.adapterPair,
      resolver: Buffer.from("console.log('/definitely/not/a/bash');\n"),
    };
    const before = await readFile(
      path.join(runtimeDir, "scripts", "resolve-bash.mjs"),
    );

    await expect(
      reconcileDevcanonRuntimeSource(
        runtimeDir,
        provider,
        forgedSnapshot(validated, {
          adapterPair: brokenPair,
          authoritativeAdapterPair: brokenPair,
        }),
      ),
    ).rejects.toThrow(/staged resolver emitted a missing bash path/i);
    await expect(
      readFile(path.join(runtimeDir, "scripts", "resolve-bash.mjs")),
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

async function providerFromValidated(
  runtime: string,
  validated: Awaited<ReturnType<typeof validateDevcanonRuntime>>,
) {
  return {
    origin: "source-build",
    root: runtime,
    manifest: JSON.parse(
      (await readFile(path.join(runtime, "runtime-manifest.json"))).toString(),
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
}

function forgedSnapshot(
  validated: Awaited<ReturnType<typeof validateDevcanonRuntime>>,
  overrides: Partial<{
    adapterPair: typeof validated.adapterPair;
    authoritativeAdapterPair: typeof validated.authoritativeAdapterPair;
  }>,
) {
  return {
    runtimeDir: validated.runtimeDir,
    runtimeIdentity: validated.runtimeIdentity,
    adapterPair: overrides.adapterPair ?? validated.adapterPair,
    authoritativeAdapterPair:
      overrides.authoritativeAdapterPair ?? validated.authoritativeAdapterPair,
    adapterState: validated.adapterState,
    providerLeaves: validated.providerLeaves,
    closureRecords: validated.closureRecords,
  } as typeof validated;
}
