import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDir,
  createConfigFile,
  createTempDir,
  makeConfigYaml,
  makeManifestJson,
} from "../../__test-helpers__/fixtures.js";
import {
  type TestLoggerResult,
  installTestLogger,
} from "../../__test-helpers__/logger.js";
import { buildSkillContentHash } from "../../render/skill.js";
import { UserError } from "../../utils/errors.js";
import { pathExists } from "../../utils/fs.js";
import { uninstallAction } from "./uninstall.js";

describe("uninstallAction", () => {
  let tempDir: string;
  let configPath: string;
  let manifestPath: string;
  let testLogger: TestLoggerResult;
  let restoreLogger: () => void;
  let priorExitCode: typeof process.exitCode;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await mkdir(path.join(tempDir, "agents"), { recursive: true });
    manifestPath = path.join(tempDir, "manifest.json");
    configPath = await createConfigFile(
      tempDir,
      makeConfigYaml({
        library: {
          skillsDir: "./skills",
          agentsDir: "./agents",
          generatedDir: "./generated",
        },
        manifest: { path: manifestPath },
        targets: {
          claude: {
            skillsHome: path.join(tempDir, "home", "claude", "skills"),
            agentsHome: path.join(tempDir, "home", "claude", "agents"),
          },
          codex: {
            skillsHome: path.join(tempDir, "home", "codex", "skills"),
            agentsHome: path.join(tempDir, "home", "codex", "agents"),
          },
        },
      }),
    );
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    restoreLogger = installed.restore;
    priorExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.exitCode = priorExitCode;
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

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
    await uninstallAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, strict: false, json: true }),
        },
      },
    );

    expect(testLogger.jsons).toHaveLength(1);
    expect(testLogger.jsons[0]).toEqual({ removed: 0, errors: [] });
  });

  it("emits JSON result with removed count when records exist", async () => {
    const installedPath = path.join(
      tempDir,
      "home",
      "claude",
      "skills",
      "skill-a",
    );
    await mkdir(installedPath, { recursive: true });
    await writeFile(path.join(installedPath, "SKILL.md"), "content", "utf-8");

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
          contentHash: skillCopyHash("content", installedPath),
          timestamp: new Date().toISOString(),
        },
      ]),
      "utf-8",
    );

    await uninstallAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, strict: false, json: true }),
        },
      },
    );

    expect(testLogger.jsons).toHaveLength(1);
    expect(testLogger.jsons[0]).toEqual({ removed: 1, errors: [] });
    expect(await pathExists(installedPath)).toBe(false);
  });

  it("logs 'Uninstall complete:' summary on a successful non-dry-run", async () => {
    const installedPath = path.join(
      tempDir,
      "home",
      "claude",
      "skills",
      "skill-a",
    );
    await mkdir(installedPath, { recursive: true });
    await writeFile(path.join(installedPath, "SKILL.md"), "content", "utf-8");

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
          contentHash: skillCopyHash("content", installedPath),
          timestamp: new Date().toISOString(),
        },
      ]),
      "utf-8",
    );

    await uninstallAction(
      {},
      {
        parent: {
          opts: () => ({ config: configPath, strict: false, json: false }),
        },
      },
    );

    expect(
      testLogger.infos.some((line) =>
        line.startsWith("\nUninstall complete: 1 removed"),
      ),
    ).toBe(true);
    expect(await pathExists(installedPath)).toBe(false);
  });

  it("skips summary line under --dry-run", async () => {
    const installedPath = path.join(
      tempDir,
      "home",
      "claude",
      "skills",
      "skill-a",
    );
    await mkdir(installedPath, { recursive: true });
    await writeFile(path.join(installedPath, "SKILL.md"), "content", "utf-8");

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
          contentHash: skillCopyHash("content", installedPath),
          timestamp: new Date().toISOString(),
        },
      ]),
      "utf-8",
    );

    await uninstallAction(
      { target: "claude", dryRun: true },
      {
        parent: {
          opts: () => ({ config: configPath, strict: false, json: false }),
        },
      },
    );

    expect(
      testLogger.infos.some((line) => line.startsWith("\nUninstall complete:")),
    ).toBe(false);
    expect(await pathExists(installedPath)).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "sets process.exitCode = 1 and logs each error when uninstall fails",
    async () => {
      // skill-a lives inside a chmod 0o555 parent so rm cannot unlink it;
      // this exercises the error accumulation and process.exitCode path.
      // Skipped when running as root, since chmod does not block root unlinks.
      const lockedParent = path.join(
        tempDir,
        "home",
        "claude",
        "skills",
        "_locked",
      );
      await mkdir(lockedParent, { recursive: true });
      const installedPath = path.join(lockedParent, "skill-a");
      await mkdir(installedPath, { recursive: true });
      await writeFile(path.join(installedPath, "SKILL.md"), "content", "utf-8");

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
            contentHash: skillCopyHash("content", installedPath),
            timestamp: new Date().toISOString(),
          },
        ]),
        "utf-8",
      );

      await chmod(lockedParent, 0o555);

      try {
        await uninstallAction(
          { dryRun: false },
          {
            parent: {
              opts: () => ({ config: configPath, strict: false, json: false }),
            },
          },
        );

        expect(process.exitCode).toBe(1);
        expect(testLogger.errors.length).toBeGreaterThanOrEqual(1);
        expect(
          testLogger.errors.some((e) => /EACCES|EPERM|permission/i.test(e)),
        ).toBe(true);
      } finally {
        await chmod(lockedParent, 0o755).catch(() => {});
      }
    },
  );
});

function skillCopyHash(content: string, installedPath: string): string {
  return buildSkillContentHash(content, new Map(), installedPath);
}
