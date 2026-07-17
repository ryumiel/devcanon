import {
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../__test-helpers__/logger.js";
import { pathExists } from "../utils/fs.js";
import {
  captureManifestSnapshot,
  createManifestBackupAuthority,
  emptyManifest,
  loadManifest,
  loadManifestWithSnapshot,
  releaseManifestBackupAuthority,
  saveManifest,
  withManifestPersistenceFaultsForTesting,
} from "./manifest.js";

describe("manifest integration", () => {
  let tempDir: string;
  let testLogger: TestLoggerResult;
  let restoreLogger: () => void;
  const validManifestJson = () =>
    JSON.stringify(
      {
        version: 1,
        managedBy: "devcanon",
        lastSync: "2026-07-17T00:00:00.000Z",
        records: [],
      },
      null,
      2,
    );

  beforeEach(async () => {
    tempDir = await createTempDir();
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    restoreLogger = installed.restore;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  describe("loadManifest", () => {
    it("returns the exact valid source bytes with a load snapshot", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const original =
        '{ "version": 1, "managedBy": "devcanon", "lastSync": "now", "records": [] }\n';
      await writeFile(manifestPath, original, "utf-8");

      const loaded = await loadManifestWithSnapshot(manifestPath);

      expect(loaded.manifest.records).toEqual([]);
      expect(loaded.snapshot?.bytes.toString("utf-8")).toBe(original);
      expect(loaded.snapshot?.manifestPath).toBe(manifestPath);
    });

    it("returns empty manifest when file does not exist", async () => {
      const manifestPath = path.join(tempDir, "nonexistent.json");

      const result = await loadManifest(manifestPath);

      expect(result.version).toBe(1);
      expect(result.managedBy).toBe("devcanon");
      expect(result.records).toEqual([]);
      expect(result.lastSync).toBeDefined();
    });

    it("returns parsed manifest with correct records for valid JSON", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const manifest = {
        version: 1,
        managedBy: "devcanon",
        lastSync: "2026-01-01T00:00:00.000Z",
        records: [
          {
            target: "claude",
            type: "agent",
            sourcePath: "/src/agents/test.yaml",
            generatedPath: "/gen/claude/agents/test.md",
            installedPath: "/installed/test.md",
            installMode: "copy",
            contentHash: "abc123",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

      const result = await loadManifest(manifestPath);

      expect(result.version).toBe(1);
      expect(result.managedBy).toBe("devcanon");
      expect(result.lastSync).toBe("2026-01-01T00:00:00.000Z");
      expect(result.records).toHaveLength(1);
      expect(result.records[0].target).toBe("claude");
      expect(result.records[0].installedPath).toBe("/installed/test.md");
      expect(result.records[0].contentHash).toBe("abc123");
    });

    it("returns empty manifest and backs up corrupt JSON", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const corruptContent = "{not valid json!!!";
      await writeFile(manifestPath, corruptContent, "utf-8");

      const result = await loadManifest(manifestPath);

      expect(result.version).toBe(1);
      expect(result.managedBy).toBe("devcanon");
      expect(result.records).toEqual([]);

      // Warning was logged
      expect(testLogger.warnings.length).toBeGreaterThanOrEqual(1);
      expect(testLogger.warnings.some((w) => w.includes("corrupt JSON"))).toBe(
        true,
      );

      // .bak file exists with original content
      const bakPath = `${manifestPath}.bak`;
      expect(await pathExists(bakPath)).toBe(true);
      const bakContent = await readFile(bakPath, "utf-8");
      expect(bakContent).toBe(corruptContent);
    });

    it("preserves an occupied recovery backup and selects the next sibling", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      await writeFile(`${manifestPath}.bak`, "existing backup", "utf-8");

      await loadManifest(manifestPath);

      expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe(
        "existing backup",
      );
      expect(await readFile(`${manifestPath}.bak-1`, "utf-8")).toBe("{corrupt");
    });

    it("removes its recovery candidate when the source changes during creation", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      let entered!: () => void;
      let resume!: () => void;
      const enteredRecovery = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });

      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage === "recovery-before-candidate") {
            entered();
            await gate;
          }
        },
        async () => {
          const loading = loadManifest(manifestPath);
          await enteredRecovery;
          await writeFile(manifestPath, "{replacement", "utf-8");
          resume();
          await loading;
        },
      );

      expect(await readFile(manifestPath, "utf-8")).toBe("{replacement");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
    });

    it("removes an allocated recovery candidate when the source becomes a dangling symlink", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      let entered = false;

      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage === "recovery-after-candidate") {
            entered = true;
            await unlink(manifestPath);
            await symlink("missing-manifest", manifestPath, "file");
          }
        },
        async () => {
          await loadManifest(manifestPath);
        },
      );

      expect(entered).toBe(true);
      expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("returns empty manifest and backs up schema-invalid JSON", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const invalidSchema = {
        version: 2,
        managedBy: "devcanon",
        lastSync: "2026-01-01T00:00:00.000Z",
        records: [],
      };
      const invalidContent = JSON.stringify(invalidSchema, null, 2);
      await writeFile(manifestPath, invalidContent, "utf-8");

      const result = await loadManifest(manifestPath);

      expect(result.version).toBe(1);
      expect(result.managedBy).toBe("devcanon");
      expect(result.records).toEqual([]);

      // Warning was logged
      expect(testLogger.warnings.length).toBeGreaterThanOrEqual(1);
      expect(
        testLogger.warnings.some((w) => w.includes("schema invalid")),
      ).toBe(true);

      // .bak file exists with original content
      const bakPath = `${manifestPath}.bak`;
      expect(await pathExists(bakPath)).toBe(true);
      const bakContent = await readFile(bakPath, "utf-8");
      expect(bakContent).toBe(invalidContent);
    });
  });

  describe("saveManifest", () => {
    it("keeps authority freshness state opaque to its holder", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, validManifestJson(), "utf-8");
      const authority = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "migration-1",
      );

      expect("acceptDescendant" in authority).toBe(false);
      expect("getLastAcceptedBytes" in authority).toBe(false);
      await writeFile(manifestPath, "drifted", "utf-8");
      await expect(
        saveManifest(manifestPath, emptyManifest(), {
          authority,
          operationId: "migration-1",
        }),
      ).rejects.toThrow("changed since its last accepted save");
      await releaseManifestBackupAuthority(authority);
    });

    it("cleans a failed replacement temp while preserving its verified backup", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const original = validManifestJson();
      await writeFile(manifestPath, original, "utf-8");
      const authority = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "migration-1",
      );
      await expect(
        withManifestPersistenceFaultsForTesting(
          (stage) => {
            if (stage === "replacement-write")
              throw new Error("injected write");
          },
          () =>
            saveManifest(manifestPath, emptyManifest(), {
              authority,
              operationId: "migration-1",
            }),
        ),
      ).rejects.toThrow("injected write");
      expect(await readFile(manifestPath, "utf-8")).toBe(original);
      expect(await readFile(authority.backupPath, "utf-8")).toBe(original);
      await releaseManifestBackupAuthority(authority);
    });

    it("rejects an operation identity without authority", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");

      await expect(
        saveManifest(manifestPath, emptyManifest(), { operationId: "orphan" }),
      ).rejects.toThrow("requires an authority");
      expect(await pathExists(manifestPath)).toBe(false);
    });

    it("rejects an unguarded save that removes a loaded record", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const existing = {
        ...emptyManifest(),
        records: [
          {
            target: "claude" as const,
            type: "skill" as const,
            sourcePath: "/source/helper",
            generatedPath: null,
            installedPath: "/installed/helper",
            installMode: "copy" as const,
            contentHash: "abc",
            timestamp: "2026-07-17T00:00:00.000Z",
          },
        ],
      };
      await saveManifest(manifestPath, existing);

      await expect(saveManifest(manifestPath, emptyManifest())).rejects.toThrow(
        "removal or migration save requires an authority",
      );
      expect((await loadManifest(manifestPath)).records).toHaveLength(1);
    });

    it("requires an authority for every boundary or identity-tuple transition", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const boundary = {
        claudeSkillsHome: "/homes/claude/skills",
        claudeAgentsHome: "/homes/claude/agents",
        codexSkillsHome: "/homes/codex/skills",
        codexAgentsHome: "/homes/codex/agents",
      };
      const current = {
        ...emptyManifest(),
        boundary,
        records: [
          {
            target: "claude" as const,
            type: "agent" as const,
            name: "helper",
            sourcePath: "/source/helper.yaml",
            generatedPath: "/generated/helper.md",
            installedPath: "/homes/claude/agents/helper.md",
            installMode: "copy" as const,
            contentHash: "old",
            timestamp: "2026-07-17T00:00:00.000Z",
          },
        ],
      };
      await saveManifest(manifestPath, current);

      for (const proposed of [
        {
          ...current,
          boundary: undefined,
          records: current.records.map(({ name: _name, ...record }) => record),
        },
        {
          ...current,
          boundary: { ...boundary, codexAgentsHome: "/other/codex/agents" },
        },
        {
          ...current,
          records: [{ ...current.records[0], target: "codex" as const }],
        },
        {
          ...current,
          records: [{ ...current.records[0], type: "skill" as const }],
        },
        {
          ...current,
          records: [{ ...current.records[0], name: "renamed" }],
        },
      ]) {
        await expect(saveManifest(manifestPath, proposed)).rejects.toThrow(
          "removal or migration save requires an authority",
        );
      }
    });

    it("checks a concurrent unguarded save against the fresh locked manifest", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const original = {
        ...emptyManifest(),
        records: [
          {
            target: "claude" as const,
            type: "skill" as const,
            sourcePath: "/source/a",
            generatedPath: null,
            installedPath: "/installed/a",
            installMode: "copy" as const,
            contentHash: "old",
            timestamp: "2026-07-17T00:00:00.000Z",
          },
        ],
      };
      const newerRecord = {
        ...original.records[0],
        installedPath: "/installed/b",
        sourcePath: "/source/b",
      };
      await saveManifest(manifestPath, original);
      let pauseFirst = true;
      let markPaused!: () => void;
      let resume!: () => void;
      const paused = new Promise<void>((resolve) => {
        markPaused = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });

      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage === "save-before-lock" && pauseFirst) {
            pauseFirst = false;
            markPaused();
            await gate;
          }
        },
        async () => {
          const staleSave = saveManifest(manifestPath, {
            ...original,
            records: [{ ...original.records[0], contentHash: "stale-update" }],
          });
          await paused;
          await saveManifest(manifestPath, {
            ...original,
            records: [...original.records, newerRecord],
          });
          resume();
          await expect(staleSave).rejects.toThrow(
            "removal or migration save requires an authority",
          );
        },
      );
      expect((await loadManifest(manifestPath)).records).toHaveLength(2);
    });

    it("closes an authority to new work before awaiting its in-flight save", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, validManifestJson(), "utf-8");
      const authority = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "migration-1",
      );
      let markWriting!: () => void;
      let resume!: () => void;
      const writing = new Promise<void>((resolve) => {
        markWriting = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });

      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage === "replacement-write") {
            markWriting();
            await gate;
          }
        },
        async () => {
          const inFlight = saveManifest(manifestPath, emptyManifest(), {
            authority,
            operationId: "migration-1",
          });
          await writing;
          const releasing = releaseManifestBackupAuthority(authority);
          await expect(
            saveManifest(manifestPath, emptyManifest(), {
              authority,
              operationId: "migration-1",
            }),
          ).rejects.toThrow("closing");
          await expect(
            createManifestBackupAuthority(
              manifestPath,
              await captureManifestSnapshot(manifestPath),
              "migration-2",
            ),
          ).rejects.toThrow("already has an active");
          resume();
          await inFlight;
          await releasing;
        },
      );
      const next = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "migration-2",
      );
      await releaseManifestBackupAuthority(next);
    });

    it.each([
      "backup-open",
      "backup-write",
      "backup-sync",
      "backup-close",
      "backup-readback",
    ] as const)(
      "cleans every failed %s backup stage and releases the operation lock",
      async (faultStage) => {
        const manifestPath = path.join(tempDir, `backup-${faultStage}.json`);
        const original = validManifestJson();
        await writeFile(manifestPath, original, "utf-8");
        const snapshot = await captureManifestSnapshot(manifestPath);

        await expect(
          withManifestPersistenceFaultsForTesting(
            (stage) => {
              if (stage === faultStage) throw new Error(`fault ${stage}`);
            },
            () =>
              createManifestBackupAuthority(
                manifestPath,
                snapshot,
                "failed-backup",
              ),
          ),
        ).rejects.toThrow(`fault ${faultStage}`);

        expect(await readFile(manifestPath, "utf-8")).toBe(original);
        expect(
          (await readdir(tempDir)).filter((name) => name.includes(".backup-")),
        ).toEqual([]);
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
        const next = await createManifestBackupAuthority(
          manifestPath,
          await captureManifestSnapshot(manifestPath),
          "after-fault",
        );
        await releaseManifestBackupAuthority(next);
      },
    );

    it.each([
      "replacement-write",
      "replacement-sync",
      "replacement-close",
      "replacement-freshness",
      "replacement-rename",
    ] as const)(
      "cleans every failed %s replacement stage while preserving its verified backup",
      async (faultStage) => {
        const manifestPath = path.join(
          tempDir,
          `replacement-${faultStage}.json`,
        );
        const original = validManifestJson();
        await writeFile(manifestPath, original, "utf-8");
        const authority = await createManifestBackupAuthority(
          manifestPath,
          await captureManifestSnapshot(manifestPath),
          "replacement-fault",
        );

        await expect(
          withManifestPersistenceFaultsForTesting(
            (stage) => {
              if (stage === faultStage) throw new Error(`fault ${stage}`);
            },
            () =>
              saveManifest(manifestPath, emptyManifest(), {
                authority,
                operationId: "replacement-fault",
              }),
          ),
        ).rejects.toThrow(`fault ${faultStage}`);

        expect(await readFile(manifestPath, "utf-8")).toBe(original);
        expect(await readFile(authority.backupPath, "utf-8")).toBe(original);
        expect(
          (await readdir(tempDir)).filter((name) => name.includes(".tmp.")),
        ).toEqual([]);
        await releaseManifestBackupAuthority(authority);
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
        await saveManifest(manifestPath, emptyManifest());
      },
    );

    it("rejects duplicate authority creation and permits a new operation after expiry", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, validManifestJson(), "utf-8");
      const snapshot = await captureManifestSnapshot(manifestPath);
      const first = await createManifestBackupAuthority(
        manifestPath,
        snapshot,
        "migration-1",
      );

      await expect(
        createManifestBackupAuthority(manifestPath, snapshot, "migration-2"),
      ).rejects.toThrow("already has an active");
      await releaseManifestBackupAuthority(first);

      const second = await createManifestBackupAuthority(
        manifestPath,
        snapshot,
        "migration-2",
      );
      await releaseManifestBackupAuthority(second);
    });

    it("rejects directory and symlink sources before backup creation", async () => {
      const directoryPath = path.join(tempDir, "directory-manifest");
      await mkdir(directoryPath);
      await expect(captureManifestSnapshot(directoryPath)).rejects.toThrow(
        "regular file",
      );

      if (!(await canCreateSymlinks())) return;
      const sourcePath = path.join(tempDir, "source.json");
      const symlinkPath = path.join(tempDir, "manifest.json");
      await writeFile(sourcePath, validManifestJson(), "utf-8");
      await symlink(sourcePath, symlinkPath, "file");
      await expect(captureManifestSnapshot(symlinkPath)).rejects.toThrow(
        "regular file",
      );
    });

    it("creates one byte-verified collision-safe backup before guarded rewrites", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const original = validManifestJson();
      await writeFile(manifestPath, original, "utf-8");
      const snapshot = await captureManifestSnapshot(manifestPath);
      const timestamp = new Date("2026-07-17T01:02:03.456Z");
      const baseBackup = `${manifestPath}.backup-2026-07-17T01-02-03.456Z`;
      await writeFile(baseBackup, "occupied", "utf-8");
      await writeFile(`${baseBackup}-1`, "occupied", "utf-8");

      const authority = await createManifestBackupAuthority(
        manifestPath,
        snapshot,
        "migration-1",
        timestamp,
      );

      expect(authority.backupPath).toBe(`${baseBackup}-2`);
      expect(await readFile(authority.backupPath, "utf-8")).toBe(original);
      expect(() => JSON.stringify(authority)).toThrow("must not be serialized");

      await saveManifest(manifestPath, emptyManifest(), {
        authority,
        operationId: "migration-1",
      });
      await saveManifest(
        manifestPath,
        {
          ...emptyManifest(),
          lastSync: "2026-07-17T02:00:00.000Z",
        },
        { authority, operationId: "migration-1" },
      );

      expect(await readFile(authority.backupPath, "utf-8")).toBe(original);
      await releaseManifestBackupAuthority(authority);
    });

    it("rejects authority creation when the source drifts after backup readback", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const original = validManifestJson();
      await writeFile(manifestPath, original, "utf-8");
      const snapshot = await captureManifestSnapshot(manifestPath);
      const timestamp = new Date("2026-07-17T01:02:03.456Z");
      const backupPath = `${manifestPath}.backup-2026-07-17T01-02-03.456Z`;

      await expect(
        withManifestPersistenceFaultsForTesting(
          async (stage) => {
            if (stage === "backup-readback") {
              await writeFile(manifestPath, `${original}drifted`, "utf-8");
            }
          },
          () =>
            createManifestBackupAuthority(
              manifestPath,
              snapshot,
              "migration-1",
              timestamp,
            ),
        ),
      ).rejects.toThrow("changed while its backup was verified");

      expect(await readFile(manifestPath, "utf-8")).toBe(`${original}drifted`);
      expect(await pathExists(backupPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("fails closed when the source changes before backup creation", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, validManifestJson(), "utf-8");
      const snapshot = await captureManifestSnapshot(manifestPath);
      await writeFile(manifestPath, `${validManifestJson()}drifted`, "utf-8");

      await expect(
        createManifestBackupAuthority(manifestPath, snapshot, "migration-1"),
      ).rejects.toThrow("changed since it was loaded");
      expect(await readFile(manifestPath, "utf-8")).toBe(
        `${validManifestJson()}drifted`,
      );
    });

    it("rejects a snapshot whose bytes and digest do not agree", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, validManifestJson(), "utf-8");
      const snapshot = await captureManifestSnapshot(manifestPath);

      await expect(
        createManifestBackupAuthority(
          manifestPath,
          { ...snapshot, digest: "forged" },
          "migration-1",
        ),
      ).rejects.toThrow("schema-valid load snapshot");
      expect(await readFile(manifestPath, "utf-8")).toBe(validManifestJson());
    });

    it("requires the same live authority and a fresh descendant for every guarded save", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, validManifestJson(), "utf-8");
      const authority = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "migration-1",
      );

      await expect(saveManifest(manifestPath, emptyManifest())).rejects.toThrow(
        "requires its active backup authority",
      );
      await expect(
        saveManifest(manifestPath, emptyManifest(), {
          authority,
          operationId: "wrong-operation",
        }),
      ).rejects.toThrow("operation mismatch");

      await saveManifest(manifestPath, emptyManifest(), {
        authority,
        operationId: "migration-1",
      });
      const saved = await readFile(manifestPath, "utf-8");
      await writeFile(manifestPath, `${saved}drift`, "utf-8");

      await expect(
        saveManifest(manifestPath, emptyManifest(), {
          authority,
          operationId: "migration-1",
        }),
      ).rejects.toThrow("changed since its last accepted save");
      await releaseManifestBackupAuthority(authority);
    });

    it("rejects released and wrong-path authorities without mutating a manifest", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const otherManifestPath = path.join(tempDir, "other.json");
      await writeFile(manifestPath, validManifestJson(), "utf-8");
      await writeFile(otherManifestPath, validManifestJson(), "utf-8");
      const authority = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "migration-1",
      );

      await expect(
        saveManifest(otherManifestPath, emptyManifest(), {
          authority,
          operationId: "migration-1",
        }),
      ).rejects.toThrow("different manifest path");
      await releaseManifestBackupAuthority(authority);
      await expect(
        saveManifest(manifestPath, emptyManifest(), {
          authority,
          operationId: "migration-1",
        }),
      ).rejects.toThrow("no longer active");
      expect(await readFile(manifestPath, "utf-8")).toBe(validManifestJson());
    });

    it("creates parent directories if they do not exist", async () => {
      const manifestPath = path.join(
        tempDir,
        "nested",
        "deep",
        "manifest.json",
      );
      const manifest = emptyManifest();

      await saveManifest(manifestPath, manifest);

      expect(await pathExists(manifestPath)).toBe(true);
    });

    it("round-trips with loadManifest preserving records and fields", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const manifest = {
        version: 1 as const,
        managedBy: "devcanon" as const,
        lastSync: "2026-03-15T10:30:00.000Z",
        boundary: {
          claudeSkillsHome: "/home/claude/skills",
          claudeAgentsHome: "/home/claude/agents",
          codexSkillsHome: "/home/codex/skills",
          codexAgentsHome: "/home/codex/agents",
        },
        records: [
          {
            target: "claude" as const,
            type: "skill" as const,
            name: "my-skill",
            sourcePath: "/src/skills/my-skill",
            generatedPath: null,
            installedPath: "/home/claude/skills/my-skill",
            installMode: "symlink" as const,
            contentHash: "def456",
            timestamp: "2026-03-15T10:30:00.000Z",
          },
          {
            target: "codex" as const,
            type: "agent" as const,
            name: "helper",
            sourcePath: "/src/agents/helper.yaml",
            generatedPath: "/gen/codex/agents/helper.toml",
            installedPath: "/home/codex/agents/helper.toml",
            installMode: "copy" as const,
            contentHash: "ghi789",
            timestamp: "2026-03-15T10:30:00.000Z",
          },
        ],
      };

      await saveManifest(manifestPath, manifest);
      const loaded = await loadManifest(manifestPath);

      expect(loaded.version).toBe(1);
      expect(loaded.managedBy).toBe("devcanon");
      expect(loaded.lastSync).toBe("2026-03-15T10:30:00.000Z");
      expect(loaded.boundary).toEqual(manifest.boundary);
      expect(loaded.records).toHaveLength(2);
      expect(loaded.records[0].target).toBe("claude");
      expect(loaded.records[0].type).toBe("skill");
      expect(loaded.records[0].generatedPath).toBeNull();
      expect(loaded.records[0].installMode).toBe("symlink");
      expect(loaded.records[0].contentHash).toBe("def456");
      expect(loaded.records[0].name).toBe("my-skill");
      expect(loaded.records[1].target).toBe("codex");
      expect(loaded.records[1].type).toBe("agent");
      expect(loaded.records[1].contentHash).toBe("ghi789");
      expect(loaded.records[1].name).toBe("helper");
    });

    it("permits an authorized overwrite that changes a record identity tuple", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const first = {
        version: 1 as const,
        managedBy: "devcanon" as const,
        lastSync: "2026-01-01T00:00:00.000Z",
        records: [
          {
            target: "claude" as const,
            type: "agent" as const,
            sourcePath: "/src/agents/old.yaml",
            generatedPath: "/gen/claude/agents/old.md",
            installedPath: "/installed/old.md",
            installMode: "copy" as const,
            contentHash: "old-hash",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      const second = {
        version: 1 as const,
        managedBy: "devcanon" as const,
        lastSync: "2026-06-01T00:00:00.000Z",
        records: [
          {
            target: "codex" as const,
            type: "skill" as const,
            sourcePath: "/src/skills/new",
            generatedPath: null,
            installedPath: "/installed/old.md",
            installMode: "symlink" as const,
            contentHash: "new-hash",
            timestamp: "2026-06-01T00:00:00.000Z",
          },
        ],
      };

      await saveManifest(manifestPath, first);
      const authority = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "identity-migration",
      );
      await saveManifest(manifestPath, second, {
        authority,
        operationId: "identity-migration",
      });
      await releaseManifestBackupAuthority(authority);
      const loaded = await loadManifest(manifestPath);

      expect(loaded.records).toHaveLength(1);
      expect(loaded.records[0].target).toBe("codex");
      expect(loaded.records[0].contentHash).toBe("new-hash");
      expect(loaded.lastSync).toBe("2026-06-01T00:00:00.000Z");
    });
  });
});
