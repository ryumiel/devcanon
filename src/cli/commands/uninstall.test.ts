import { mkdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
} from "../../__test-helpers__/fixtures.js";
import { type Logger, getLogger, setLogger } from "../../utils/output.js";
import { UserError } from "../../utils/errors.js";
import { uninstallAction } from "./uninstall.js";

describe("uninstallAction", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await mkdir(path.join(tempDir, "agents"), { recursive: true });
    configPath = await createConfigFile(
      tempDir,
      [
        "version: 1",
        "library:",
        "  skillsDir: ./skills",
        "  agentsDir: ./agents",
        "  generatedDir: ./generated",
        "manifest:",
        `  path: ${path.join(tempDir, "manifest.json")}`,
      ].join("\n"),
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  function createRecordingLogger(): {
    logger: Logger;
    infos: string[];
    errors: string[];
    jsons: unknown[];
  } {
    const infos: string[] = [];
    const errors: string[] = [];
    const jsons: unknown[] = [];
    return {
      logger: {
        error: (m) => errors.push(m),
        warn: () => {},
        info: (m) => infos.push(m),
        verbose: () => {},
        debug: () => {},
        json: (d) => jsons.push(d),
      },
      infos,
      errors,
      jsons,
    };
  }

  it("throws UserError for invalid --target", async () => {
    await expect(
      uninstallAction(
        { target: "vscode" },
        {
          parent: {
            opts: () => ({ config: configPath, strict: false, json: false }),
          },
        },
      ),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("emits JSON result when --json is set against an empty manifest", async () => {
    const { logger, jsons } = createRecordingLogger();
    const prior = getLogger();
    setLogger(logger);

    try {
      await uninstallAction(
        {},
        {
          parent: {
            opts: () => ({ config: configPath, strict: false, json: true }),
          },
        },
      );
    } finally {
      setLogger(prior);
    }

    expect(jsons).toHaveLength(1);
    expect(jsons[0]).toEqual({ removed: 0, errors: [] });
  });
});
