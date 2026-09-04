import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createDevcanonRuntimeProviderFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import type { ResolvedConfig } from "../config/schema.js";
import {
  type AcceptedProvider,
  ImmutableProviderBytes,
} from "../runtime-build/provider.js";
import {
  type ValidateDevcanonRuntimeOptions,
  validateDevcanonRuntime as validateProviderBackedRuntime,
} from "../validate/devcanon-runtime.js";
import {
  hashDevcanonRuntimePayload,
  reconcileDevcanonRuntimeSubtree,
  renderDevcanonRuntimeForTarget,
  withDevcanonRuntimePublicationFaultsForTesting,
} from "./devcanon-runtime.js";
import { reconcileDevcanonRuntimeSource } from "./devcanon-runtime.js";
import { writeRenderedDevcanonRuntime } from "./devcanon-runtime.js";
import { renderAll as renderAllWithProvider } from "./pipeline.js";

describe("devcanon-runtime rendering", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let provider: AcceptedProvider;

  const validateDevcanonRuntime = (
    runtimeDir: string,
    options: Omit<ValidateDevcanonRuntimeOptions, "provider"> & {
      provider?: AcceptedProvider;
    } = {},
  ) =>
    validateProviderBackedRuntime(runtimeDir, {
      ...options,
      provider: options.provider ?? provider,
    });
  const renderAll = (
    renderedConfig: ResolvedConfig,
    writeToGenerated = true,
    strict = false,
    targetFilter?: "claude" | "codex",
  ) =>
    renderAllWithProvider(
      renderedConfig,
      provider,
      writeToGenerated,
      strict,
      targetFilter,
    );

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await copyDevcanonRuntimeFixture(config.library.skillsDir);
    provider = await createDevcanonRuntimeProviderFixture(tempDir);
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

  it("hashes the canonical shell bytes that rendering will materialize", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const shell = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
    const original = await readFile(shell);
    const originalHash = await hashDevcanonRuntimePayload(runtimeDir, config);
    const crlf = Buffer.from(
      original.toString("utf8").replaceAll("\n", "\r\n"),
      "utf8",
    );
    await writeFile(shell, crlf);

    const crlfHash = await hashDevcanonRuntimePayload(runtimeDir, config);
    const target = path.join(tempDir, "canonical-shell-runtime");
    await writeRenderedDevcanonRuntime(runtimeDir, target, config);

    expect(crlfHash).toBe(originalHash);
    await expect(
      readFile(path.join(target, "scripts", "devcanon-runtime.sh")),
    ).resolves.toEqual(original);
  });

  it.skipIf(process.platform === "win32")(
    "does not hash source catalog mode that rendered materialization does not preserve",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const catalog = path.join(runtimeDir, "config", "runtime-config.json");
      await chmod(catalog, 0o600);
      const first = await renderDevcanonRuntimeForTarget(
        runtimeDir,
        "codex",
        config,
      );
      await chmod(catalog, 0o644);
      const second = await renderDevcanonRuntimeForTarget(
        runtimeDir,
        "codex",
        config,
      );

      expect(second.contentHash).toBe(first.contentHash);
    },
  );

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

  it("preserves a concurrently created destination when absent-subtree publication loses a race", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = await providerFromValidated(runtime, validated);
    await rm(runtime, { recursive: true });
    const concurrentMarker = path.join(runtime, "concurrent.txt");

    await expect(
      withDevcanonRuntimePublicationFaultsForTesting(
        async (stage) => {
          if (stage !== "replace-before-publish") return;
          await mkdir(runtime);
          await writeFile(concurrentMarker, "preserve\n");
        },
        () => reconcileDevcanonRuntimeSubtree(runtimeDir, provider),
      ),
    ).rejects.toThrow();

    await expect(readFile(concurrentMarker, "utf8")).resolves.toBe(
      "preserve\n",
    );
    expect(
      (await readdir(path.join(runtimeDir, "scripts"))).filter(
        (entry) =>
          entry.startsWith(".runtime-stage-") ||
          entry.startsWith(".devcanon-runtime-operation-"),
      ),
    ).toEqual([]);
  });

  it("reports subtree backup cleanup failure after publishing outside the skill collection", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = await providerFromValidated(runtime, validated);
    const scratchParent = path.dirname(config.library.skillsDir);

    await expect(
      withDevcanonRuntimePublicationFaultsForTesting(
        (stage) => {
          if (stage === "replace-cleanup") {
            throw new Error("forced subtree cleanup failure");
          }
        },
        () => reconcileDevcanonRuntimeSubtree(runtimeDir, provider),
      ),
    ).rejects.toThrow(
      /runtime directory published successfully, but cleanup failed; retained operation backup at .*forced subtree cleanup failure/i,
    );

    await expect(readdir(runtime)).resolves.toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
    await expect(readdir(config.library.skillsDir)).resolves.toEqual([
      "devcanon-runtime",
    ]);
    expect(
      (await readdir(scratchParent)).filter((entry) =>
        entry.startsWith(".devcanon-runtime-operation-"),
      ),
    ).toHaveLength(1);
  });

  it("restores a pristine legacy pair after an absent-runtime publication race and retries cleanly", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const scripts = path.join(runtimeDir, "scripts");
    const runtime = path.join(scripts, "runtime");
    const initiallyValidated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const legacy = {
      shell: await readFile(path.join(scripts, "devcanon-runtime.sh")),
      resolver: await readFile(path.join(scripts, "resolve-bash.mjs")),
      shellMode:
        (await stat(path.join(scripts, "devcanon-runtime.sh"))).mode & 0o777,
      resolverMode:
        (await stat(path.join(scripts, "resolve-bash.mjs"))).mode & 0o777,
    };
    const provider = await providerFromValidated(runtime, initiallyValidated);
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
    await rm(runtime, { recursive: true });
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: authority,
      pristineLegacyPair: legacy,
      operation: "compose",
      provider,
    });
    const concurrentMarker = path.join(runtime, "concurrent.txt");

    await expect(
      withDevcanonRuntimePublicationFaultsForTesting(
        async (stage) => {
          if (stage !== "source-before-publish") return;
          await mkdir(runtime);
          await writeFile(concurrentMarker, "preserve\n");
          throw new Error("forced source publication failure");
        },
        () => reconcileDevcanonRuntimeSource(runtimeDir, provider, validated),
      ),
    ).rejects.toThrow(/^forced source publication failure$/);

    await expect(
      readFile(path.join(scripts, "devcanon-runtime.sh")),
    ).resolves.toEqual(legacy.shell);
    await expect(
      readFile(path.join(scripts, "resolve-bash.mjs")),
    ).resolves.toEqual(legacy.resolver);
    await expect(readFile(concurrentMarker, "utf8")).resolves.toBe(
      "preserve\n",
    );
    expect(
      (await readdir(runtimeDir)).filter((entry) =>
        entry.startsWith(".runtime-source-stage-"),
      ),
    ).toEqual([]);
    expect(
      (await readdir(scripts)).filter((entry) =>
        entry.startsWith(".devcanon-runtime-operation-"),
      ),
    ).toEqual([]);

    await reconcileDevcanonRuntimeSource(runtimeDir, provider, validated);
    await expect(
      readFile(path.join(scripts, "devcanon-runtime.sh")),
    ).resolves.toEqual(currentShell);
    await expect(
      readFile(path.join(scripts, "resolve-bash.mjs")),
    ).resolves.toEqual(currentResolver);
    await expect(readdir(runtime)).resolves.toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
  });

  it("reports source backup cleanup failure after publishing outside the skill collection", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = await providerFromValidated(runtime, validated);
    const scratchParent = path.dirname(config.library.skillsDir);

    await expect(
      withDevcanonRuntimePublicationFaultsForTesting(
        (stage) => {
          if (stage === "source-cleanup") {
            throw new Error("forced source cleanup failure");
          }
        },
        () => reconcileDevcanonRuntimeSource(runtimeDir, provider, validated),
      ),
    ).rejects.toThrow(
      /runtime source published successfully, but cleanup failed; retained operation backup at .*forced source cleanup failure/i,
    );

    await expect(readdir(config.library.skillsDir)).resolves.toEqual([
      "devcanon-runtime",
    ]);
    expect(
      (await readdir(scratchParent)).filter((entry) =>
        entry.startsWith(".devcanon-runtime-operation-"),
      ),
    ).toHaveLength(1);
    await expect(
      validateDevcanonRuntime(runtimeDir, {
        adapterSourceDir: path.resolve("skills/devcanon-runtime"),
      }),
    ).resolves.toBeDefined();
  });

  it("rejects source adapter byte drift after validation without publishing", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = await providerFromValidated(runtime, validated);
    const shell = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
    const resolver = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
    const runtimeLicense = path.join(runtime, "THIRD_PARTY_LICENSES");
    const changedShell = Buffer.from("#!/usr/bin/env bash\nexit 27\n");
    const resolverBefore = await readFile(resolver);
    const runtimeBefore = await readFile(runtimeLicense);
    await writeFile(shell, changedShell);

    await expect(
      reconcileDevcanonRuntimeSource(runtimeDir, provider, validated),
    ).rejects.toThrow(/changed after validation/i);

    await expect(readFile(shell)).resolves.toEqual(changedShell);
    await expect(readFile(resolver)).resolves.toEqual(resolverBefore);
    await expect(readFile(runtimeLicense)).resolves.toEqual(runtimeBefore);
  });

  it.skipIf(process.platform === "win32")(
    "rejects valid source adapter mode drift after validation without publishing",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const validated = await validateDevcanonRuntime(runtimeDir, {
        adapterSourceDir: path.resolve("skills/devcanon-runtime"),
      });
      const runtime = path.join(runtimeDir, "scripts", "runtime");
      const provider = await providerFromValidated(runtime, validated);
      const shell = path.join(runtimeDir, "scripts", "devcanon-runtime.sh");
      const resolver = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
      const changedMode = validated.sourceAdapterPair.shellMode ^ 0o020;
      await chmod(shell, changedMode);

      await expect(
        reconcileDevcanonRuntimeSource(runtimeDir, provider, validated),
      ).rejects.toThrow(/changed after validation/i);

      expect((await stat(shell)).mode & 0o777).toBe(changedMode);
      await expect(readFile(resolver)).resolves.toEqual(
        validated.sourceAdapterPair.resolver,
      );
    },
  );

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

  it("rejects a staged resolver that emits the Node executable before publication", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const validated = await validateDevcanonRuntime(runtimeDir, {
      adapterSourceDir: path.resolve("skills/devcanon-runtime"),
    });
    const runtime = path.join(runtimeDir, "scripts", "runtime");
    const provider = await providerFromValidated(runtime, validated);
    const brokenPair = {
      ...validated.adapterPair,
      resolver: Buffer.from("console.log(process.execPath);\n"),
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
    ).rejects.toThrow(/staged resolver emitted a non-Bash executable path/i);
    await expect(
      readFile(path.join(runtimeDir, "scripts", "resolve-bash.mjs")),
    ).resolves.toEqual(before);
  });
});

function requiredProviderLeaf(
  validated: Awaited<ReturnType<typeof validateProviderBackedRuntime>>,
  leaf: string,
): Buffer {
  const bytes = validated.providerLeaves.get(leaf);
  if (bytes === undefined)
    throw new Error(`missing provider test leaf: ${leaf}`);
  return bytes;
}

async function providerFromValidated(
  runtime: string,
  validated: Awaited<ReturnType<typeof validateProviderBackedRuntime>>,
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
  validated: Awaited<ReturnType<typeof validateProviderBackedRuntime>>,
  overrides: Partial<{
    adapterPair: typeof validated.adapterPair;
    authoritativeAdapterPair: typeof validated.authoritativeAdapterPair;
  }>,
) {
  return {
    runtimeDir: validated.runtimeDir,
    runtimeIdentity: validated.runtimeIdentity,
    adapterPair: overrides.adapterPair ?? validated.adapterPair,
    sourceAdapterPair: validated.sourceAdapterPair,
    authoritativeAdapterPair:
      overrides.authoritativeAdapterPair ?? validated.authoritativeAdapterPair,
    adapterState: validated.adapterState,
    providerLeaves: validated.providerLeaves,
    closureRecords: validated.closureRecords,
  } as typeof validated;
}
