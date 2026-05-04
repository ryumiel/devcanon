import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
  makeManifestJson,
} from "../../__test-helpers__/fixtures.js";
import { pathExists } from "../../utils/fs.js";
import { type Logger, getLogger, setLogger } from "../../utils/output.js";
import { UserError } from "../../utils/errors.js";
import { uninstallAction } from "./uninstall.js";

describe("uninstallAction", () => {
  let tempDir: string;
  let configPath: string;
  let manifestPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await mkdir(path.join(tempDir, "agents"), { recursive: true });
    manifestPath = path.join(tempDir, "manifest.json");
    configPath = await createConfigFile(
      tempDir,
      [
        "version: 1",
        "library:",
        "  skillsDir: ./skills",
        "  agentsDir: ./agents",
        "  generatedDir: ./generated",
        "manifest:",
        `  path: ${manifestPath}`,
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

  it("skips summary line under --dry-run", async () => {
    const installedPath = path.join(tempDir, "home", "claude", "skills", "skill-a");
    await mkdir(installedPath, { recursive: true });
    await writeFile(path.join(installedPath, "SKILL.md"), "content", "utf-8");

    const timestamp = new Date().toISOString();
    await writeFile(
      manifestPath,
      makeManifestJson([
        {
          target: "claude",
          type: "skill",
          sourcePath: "/x/skills/skill-a",
          generatedPath: null,
          installedPath,
          installMode: "copy",
          contentHash: "abc123",
          timestamp,
        },
      ]),
      "utf-8",
    );

    const { logger, infos } = createRecordingLogger();
    const prior = getLogger();
    setLogger(logger);

    try {
      await uninstallAction(
        { target: "claude", dryRun: true, json: false },
        {
          parent: {
            opts: () => ({ config: configPath, strict: false, json: false }),
          },
        },
      );
    } finally {
      setLogger(prior);
    }

    expect(infos.some((line) => line.startsWith("Uninstall complete:"))).toBe(false);
    expect(await pathExists(installedPath)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "sets process.exitCode = 1 and logs each error when uninstall fails",
    async () => {
      // skill-a lives inside a chmod 0o555 parent so rm cannot unlink it;
      // this exercises the error accumulation and process.exitCode path.
      const lockedParent = path.join(tempDir, "home", "claude", "skills", "_locked");
      await mkdir(lockedParent, { recursive: true });
      const installedPath = path.join(lockedParent, "skill-a");
      await mkdir(installedPath, { recursive: true });
      await writeFile(path.join(installedPath, "SKILL.md"), "content", "utf-8");

      const timestamp = new Date().toISOString();
      await writeFile(
        manifestPath,
        makeManifestJson([
          {
            target: "claude",
            type: "skill",
            sourcePath: "/x/skills/skill-a",
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "abc123",
            timestamp,
          },
        ]),
        "utf-8",
      );

      await chmod(lockedParent, 0o555);

      const { logger, errors } = createRecordingLogger();
      const prior = getLogger();
      setLogger(logger);

      const priorExitCode = process.exitCode;
      process.exitCode = undefined;

      try {
        await uninstallAction(
          { dryRun: false, json: false },
          {
            parent: {
              opts: () => ({ config: configPath, strict: false, json: false }),
            },
          },
        );

        expect(process.exitCode).toBe(1);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors.some((e) => /EACCES|EPERM|permission/i.test(e))).toBe(true);
      } finally {
        setLogger(prior);
        process.exitCode = priorExitCode;
        await chmod(lockedParent, 0o755).catch(() => {});
      }
    },
  );
});
