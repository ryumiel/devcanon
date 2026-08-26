import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
  makeConfigYaml,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import { configGetAction, configPathAction } from "./config.js";

describe("config CLI actions", () => {
  let tempDir: string;
  let logCtx: ReturnType<typeof installTestLogger>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    logCtx = installTestLogger();
  });

  afterEach(async () => {
    logCtx.restore();
    await cleanupTempDir(tempDir);
  });

  it("prints the selected source path in plain mode", async () => {
    await mkdir(path.join(tempDir, "config"), { recursive: true });
    const configPath = await createConfigFile(path.join(tempDir, "config"));

    await configPathAction({}, commandWith({ config: configPath }));

    expect(logCtx.testLogger.infos).toEqual([path.resolve(configPath)]);
    expect(logCtx.testLogger.jsons).toEqual([]);
  });

  it("prints a scalar lookup envelope in JSON mode", async () => {
    await mkdir(path.join(tempDir, "config"), { recursive: true });
    const configPath = await createConfigFile(
      path.join(tempDir, "config"),
      makeConfigYaml({ defaults: { installMode: "copy" } }),
    );

    await configGetAction(
      "defaults.installMode",
      {},
      commandWith({ config: configPath, json: true }),
    );

    expect(logCtx.testLogger.infos).toEqual([]);
    expect(logCtx.testLogger.jsons).toEqual([
      {
        path: path.resolve(configPath),
        source: "explicit",
        key: "defaults.installMode",
        value: "copy",
      },
    ]);
  });

  it("does not emit output when a scalar key is invalid", async () => {
    await mkdir(path.join(tempDir, "config"), { recursive: true });
    const configPath = await createConfigFile(path.join(tempDir, "config"));

    await expect(
      configGetAction(
        "capabilityProfiles[balanced].codex",
        {},
        commandWith({ config: configPath }),
      ),
    ).rejects.toThrow("Invalid configuration key");

    expect(logCtx.testLogger.infos).toEqual([]);
    expect(logCtx.testLogger.jsons).toEqual([]);
  });
});

function commandWith(globalOptions: Record<string, unknown>) {
  return { opts: () => ({}), parent: { opts: () => globalOptions } };
}
