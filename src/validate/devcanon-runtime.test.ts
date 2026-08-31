import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  copyDevcanonRuntimeFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { retainedMitLicenseNoticePaths } from "../__test-helpers__/runtime-conformance.js";
import { renderAll } from "../render/pipeline.js";
import { UserError } from "../utils/errors.js";
import { pathExists } from "../utils/fs.js";
import { validateDevcanonRuntime } from "./devcanon-runtime.js";

const symlinkAvailable = await canCreateSymlinks();

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

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it.each(["SKILL.md", path.join("agents", "openai.yaml")])(
    "rejects forbidden runtime metadata %s before generated output is mutated",
    async (forbiddenPath) => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const sentinel = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "sentinel",
        "marker.txt",
      );
      await mkdir(path.dirname(sentinel), { recursive: true });
      await mkdir(path.dirname(path.join(runtimeDir, forbiddenPath)), {
        recursive: true,
      });
      await writeFile(
        path.join(runtimeDir, forbiddenPath),
        "forbidden\n",
        "utf-8",
      );
      await writeFile(sentinel, "unchanged\n", "utf-8");

      await expect(renderAll(config, true)).rejects.toThrow(UserError);
      await expect(renderAll(config, true)).rejects.toThrow(
        new RegExp(
          `must not contain ${forbiddenPath.replace(/[\\/]/gu, "[\\\\/]")}`,
          "i",
        ),
      );
      expect(await pathExists(sentinel)).toBe(true);
    },
  );

  it("rejects a missing required runtime file before generated output is mutated", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const sentinel = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "sentinel",
      "marker.txt",
    );
    await mkdir(path.dirname(sentinel), { recursive: true });
    await rm(path.join(runtimeDir, "scripts", "devcanon-runtime.sh"));
    await writeFile(sentinel, "unchanged\n", "utf-8");

    await expect(renderAll(config, true)).rejects.toThrow(UserError);
    await expect(renderAll(config, true)).rejects.toThrow(
      /passive runtime support bundle devcanon-runtime is incomplete/i,
    );
    expect(await pathExists(sentinel)).toBe(true);
  });

  it("rejects an extra passive runtime payload file before generated output is mutated", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const sentinel = path.join(
      config.library.generatedDir,
      "claude",
      "skills",
      "sentinel",
      "marker.txt",
    );
    await mkdir(path.dirname(sentinel), { recursive: true });
    await writeFile(path.join(runtimeDir, "metadata.json"), "{}\n", "utf-8");
    await writeFile(sentinel, "unchanged\n", "utf-8");

    await expect(renderAll(config, true)).rejects.toThrow(UserError);
    await expect(renderAll(config, true)).rejects.toThrow(
      /passive runtime support bundle devcanon-runtime is incomplete/i,
    );
    expect(await pathExists(sentinel)).toBe(true);
  });

  it("rejects an extra private parser package before generated output is mutated", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const sentinel = path.join(
      config.library.generatedDir,
      "codex",
      "skills",
      "sentinel",
      "marker.txt",
    );
    const unexpectedPackage = path.join(
      runtimeDir,
      "scripts",
      "runtime",
      "node_modules",
      "unexpected-package",
    );
    await mkdir(unexpectedPackage, { recursive: true });
    await writeFile(
      path.join(unexpectedPackage, "package.json"),
      '{"name":"unexpected-package"}\n',
      "utf-8",
    );
    await mkdir(path.dirname(sentinel), { recursive: true });
    await writeFile(sentinel, "unchanged\n", "utf-8");

    await expect(renderAll(config, true)).rejects.toThrow(UserError);
    await expect(renderAll(config, true)).rejects.toThrow(
      /passive runtime support bundle devcanon-runtime is incomplete/i,
    );
    expect(await pathExists(sentinel)).toBe(true);
  });

  it("rejects a missing required private parser file", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await rm(
      path.join(
        runtimeDir,
        "scripts",
        "runtime",
        "node_modules",
        "mdast-util-from-markdown",
        "index.js",
      ),
    );

    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toThrow(
      /passive runtime support bundle devcanon-runtime is incomplete/i,
    );
  });

  it("retains notices for every private MIT parser package", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await validateDevcanonRuntime(runtimeDir);

    await expect(
      retainedMitLicenseNoticePaths(
        path.join(runtimeDir, "scripts", "runtime"),
      ),
    ).resolves.toContain(path.join("node_modules", "ms", "license"));
  });

  it("rejects a deep extra private parser file", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(
      path.join(
        runtimeDir,
        "scripts",
        "runtime",
        "node_modules",
        "mdast-util-from-markdown",
        "lib",
        "unexpected.js",
      ),
      "export {};\n",
      "utf-8",
    );

    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toThrow(
      /passive runtime support bundle devcanon-runtime is incomplete/i,
    );
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a deep symlink in the private parser closure",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const entrypoint = path.join(
        runtimeDir,
        "scripts",
        "runtime",
        "node_modules",
        "mdast-util-from-markdown",
        "index.js",
      );
      const externalFile = path.join(tempDir, "external-parser.js");
      await writeFile(externalFile, "export {};\n", "utf-8");
      await rm(entrypoint);
      await symlink(externalFile, entrypoint, "file");

      await expect(validateDevcanonRuntime(runtimeDir)).rejects.toThrow(
        /passive runtime support bundle devcanon-runtime is incomplete/i,
      );
    },
  );

  it("rejects a manifest-expanded private parser package", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    const nodeModules = path.join(
      runtimeDir,
      "scripts",
      "runtime",
      "node_modules",
    );
    const packagePath = path.join(
      nodeModules,
      "mdast-util-gfm",
      "package.json",
    );
    const packageJson = JSON.parse(await readFile(packagePath, "utf-8")) as {
      dependencies: Record<string, string>;
    };
    packageJson.dependencies["unexpected-package"] = "1.0.0";
    await writeFile(packagePath, JSON.stringify(packageJson), "utf-8");
    await mkdir(path.join(nodeModules, "unexpected-package"));
    await writeFile(
      path.join(nodeModules, "unexpected-package", "package.json"),
      '{"name":"unexpected-package"}\n',
      "utf-8",
    );

    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toThrow(
      /passive runtime support bundle devcanon-runtime is incomplete/i,
    );
  });

  it("rejects a runtime catalog with an extra envelope field", async () => {
    const runtimeDir = path.join(config.library.skillsDir, "devcanon-runtime");
    await writeFile(
      path.join(runtimeDir, "config", "runtime-config.json"),
      JSON.stringify({
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {
          efficient: { claude: "a", codex: "b" },
          balanced: { claude: "c", codex: "d" },
          frontier: { claude: "e", codex: "f" },
        },
        extra: true,
      }),
      "utf-8",
    );

    await expect(validateDevcanonRuntime(runtimeDir)).rejects.toThrow(
      /runtime configuration catalog/i,
    );
  });

  it.skipIf(!symlinkAvailable)(
    "rejects a symlinked passive payload entry before generated output is mutated",
    async () => {
      const runtimeDir = path.join(
        config.library.skillsDir,
        "devcanon-runtime",
      );
      const entrypoint = path.join(
        runtimeDir,
        "scripts",
        "devcanon-runtime.sh",
      );
      const externalEntrypoint = path.join(tempDir, "external-runtime.sh");
      const sentinel = path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        "sentinel",
        "marker.txt",
      );
      await writeFile(externalEntrypoint, "#!/bin/sh\n", "utf-8");
      await rm(entrypoint);
      await symlink(externalEntrypoint, entrypoint, "file");
      await mkdir(path.dirname(sentinel), { recursive: true });
      await writeFile(sentinel, "unchanged\n", "utf-8");

      await expect(renderAll(config, true)).rejects.toThrow(UserError);
      expect(await pathExists(sentinel)).toBe(true);
    },
  );
});
