import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  canMutateExecutableMode,
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { renderAll } from "../render/pipeline.js";
import type { UserError } from "../utils/errors.js";
import {
  classifyAdapterPair,
  validateDevcanonRuntime,
} from "./devcanon-runtime.js";

const symlinkAvailable = await canCreateSymlinks();
const executableModeMutable = await canMutateExecutableMode();

describe("devcanon-runtime source validation", () => {
  let tempDir: string;
  let config: ReturnType<typeof makeResolvedConfig>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await copyDevcanonRuntimeFixture(config.library.skillsDir);
  });

  afterEach(async () => cleanupTempDir(tempDir));

  it("accepts the closed three-leaf derived runtime subtree", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await expect(
      readdir(path.join(runtimeDir, "scripts", "runtime")),
    ).resolves.toEqual([
      "THIRD_PARTY_LICENSES",
      "devcanon-runtime.mjs",
      "runtime-manifest.json",
    ]);
    await expect(validateDevcanonRuntime(runtimeDir)).resolves.toMatchObject({
      runtimeDir,
    });
  });

  it("classifies only exact current and allowlisted pristine adapter pairs", () => {
    const current = {
      shell: Buffer.from("current"),
      resolver: Buffer.from("resolver"),
    };
    const legacy = {
      shell: Buffer.from("legacy"),
      resolver: Buffer.from("legacy-resolver"),
    };
    expect(classifyAdapterPair(current, current, legacy)).toBe("current");
    expect(classifyAdapterPair(legacy, current, legacy)).toBe(
      "pristine-legacy",
    );
    expect(
      classifyAdapterPair(
        { shell: legacy.shell, resolver: current.resolver },
        current,
        legacy,
      ),
    ).toBe("invalid");
    expect(
      classifyAdapterPair(
        { shell: Buffer.from("changed"), resolver: legacy.resolver },
        current,
        legacy,
      ),
    ).toBe("invalid");
  });

  it("does not treat a modified candidate as its own adapter authority", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(
      path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
      message: "Passive runtime adapter pair is unrecognized.",
      hint: expect.stringContaining("Back up both adapters"),
    } satisfies Partial<UserError>);
  });

  it("directs a pristine legacy pair to render in read-only validation", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const legacy = {
      shell: await readFile(
        path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
      ),
      resolver: await readFile(
        path.join(runtimeDir, "scripts", "resolve-bash.mjs"),
      ),
    };
    const authority = path.join(tempDir, "authority");
    await mkdir(path.join(authority, "scripts"), { recursive: true });
    await writeFile(
      path.join(authority, "scripts", "devcanon-runtime.sh"),
      "#!/usr/bin/env bash\necho current\n",
    );
    await chmod(path.join(authority, "scripts", "devcanon-runtime.sh"), 0o755);
    await writeFile(
      path.join(authority, "scripts", "resolve-bash.mjs"),
      "export {};\n",
    );

    await expect(
      validateDevcanonRuntime(runtimeDir, {
        adapterSourceDir: authority,
        pristineLegacyPair: legacy,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("recognized pristine legacy pair"),
      hint: expect.stringContaining("devcanon render"),
    } satisfies Partial<UserError>);
  });

  it("reports a missing derived subtree with render guidance without mutation", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const runtimePath = path.join(runtimeDir, "scripts", "runtime");
    await rm(runtimePath, { recursive: true });
    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
      message: expect.stringContaining("derived subtree is missing or stale"),
      hint: expect.stringContaining("devcanon render"),
    } satisfies Partial<UserError>);
    await expect(
      readdir(path.join(runtimeDir, "scripts")),
    ).resolves.not.toContain("runtime");
  });

  it("reports an extra derived leaf with render guidance before generated output is touched", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(
      path.join(runtimeDir, "scripts", "runtime", "extra.js"),
      "extra\n",
    );
    await expect(renderAll(config, true)).rejects.toMatchObject({
      message: expect.stringContaining("derived subtree is missing or stale"),
      hint: expect.stringContaining("devcanon render"),
    } satisfies Partial<UserError>);
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a linked adapter pair with manual-adoption guidance",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const resolver = path.join(runtimeDir, "scripts", "resolve-bash.mjs");
      const outside = path.join(tempDir, "resolver.mjs");
      await writeFile(outside, "export {};\n");
      await rm(resolver);
      await symlink(outside, resolver);
      await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
        message: expect.stringContaining("adapter pair"),
        hint: expect.stringContaining("Back up both adapters"),
      } satisfies Partial<UserError>);
    },
  );

  it.skipIf(!executableModeMutable)(
    "rejects a non-executable shell adapter with manual-adoption guidance",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      await chmod(
        path.join(runtimeDir, "scripts", "devcanon-runtime.sh"),
        0o644,
      );
      await expect(validateDevcanonRuntime(runtimeDir)).rejects.toMatchObject({
        message: expect.stringContaining("adapter pair"),
        hint: expect.stringContaining("Back up both adapters"),
      } satisfies Partial<UserError>);
    },
  );
});
