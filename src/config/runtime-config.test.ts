import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
  makeConfigYaml,
} from "../__test-helpers__/fixtures.js";
import { UserError } from "../utils/errors.js";
import {
  formatRuntimeConfigScalar,
  getRuntimeConfigScalar,
  loadRuntimeConfigCatalog,
  selectRuntimeConfig,
} from "./runtime-config.js";

describe("runtime configuration selection", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTempDir(tempDir);
  });

  it("selects explicit configuration before environment and CWD", async () => {
    await mkdir(path.join(tempDir, "explicit"), { recursive: true });
    await mkdir(path.join(tempDir, "env"), { recursive: true });
    const explicitPath = await createConfigFile(
      path.join(tempDir, "explicit"),
      makeConfigYaml({ defaults: { installMode: "copy" } }),
    );
    const envPath = await createConfigFile(path.join(tempDir, "env"));
    await mkdir(path.join(tempDir, "cwd"), { recursive: true });
    await createConfigFile(path.join(tempDir, "cwd"));
    vi.stubEnv("DEVCANON_CONFIG", envPath);
    const previousCwd = process.cwd();

    try {
      process.chdir(path.join(tempDir, "cwd"));
      const selected = await selectRuntimeConfig(explicitPath);

      expect(selected).toMatchObject({
        path: path.resolve(explicitPath),
        source: "explicit",
      });
      expect(
        getRuntimeConfigScalar(selected.value, "defaults.installMode"),
      ).toBe("copy");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("selects the bundled catalog outside a source library", async () => {
    const unrelatedCwd = path.join(tempDir, "unrelated");
    await mkdir(unrelatedCwd, { recursive: true });
    const previousCwd = process.cwd();

    try {
      process.chdir(unrelatedCwd);
      const selected = await selectRuntimeConfig();

      expect(selected.source).toBe("bundled");
      expect(path.isAbsolute(selected.path)).toBe(true);
      expect(
        getRuntimeConfigScalar(
          selected.value,
          "capabilityProfiles.balanced.codex",
        ),
      ).toBe("gpt-5.6-terra");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("selects environment configuration before a CWD configuration", async () => {
    await mkdir(path.join(tempDir, "environment"), { recursive: true });
    await mkdir(path.join(tempDir, "cwd"), { recursive: true });
    const environmentPath = await createConfigFile(
      path.join(tempDir, "environment"),
    );
    await createConfigFile(path.join(tempDir, "cwd"));
    vi.stubEnv("DEVCANON_CONFIG", environmentPath);
    const previousCwd = process.cwd();

    try {
      process.chdir(path.join(tempDir, "cwd"));
      await expect(selectRuntimeConfig()).resolves.toMatchObject({
        path: path.resolve(environmentPath),
        source: "environment",
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("selects CWD configuration before the bundled catalog", async () => {
    const cwd = path.join(tempDir, "cwd");
    await mkdir(cwd, { recursive: true });
    await createConfigFile(cwd);
    const previousCwd = process.cwd();

    try {
      process.chdir(cwd);
      await expect(selectRuntimeConfig()).resolves.toMatchObject({
        path: path.resolve("devcanon.config.yaml"),
        source: "cwd",
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("fails closed when the selected explicit configuration is missing", async () => {
    const missing = path.join(tempDir, "missing.yaml");
    vi.stubEnv("DEVCANON_CONFIG", await createConfigFile(tempDir));

    await expect(selectRuntimeConfig(missing)).rejects.toBeInstanceOf(
      UserError,
    );
  });
});

describe("runtime configuration catalog", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("rejects an exact-envelope catalog with an extra field", async () => {
    const catalogPath = path.join(tempDir, "runtime-config.json");
    await writeFile(
      catalogPath,
      JSON.stringify({
        schema: "devcanon/runtime-config/v1",
        capabilityProfiles: {
          efficient: { claude: "a", codex: "b" },
          balanced: { claude: "c", codex: "d" },
          frontier: { claude: "e", codex: "f" },
        },
        unexpected: true,
      }),
      "utf8",
    );

    await expect(loadRuntimeConfigCatalog(catalogPath)).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it("rejects duplicate JSON keys in a runtime catalog", async () => {
    const catalogPath = path.join(tempDir, "runtime-config.json");
    await writeFile(
      catalogPath,
      [
        '{"schema":"devcanon/runtime-config/v1",',
        '"schema":"devcanon/runtime-config/v1",',
        '"capabilityProfiles":{"efficient":{"claude":"a","codex":"b"},',
        '"balanced":{"claude":"c","codex":"d"},',
        '"frontier":{"claude":"e","codex":"f"}}}',
      ].join(""),
      "utf8",
    );

    await expect(loadRuntimeConfigCatalog(catalogPath)).rejects.toThrow(
      /duplicate JSON key/i,
    );
  });

  it.each([
    "",
    "capabilityProfiles..codex",
    "capabilityProfiles[balanced].codex",
    "__proto__.polluted",
    "capabilityProfiles.balanced",
    "capabilityProfiles.unknown.codex",
  ])("rejects unsafe or non-scalar key %j", (key) => {
    expect(() =>
      getRuntimeConfigScalar(
        {
          capabilityProfiles: {
            balanced: { codex: "gpt-5.6-terra" },
          },
        },
        key,
      ),
    ).toThrow(UserError);
  });

  it("uses JSON spelling for non-string scalar output", () => {
    expect(formatRuntimeConfigScalar(true)).toBe("true");
    expect(formatRuntimeConfigScalar(5)).toBe("5");
  });
});
