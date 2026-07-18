import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createTempDir,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../__test-helpers__/logger.js";
import { UserError } from "../utils/errors.js";
import { pathExists } from "../utils/fs.js";
import {
  captureManifestSnapshot,
  createManifestBackupAuthority,
  emptyManifest,
  inspectManifest,
  loadManifest,
  loadManifestWithSnapshot,
  recoverInvalidManifest,
  releaseManifestBackupAuthority,
  saveManifest,
  withManifestPersistenceFaultsForTesting,
} from "./manifest.js";

type PersistenceProbeSample =
  | { kind: "stat-ok"; identity: { dev: number; ino: number } }
  | { kind: "stat-rejected"; error: unknown }
  | { kind: "present"; identity: { dev: number; ino: number } }
  | { kind: "absent" }
  | { kind: "lstat-error"; error: unknown };

type PersistenceErrorEvidence = {
  kind: "error" | "unknown" | "unreadable";
  name?: string;
  message?: string;
  code?: string;
  type?: string;
};

type PersistenceObservation = {
  attemptId: number;
  operation: "candidate-close" | "recovery-lock-close" | "recovery-lock-unlink";
  targetPath: string;
  primitive: { status: "fulfilled" } | { status: "rejected"; error: unknown };
  before: PersistenceProbeSample;
  after: PersistenceProbeSample;
  atoms: readonly {
    kind: "primitive" | "synthetic";
    error: PersistenceErrorEvidence;
  }[];
};

type PersistenceHarnessDiagnostics = {
  observations: readonly PersistenceObservation[];
  errors: readonly PersistenceErrorEvidence[];
  combinationProbes: readonly {
    atoms: readonly {
      kind: "primary" | "primitive" | "synthetic";
      label: string;
    }[];
  }[];
};

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
  const runExecFile = promisify(execFile);

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

    it("returns empty manifest with no recovery artifacts when file does not exist", async () => {
      const manifestPath = path.join(tempDir, "nonexistent.json");

      const { manifest, snapshot } =
        await loadManifestWithSnapshot(manifestPath);

      expect(manifest.version).toBe(1);
      expect(manifest.managedBy).toBe("devcanon");
      expect(manifest.records).toEqual([]);
      expect(manifest.lastSync).toBeDefined();
      expect(snapshot).toBeNull();
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("does not classify source absence with a residual sibling lock as absent", async () => {
      const manifestPath = path.join(tempDir, "nonexistent.json");
      await writeFile(`${manifestPath}.lock`, "active", "utf-8");

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toThrow(
        `${manifestPath}.lock`,
      );
      expect(await pathExists(`${manifestPath}.lock`)).toBe(true);
      expect(await readFile(`${manifestPath}.lock`, "utf-8")).toBe("active");
      expect(await readdir(tempDir)).toEqual(["nonexistent.json.lock"]);
    });

    it("throws UserError for a residual lock and preserves its one-shot recovery disposition", async () => {
      const manifestPath = path.join(tempDir, "missing-with-lock.json");
      await writeFile(`${manifestPath}.lock`, "active", "utf-8");

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError &&
          error.filePath === manifestPath &&
          error.hint?.includes("explicitly recover") === true,
      );
      const inspection = await inspectManifest(manifestPath);
      const recovery = await recoverInvalidManifest(inspection);
      expect(recovery).toMatchObject({
        completed: false,
        category: "lock-unavailable",
        candidate: { status: "none-created" },
        lock: {
          status: "pre-existing-blocker",
          path: `${manifestPath}.lock`,
        },
      });
      await expect(recoverInvalidManifest(inspection)).rejects.toThrow(
        "requires an invalid inspection",
      );
      expect(await pathExists(`${manifestPath}.lock`)).toBe(true);
    });

    it("turns a genuine residual-lock inspection into one-shot lock-unavailable recovery", async () => {
      const manifestPath = path.join(tempDir, "genuine-residual-lock.json");
      await writeFile(`${manifestPath}.lock`, "active", "utf-8");

      const inspection = await inspectManifest(manifestPath);
      await expect(recoverInvalidManifest(inspection)).resolves.toMatchObject({
        completed: false,
        category: "lock-unavailable",
        candidate: { status: "none-created" },
        lock: {
          status: "pre-existing-blocker",
          path: `${manifestPath}.lock`,
        },
      });
      await expect(recoverInvalidManifest(inspection)).rejects.toThrow(
        "requires an invalid inspection",
      );
    });

    it("rejects a directory manifest without recovery artifacts", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await mkdir(manifestPath);

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toThrow();

      expect((await lstat(manifestPath)).isDirectory()).toBe(true);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(await readdir(tempDir)).toEqual(["manifest.json"]);
    });

    it.skipIf(process.platform === "win32")(
      "rejects FIFO source and lock pathnames without blocking or mutating",
      async () => {
        const sourcePath = path.join(tempDir, "fifo-source.json");
        const lockManifestPath = path.join(tempDir, "fifo-lock.json");
        await runExecFile("mkfifo", [sourcePath]);
        await runExecFile("mkfifo", [`${lockManifestPath}.lock`]);

        await expect(
          loadManifestWithSnapshot(sourcePath),
        ).rejects.toBeInstanceOf(UserError);
        await expect(
          loadManifestWithSnapshot(lockManifestPath),
        ).rejects.toBeInstanceOf(UserError);
        expect((await lstat(sourcePath)).isFIFO()).toBe(true);
        expect((await lstat(`${lockManifestPath}.lock`)).isFIFO()).toBe(true);
        expect(await pathExists(`${sourcePath}.bak`)).toBe(false);
        expect(await pathExists(`${lockManifestPath}.bak`)).toBe(false);
        expect((await readdir(tempDir)).sort()).toEqual(
          ["fifo-lock.json.lock", "fifo-source.json"].sort(),
        );
      },
    );

    it("throws UserError for an unsafe source and preserves its one-shot recovery disposition", async () => {
      const manifestPath = path.join(tempDir, "unsafe-manifest.json");
      await mkdir(manifestPath);

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError &&
          error.filePath === manifestPath &&
          error.hint?.includes("explicitly recover") === true,
      );
      const inspection = await inspectManifest(manifestPath);
      const recovery = await recoverInvalidManifest(inspection);
      expect(recovery).toMatchObject({
        completed: false,
        category: "source-unavailable-or-unsafe",
        candidate: { status: "none-created" },
        lock: {
          status: "not-inspected-or-not-owned",
          path: `${manifestPath}.lock`,
        },
      });
      await expect(recoverInvalidManifest(inspection)).rejects.toThrow(
        "requires an invalid inspection",
      );
      expect((await lstat(manifestPath)).isDirectory()).toBe(true);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
    });

    it("turns a genuine unsafe-source inspection into one-shot source-unavailable recovery", async () => {
      const manifestPath = path.join(tempDir, "genuine-unsafe-source.json");
      await mkdir(manifestPath);

      const inspection = await inspectManifest(manifestPath);
      await expect(recoverInvalidManifest(inspection)).resolves.toMatchObject({
        completed: false,
        category: "source-unavailable-or-unsafe",
        candidate: { status: "none-created" },
        lock: {
          status: "not-inspected-or-not-owned",
          path: `${manifestPath}.lock`,
        },
      });
      await expect(recoverInvalidManifest(inspection)).rejects.toThrow(
        "requires an invalid inspection",
      );
    });

    it("rejects a direct symlink manifest without recovery artifacts", async ({
      skip,
    }) => {
      if (!(await canCreateSymlinks())) skip();
      const sourcePath = path.join(tempDir, "source.json");
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(sourcePath, validManifestJson(), "utf-8");
      await symlink(sourcePath, manifestPath, "file");

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toThrow();

      expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true);
      expect(await readFile(sourcePath, "utf-8")).toBe(validManifestJson());
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect((await readdir(tempDir)).sort()).toEqual(
        ["manifest.json", "source.json"].sort(),
      );
    });

    it("rejects a dangling symlink manifest without recovery artifacts", async ({
      skip,
    }) => {
      if (!(await canCreateSymlinks())) skip();
      const manifestPath = path.join(tempDir, "manifest.json");
      await symlink("missing-manifest.json", manifestPath, "file");

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toThrow();

      expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(manifestPath)).toBe("missing-manifest.json");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(await readdir(tempDir)).toEqual(["manifest.json"]);
    });

    it("rejects an unreadable existing ENOENT-named manifest when permissions are enforced", async ({
      skip,
    }) => {
      const manifestPath = path.join(tempDir, "ENOENT-manifest.json");
      const original = validManifestJson();
      await writeFile(manifestPath, original, "utf-8");
      await chmod(manifestPath, 0o000);

      let permissionsEnforced = false;
      try {
        try {
          await readFile(manifestPath);
        } catch {
          permissionsEnforced = true;
          await expect(
            loadManifestWithSnapshot(manifestPath),
          ).rejects.toThrow();
          await expect(
            saveManifest(manifestPath, emptyManifest()),
          ).rejects.toThrow("readable regular file");
          expect((await lstat(manifestPath)).isFile()).toBe(true);
          expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
          expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
        }
      } finally {
        await chmod(manifestPath, 0o600);
      }

      if (!permissionsEnforced) skip();
      expect(await readFile(manifestPath, "utf-8")).toBe(original);
      expect(await readdir(tempDir)).toEqual(["ENOENT-manifest.json"]);
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

    it("fails actionably and leaves corrupt JSON byte/artifact pure", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const corruptContent = "{not valid json!!!";
      await writeFile(manifestPath, corruptContent, "utf-8");

      await expect(loadManifest(manifestPath)).rejects.toThrow("invalid");
      await expect(loadManifest(manifestPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError &&
          error.filePath === manifestPath &&
          error.hint?.includes("explicitly recover") === true,
      );
      const inspection = await inspectManifest(manifestPath);
      expect(inspection).toMatchObject({ status: "invalid" });
      expect("manifest" in inspection).toBe(false);
      expect(await readFile(manifestPath, "utf-8")).toBe(corruptContent);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(testLogger.warnings).toEqual([]);
    });

    it("preserves caught JSON causes and bounded schema classification causes", async () => {
      const jsonPath = path.join(tempDir, "json-cause.json");
      const schemaPath = path.join(tempDir, "schema-cause.json");
      await writeFile(jsonPath, "{corrupt", "utf-8");
      await writeFile(
        schemaPath,
        JSON.stringify({
          version: 2,
          managedBy: "devcanon",
          lastSync: "2026-07-17T00:00:00.000Z",
          records: [],
        }),
        "utf-8",
      );

      await expect(loadManifestWithSnapshot(jsonPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError && error.cause instanceof SyntaxError,
      );
      await expect(loadManifestWithSnapshot(schemaPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError &&
          error.cause instanceof Error &&
          error.cause.message === "Manifest schema validation failed",
      );
      expect((await readdir(tempDir)).sort()).toEqual(
        ["json-cause.json", "schema-cause.json"].sort(),
      );
    });

    it("attaches the trusted invalid source failure as the UserError cause", async () => {
      const manifestPath = path.join(tempDir, "cause-manifest.json");
      await mkdir(manifestPath);

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError && error.cause instanceof Error,
      );
    });

    it("does not reclaim an unsafe sibling lock while the source is absent", async () => {
      const manifestPath = path.join(
        tempDir,
        "missing-with-directory-lock.json",
      );
      await mkdir(`${manifestPath}.lock`);

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toThrow(
        `${manifestPath}.lock`,
      );
      expect((await lstat(`${manifestPath}.lock`)).isDirectory()).toBe(true);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await readdir(tempDir)).toEqual([
        "missing-with-directory-lock.json.lock",
      ]);
    });

    async function assertRejectedSiblingLockSymlink(
      kind: "direct" | "dangling",
      linkTarget: string,
    ): Promise<void> {
      const manifestPath = path.join(tempDir, `${kind}-lock.json`);
      const lockPath = `${manifestPath}.lock`;
      const targetPath = path.join(tempDir, linkTarget);
      if (kind === "direct") await writeFile(targetPath, "sentinel", "utf-8");
      await symlink(linkTarget, lockPath, "file");

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError && error.filePath === manifestPath,
      );
      const inspection = await inspectManifest(manifestPath);
      await expect(recoverInvalidManifest(inspection)).resolves.toMatchObject({
        completed: false,
        category: "lock-unavailable",
        candidate: { status: "none-created" },
        lock: { status: "pre-existing-blocker", path: lockPath },
      });

      expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(lockPath)).toBe(linkTarget);
      if (kind === "direct") {
        expect(await readFile(targetPath, "utf-8")).toBe("sentinel");
      } else {
        expect(await pathExists(targetPath)).toBe(false);
      }
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect((await readdir(tempDir)).sort()).toEqual(
        (kind === "direct"
          ? [`${kind}-lock.json.lock`, linkTarget]
          : [`${kind}-lock.json.lock`]
        ).sort(),
      );
    }

    it("rejects a direct sibling-lock symlink without following or mutating it", async ({
      skip,
    }) => {
      if (!(await canCreateSymlinks())) skip();
      await assertRejectedSiblingLockSymlink("direct", "lock-target");
    });

    it("rejects a dangling sibling-lock symlink without following or mutating it", async ({
      skip,
    }) => {
      if (!(await canCreateSymlinks())) skip();
      await assertRejectedSiblingLockSymlink("dangling", "missing-lock-target");
    });

    it("fails actionably and leaves schema-invalid JSON byte/artifact pure", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const invalidSchema = {
        version: 2,
        managedBy: "devcanon",
        lastSync: "2026-01-01T00:00:00.000Z",
        records: [],
      };
      const invalidContent = JSON.stringify(invalidSchema, null, 2);
      await writeFile(manifestPath, invalidContent, "utf-8");

      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toThrow(
        "invalid",
      );
      await expect(loadManifestWithSnapshot(manifestPath)).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof UserError &&
          error.filePath === manifestPath &&
          error.hint?.includes("explicitly recover") === true,
      );
      expect(await readFile(manifestPath, "utf-8")).toBe(invalidContent);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(testLogger.warnings).toEqual([]);
    });

    it("recovers only inspected invalid bytes to the first unoccupied exact backup", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const invalidBytes = Buffer.from("{corrupt", "utf-8");
      await writeFile(manifestPath, invalidBytes);
      await writeFile(`${manifestPath}.bak`, "occupied", "utf-8");

      const inspection = await inspectManifest(manifestPath);
      expect(inspection.status).toBe("invalid");
      const recovery = await recoverInvalidManifest(inspection);

      expect(recovery).toEqual({
        completed: true,
        backupPath: `${manifestPath}.bak-1`,
        cleanup: "clean",
      });
      expect(await pathExists(manifestPath)).toBe(false);
      expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe("occupied");
      expect(await readFile(`${manifestPath}.bak-1`)).toEqual(invalidBytes);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      await expect(recoverInvalidManifest(inspection)).rejects.toThrow(
        "requires an invalid inspection",
      );
    });

    it("recovers schema-invalid inspected bytes exactly", async () => {
      const manifestPath = path.join(tempDir, "schema-invalid.json");
      const invalidBytes = Buffer.from(
        JSON.stringify({
          version: 2,
          managedBy: "devcanon",
          lastSync: "2026-07-17T00:00:00.000Z",
          records: [],
        }),
        "utf-8",
      );
      await writeFile(manifestPath, invalidBytes);
      const inspection = await inspectManifest(manifestPath);

      const recovery = await recoverInvalidManifest(inspection);

      expect(recovery).toEqual({
        completed: true,
        backupPath: `${manifestPath}.bak`,
        cleanup: "clean",
      });
      expect(await readFile(`${manifestPath}.bak`)).toEqual(invalidBytes);
      expect(await pathExists(manifestPath)).toBe(false);
    });

    it("preserves schema-invalid bytes and exact dispositions on pre-I5 retirement failure", async () => {
      const manifestPath = path.join(tempDir, "schema-retirement-failure.json");
      const invalidBytes = Buffer.from(
        JSON.stringify({
          version: 2,
          managedBy: "devcanon",
          lastSync: "2026-07-17T00:00:00.000Z",
          records: [],
        }),
        "utf-8",
      );
      await writeFile(manifestPath, invalidBytes);
      const inspection = await inspectManifest(manifestPath);
      const primary = new Error("schema retirement fault");

      const recovery = await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-retirement") throw primary;
        },
        () => recoverInvalidManifest(inspection),
      );

      expect(recovery).toEqual({
        completed: false,
        category: "source-retirement-failed",
        cause: primary,
        cleanup: "clean",
        candidate: {
          status: "owned-removed",
          path: `${manifestPath}.bak`,
        },
        lock: {
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        },
      });
      expect(await readFile(manifestPath)).toEqual(invalidBytes);
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(await readdir(tempDir)).toEqual([
        "schema-retirement-failure.json",
      ]);
    });

    it("rejects forged and copied invalid inspection objects without authority", async () => {
      const manifestPath = path.join(tempDir, "forged-invalid.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const genuine = await inspectManifest(manifestPath);
      if (genuine.status !== "invalid") throw new Error("expected invalid");
      const copied = { ...genuine };
      const forged = { status: "invalid" as const, message: genuine.message };

      await expect(
        recoverInvalidManifest(copied as typeof genuine),
      ).rejects.toThrow("requires an invalid inspection");
      await expect(recoverInvalidManifest(forged)).rejects.toThrow(
        "requires an invalid inspection",
      );
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
    });

    it("does not recover a stale invalid observation or leak its owned candidate", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      await writeFile(manifestPath, "{replacement", "utf-8");

      const recovery = await recoverInvalidManifest(inspection);

      expect(recovery.completed).toBe(false);
      if (!recovery.completed) {
        expect(recovery.category).toBe("source-changed");
        expect(recovery.candidate).toEqual({ status: "none-created" });
        expect(recovery.lock).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        });
      }
      expect(await readFile(manifestPath, "utf-8")).toBe("{replacement");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("reports source drift after candidate verification without a backup result", async () => {
      const manifestPath = path.join(tempDir, "drift-after-candidate.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);

      const recovery = await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage === "recovery-after-candidate") {
            await writeFile(manifestPath, "{replacement", "utf-8");
          }
        },
        () => recoverInvalidManifest(inspection),
      );

      expect(recovery.completed).toBe(false);
      if (!recovery.completed) {
        expect(recovery.category).toBe("source-changed");
        expect(recovery.candidate).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.bak`,
        });
        expect(recovery.lock).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        });
        expect("backupPath" in recovery).toBe(false);
      }
      expect(await readFile(manifestPath, "utf-8")).toBe("{replacement");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("deletes only the identity-bound candidate after the source becomes unsafe", async ({
      skip,
    }) => {
      if (!(await canCreateSymlinks())) skip();
      const manifestPath = path.join(tempDir, "unsafe-after-candidate.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const observations: PersistenceObservation[] = [];

      const recovery = await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage === "recovery-after-candidate") {
            await unlink(manifestPath);
            await symlink("missing-manifest.json", manifestPath, "file");
          }
        },
        () => recoverInvalidManifest(inspection),
        {
          observe: (observation: PersistenceObservation) => {
            observations.push(observation);
          },
        },
      );

      expect(recovery.completed).toBe(false);
      if (!recovery.completed) {
        expect(recovery.category).toBe("source-unavailable-or-unsafe");
        expect(recovery.candidate).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.bak`,
        });
        expect(recovery.lock).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        });
      }
      expect((await lstat(manifestPath)).isSymbolicLink()).toBe(true);
      expect(observations.map(({ operation }) => operation)).toEqual([
        "candidate-close",
        "recovery-lock-close",
        "recovery-lock-unlink",
      ]);
      expect(observations[0]).toMatchObject({
        targetPath: `${manifestPath}.bak`,
        before: { kind: "stat-ok" },
        primitive: { status: "fulfilled" },
        after: { kind: "stat-rejected" },
      });
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(await readdir(tempDir)).toEqual(["unsafe-after-candidate.json"]);
    });

    it.each([
      "recovery-candidate-open",
      "recovery-candidate-write",
      "recovery-candidate-sync",
      "recovery-candidate-close",
      "recovery-candidate-readback",
    ] as const)(
      "keeps the source and cleans its owned candidate when %s fails",
      async (faultStage) => {
        const manifestPath = path.join(tempDir, `${faultStage}.json`);
        await writeFile(manifestPath, "{corrupt", "utf-8");
        const inspection = await inspectManifest(manifestPath);

        const recovery = await withManifestPersistenceFaultsForTesting(
          (stage) => {
            if (stage === faultStage) throw new Error(`fault ${stage}`);
          },
          () => recoverInvalidManifest(inspection),
        );

        expect(recovery.completed).toBe(false);
        if (!recovery.completed) {
          expect(recovery.category).toBe("backup-create-or-verify-failed");
          expect(recovery.cause).toEqual(new Error(`fault ${faultStage}`));
          expect(recovery.candidate).toEqual(
            faultStage === "recovery-candidate-open"
              ? { status: "none-created" }
              : {
                  status: "owned-removed",
                  path: `${manifestPath}.bak`,
                },
          );
          expect(recovery.lock).toEqual({
            status: "owned-removed",
            path: `${manifestPath}.lock`,
          });
          expect("backupPath" in recovery).toBe(false);
        }
        expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
        expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      },
    );

    it("retains an unverifiable provisional candidate after the bounded pre-stat custody fault", async () => {
      const manifestPath = path.join(tempDir, "candidate-stat.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const observations: PersistenceObservation[] = [];

      const recovery = await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === ("recovery-candidate-stat" as typeof stage)) {
            throw new Error("candidate stat fault");
          }
        },
        () => recoverInvalidManifest(inspection),
        {
          observe: (observation: PersistenceObservation) => {
            observations.push(observation);
          },
        },
      );

      expect(recovery).toMatchObject({
        completed: false,
        category: "backup-create-or-verify-failed",
        cause: new Error("candidate stat fault"),
        candidate: {
          status: "retained-unverifiable",
          path: `${manifestPath}.bak`,
        },
        lock: {
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        },
      });
      expect(observations).toMatchObject([
        {
          attemptId: 1,
          operation: "candidate-close",
          targetPath: `${manifestPath}.bak`,
          before: { kind: "stat-ok" },
          primitive: { status: "fulfilled" },
          after: { kind: "stat-rejected" },
        },
        {
          attemptId: 2,
          operation: "recovery-lock-close",
          before: { kind: "stat-ok" },
          primitive: { status: "fulfilled" },
          after: { kind: "stat-rejected" },
        },
        {
          attemptId: 3,
          operation: "recovery-lock-unlink",
          before: { kind: "present" },
          primitive: { status: "fulfilled" },
          after: { kind: "absent" },
        },
      ]);
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe("");
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      const candidateStat = await lstat(`${manifestPath}.bak`);
      const candidateBefore = observations[0]?.before;
      if (candidateBefore?.kind !== "stat-ok") {
        throw new Error("expected provisional candidate identity observation");
      }
      expect(candidateBefore.identity.dev).toBe(candidateStat.dev);
      expect(candidateBefore.identity.ino).toBe(candidateStat.ino);
      expect((await readdir(tempDir)).sort()).toEqual(
        ["candidate-stat.json", "candidate-stat.json.bak"].sort(),
      );
    });

    it("retains the primary retirement failure while cleaning the owned backup", async () => {
      const manifestPath = path.join(tempDir, "retirement.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);

      const recovery = await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-retirement")
            throw new Error("retirement fault");
        },
        () => recoverInvalidManifest(inspection),
      );

      expect(recovery.completed).toBe(false);
      if (!recovery.completed) {
        expect(recovery.category).toBe("source-retirement-failed");
        expect(recovery.cause).toEqual(new Error("retirement fault"));
        expect(recovery.candidate).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.bak`,
        });
        expect(recovery.lock).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        });
      }
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("preserves the primary pre-I5 cause when cleanup also degrades", async () => {
      const manifestPath = path.join(tempDir, "retirement-with-cleanup.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const primary = new Error("retirement fault");
      const cleanup = new Error("close fault");
      let diagnostics: PersistenceHarnessDiagnostics | undefined;

      const recovery = await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-retirement") throw primary;
        },
        () => recoverInvalidManifest(inspection),
        {
          injectPostAttemptOutcome: ({ operation }) =>
            operation === "recovery-lock-close" ? cleanup : undefined,
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(recovery).toMatchObject({
        completed: false,
        category: "source-retirement-failed",
        cleanup: "close-degraded",
        candidate: {
          status: "owned-removed",
          path: `${manifestPath}.bak`,
        },
        lock: {
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        },
      });
      if (!recovery.completed) expect(recovery.cause).toBe(primary);
      expect(
        diagnostics?.observations.find(
          ({ operation }) => operation === "recovery-lock-close",
        )?.atoms,
      ).toEqual([
        {
          kind: "synthetic",
          error: expect.objectContaining({ message: "close fault" }),
        },
      ]);
      expect(Object.isFrozen(primary)).toBe(false);
      expect(Object.isFrozen(cleanup)).toBe(false);
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("preserves a replacement of an owned incomplete candidate", async () => {
      const manifestPath = path.join(tempDir, "replaced-candidate.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);

      const recovery = await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage === "recovery-after-candidate") {
            await unlink(`${manifestPath}.bak`);
            await writeFile(
              `${manifestPath}.bak`,
              "unmanaged replacement",
              "utf-8",
            );
          }
        },
        () => recoverInvalidManifest(inspection),
      );

      expect(recovery).toMatchObject({
        completed: false,
        category: "backup-create-or-verify-failed",
        candidate: {
          status: "retained-replacement",
          path: `${manifestPath}.bak`,
        },
        lock: {
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        },
      });
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe(
        "unmanaged replacement",
      );
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it("reports identity-bound candidate and owned lock retention when exact cleanup is denied", async ({
      skip,
    }) => {
      const probePath = path.join(tempDir, "permission-probe");
      await writeFile(probePath, "probe", "utf-8");
      await chmod(tempDir, 0o500);
      let permissionsEnforced = false;
      try {
        try {
          await unlink(probePath);
        } catch {
          permissionsEnforced = true;
        }
      } finally {
        await chmod(tempDir, 0o700);
      }
      if (!permissionsEnforced) {
        skip();
        return;
      }
      await unlink(probePath);

      const manifestPath = path.join(tempDir, "retained-owned.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const primary = new Error("candidate verification fault");

      let recovery: Awaited<ReturnType<typeof recoverInvalidManifest>>;
      try {
        recovery = await withManifestPersistenceFaultsForTesting(
          async (stage) => {
            if (stage === "recovery-after-candidate") {
              await chmod(tempDir, 0o500);
              throw primary;
            }
          },
          () => recoverInvalidManifest(inspection),
        );
      } finally {
        await chmod(tempDir, 0o700);
      }

      expect(recovery).toMatchObject({
        completed: false,
        category: "backup-create-or-verify-failed",
        cause: primary,
        cleanup: "unlink-degraded",
        candidate: {
          status: "retained-owned",
          path: `${manifestPath}.bak`,
        },
        lock: {
          status: "retained-owned",
          path: `${manifestPath}.lock`,
        },
      });
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe("{corrupt");
      expect(await readFile(`${manifestPath}.lock`, "utf-8")).toBe("");
      expect((await readdir(tempDir)).sort()).toEqual(
        [
          "retained-owned.json",
          "retained-owned.json.bak",
          "retained-owned.json.lock",
        ].sort(),
      );
    });

    it("reports lock contention without treating invalid input as absent", async () => {
      const manifestPath = path.join(tempDir, "locked.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      await writeFile(`${manifestPath}.lock`, "active", "utf-8");

      const recovery = await recoverInvalidManifest(inspection);

      expect(recovery.completed).toBe(false);
      if (!recovery.completed) {
        expect(recovery.category).toBe("lock-unavailable");
        expect(recovery.candidate).toEqual({ status: "none-created" });
        expect(recovery.lock).toEqual({
          status: "pre-existing-blocker",
          path: `${manifestPath}.lock`,
        });
      }
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(true);
    });

    it("reports candidate suffix exhaustion without a false backup result", async () => {
      const manifestPath = path.join(tempDir, "exhausted.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      let allocationAttempts = 0;

      const recovery = await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage !== "recovery-candidate-open") return;
          allocationAttempts++;
          throw Object.assign(new Error("occupied"), { code: "EEXIST" });
        },
        () => recoverInvalidManifest(inspection),
      );

      expect(allocationAttempts).toBe(10000);
      expect(recovery.completed).toBe(false);
      if (!recovery.completed) {
        expect(recovery.category).toBe("backup-create-or-verify-failed");
        expect(recovery.candidate).toEqual({ status: "none-created" });
        expect(recovery.lock).toEqual({
          status: "owned-removed",
          path: `${manifestPath}.lock`,
        });
        expect("backupPath" in recovery).toBe(false);
      }
      expect(await readFile(manifestPath, "utf-8")).toBe("{corrupt");
      expect(await pathExists(`${manifestPath}.bak`)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
    });

    it.each([
      [false, false, "clean"],
      [true, false, "close-degraded"],
      [false, true, "unlink-degraded"],
      [true, true, "both-degraded"],
    ] as const)(
      "records real cleanup effects before deterministic close=%s unlink=%s outcomes",
      async (closeFails, unlinkFails, cleanup) => {
        const manifestPath = path.join(
          tempDir,
          `cleanup-${closeFails}-${unlinkFails}.json`,
        );
        await writeFile(manifestPath, "{corrupt", "utf-8");
        const inspection = await inspectManifest(manifestPath);
        const observations: PersistenceObservation[] = [];
        const closeError = new Error("close fault");
        const unlinkError = new Error("unlink fault");

        const recovery = await withManifestPersistenceFaultsForTesting(
          () => undefined,
          () => recoverInvalidManifest(inspection),
          {
            observe: (observation: PersistenceObservation) => {
              observations.push(observation);
            },
            injectPostAttemptOutcome: ({ operation }) => {
              if (operation === "recovery-lock-close" && closeFails)
                return closeError;
              if (operation === "recovery-lock-unlink" && unlinkFails)
                return unlinkError;
              return undefined;
            },
          },
        );

        expect(recovery).toEqual({
          completed: true,
          backupPath: `${manifestPath}.bak`,
          cleanup,
        });
        expect(observations.map(({ attemptId }) => attemptId)).toEqual([
          1, 2, 3,
        ]);
        expect(observations.map(({ operation }) => operation)).toEqual([
          "candidate-close",
          "recovery-lock-close",
          "recovery-lock-unlink",
        ]);
        for (const observation of observations.slice(0, 2)) {
          expect(observation.before).toMatchObject({ kind: "stat-ok" });
          expect(observation.primitive).toEqual({ status: "fulfilled" });
          expect(observation.after).toMatchObject({ kind: "stat-rejected" });
        }
        expect(observations[0]?.targetPath).toBe(`${manifestPath}.bak`);
        expect(observations[1]?.targetPath).toBe(`${manifestPath}.lock`);
        expect(observations[2]).toMatchObject({
          targetPath: `${manifestPath}.lock`,
          before: { kind: "present" },
          primitive: { status: "fulfilled" },
          after: { kind: "absent" },
        });
        expect(observations[1]?.atoms).toEqual(
          closeFails
            ? [
                {
                  kind: "synthetic",
                  error: expect.objectContaining({ message: "close fault" }),
                },
              ]
            : [],
        );
        expect(observations[2]?.atoms).toEqual(
          unlinkFails
            ? [
                {
                  kind: "synthetic",
                  error: expect.objectContaining({ message: "unlink fault" }),
                },
              ]
            : [],
        );
        const lockCloseBefore = observations[1]?.before;
        const lockUnlinkBefore = observations[2]?.before;
        if (
          lockCloseBefore?.kind !== "stat-ok" ||
          lockUnlinkBefore?.kind !== "present"
        ) {
          throw new Error("expected exact lock identity observations");
        }
        expect(lockCloseBefore.identity.dev).toBe(
          lockUnlinkBefore.identity.dev,
        );
        expect(lockCloseBefore.identity.ino).toBe(
          lockUnlinkBefore.identity.ino,
        );
        expect(await pathExists(manifestPath)).toBe(false);
        expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe("{corrupt");
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
        expect(await readdir(tempDir)).toEqual([
          `cleanup-${closeFails}-${unlinkFails}.json.bak`,
        ]);
      },
    );

    it("reports observer failure through diagnostics only after recovery and cleanup settle", async () => {
      const manifestPath = path.join(tempDir, "observer-failure.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      let diagnostics: PersistenceHarnessDiagnostics | undefined;
      const observerFailure = new Error("observer failed");

      const recovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          observe: () => {
            throw observerFailure;
          },
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(recovery).toEqual({
        completed: true,
        backupPath: `${manifestPath}.bak`,
        cleanup: "clean",
      });
      expect(await pathExists(manifestPath)).toBe(false);
      expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe("{corrupt");
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(await readdir(tempDir)).toEqual(["observer-failure.json.bak"]);
      expect(diagnostics?.errors.map(({ message }) => message)).toEqual([
        "observer failed",
        "observer failed",
        "observer failed",
      ]);
    });

    it("keeps the operation primary outward while retaining observer diagnostics separately", async () => {
      const manifestPath = path.join(tempDir, "primary-and-observer.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const primary = new Error("operation primary");
      const observerFailure = new Error("observer diagnostic");
      let diagnostics: PersistenceHarnessDiagnostics | undefined;

      await expect(
        withManifestPersistenceFaultsForTesting(
          () => undefined,
          async () => {
            await recoverInvalidManifest(inspection);
            throw primary;
          },
          {
            observe: () => {
              throw observerFailure;
            },
            settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
              diagnostics = settled;
            },
          },
        ),
      ).rejects.toBe(primary);

      expect(diagnostics?.errors.map(({ message }) => message)).toEqual([
        "observer diagnostic",
        "observer diagnostic",
        "observer diagnostic",
      ]);
      expect(Object.isFrozen(primary)).toBe(false);
      expect(Object.isFrozen(observerFailure)).toBe(false);
    });

    it("reports an injector contract failure after real cleanup without changing classification", async () => {
      const manifestPath = path.join(tempDir, "injector-contract.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      let diagnostics: PersistenceHarnessDiagnostics | undefined;

      const recovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          injectPostAttemptOutcome: ({ operation }) =>
            operation === "recovery-lock-close"
              ? ("invalid outcome" as unknown as Error)
              : undefined,
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(diagnostics?.errors[0]?.message).toBe(
        "Manifest persistence post-attempt injector must return Error or undefined",
      );

      expect(recovery).toEqual({
        completed: true,
        backupPath: `${manifestPath}.bak`,
        cleanup: "clean",
      });
      expect(await pathExists(manifestPath)).toBe(false);
      expect(await readFile(`${manifestPath}.bak`, "utf-8")).toBe("{corrupt");
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(await readdir(tempDir)).toEqual(["injector-contract.json.bak"]);
    });

    it("delivers detached deeply immutable evidence after clearing recursive recording state", async () => {
      const manifestPath = path.join(tempDir, "detached-evidence.json");
      const nestedManifestPath = path.join(tempDir, "nested-evidence.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      await writeFile(nestedManifestPath, "{nested", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const nestedInspection = await inspectManifest(nestedManifestPath);
      let diagnostics: PersistenceHarnessDiagnostics | undefined;
      let recursiveCompleted = false;
      const nestedAttempts: number[] = [];

      const recovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          observe: async (observation: PersistenceObservation) => {
            expect(Object.isFrozen(observation)).toBe(true);
            expect(Object.isFrozen(observation.before)).toBe(true);
            expect(Object.isFrozen(observation.primitive)).toBe(true);
            expect(Object.isFrozen(observation.after)).toBe(true);
            if (observation.before.kind === "stat-ok") {
              expect(Object.isFrozen(observation.before.identity)).toBe(true);
            }
            expect(() => {
              (observation.primitive as { status: string }).status = "rejected";
            }).toThrow();
            if (!recursiveCompleted) {
              await withManifestPersistenceFaultsForTesting(
                () => undefined,
                async () => {
                  await recoverInvalidManifest(nestedInspection);
                  recursiveCompleted = true;
                },
                {
                  observe: ({ attemptId }: PersistenceObservation) => {
                    nestedAttempts.push(attemptId);
                  },
                },
              );
            }
          },
          injectPostAttemptOutcome: (request) => {
            expect(Object.isFrozen(request)).toBe(true);
            expect(Object.isFrozen(request.primitive)).toBe(true);
            expect(() => {
              (request.primitive as { status: string }).status = "rejected";
            }).toThrow();
            return undefined;
          },
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
      expect(recursiveCompleted).toBe(true);
      expect(diagnostics).toBeDefined();
      expect(Object.isFrozen(diagnostics)).toBe(true);
      expect(Object.isFrozen(diagnostics?.observations)).toBe(true);
      expect(() => {
        (diagnostics?.observations as PersistenceObservation[]).push(
          diagnostics?.observations[0] as PersistenceObservation,
        );
      }).toThrow();
      expect(diagnostics?.observations).toHaveLength(3);
      expect(nestedAttempts).toEqual([1, 2, 3]);
      expect(
        diagnostics?.observations.every(
          ({ primitive }) => primitive.status === "fulfilled",
        ),
      ).toBe(true);
    });

    it("keeps async observer and invalid injector failures in settled harness diagnostics", async () => {
      const manifestPath = path.join(tempDir, "async-diagnostics.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const observerError = new Error("async observer failed");
      const injectorError = new Error("async injector failed");
      let diagnostics: PersistenceHarnessDiagnostics | undefined;
      let injectorCalls = 0;

      const recovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          observe: () => Promise.reject(observerError),
          injectPostAttemptOutcome: () => {
            injectorCalls++;
            if (injectorCalls === 1) {
              return Object.fromEntries([
                [
                  // biome-ignore lint/suspicious/noThenProperty: exercise an invalid custom thenable
                  "then",
                  (_resolve: unknown, reject: (error: Error) => void) =>
                    reject(injectorError),
                ],
              ]) as unknown as Error;
            }
            if (injectorCalls === 2) {
              return new Proxy(
                {},
                {
                  get(_target, property) {
                    if (property === "then")
                      throw new Error("then access failed");
                    return undefined;
                  },
                },
              ) as Error;
            }
            return undefined;
          },
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
      expect(diagnostics?.errors.map(({ message }) => message)).toEqual([
        "Manifest persistence post-attempt injector must return Error or undefined",
        "async injector failed",
        "Manifest persistence post-attempt injector must return Error or undefined",
        "then access failed",
        "async observer failed",
        "async observer failed",
        "async observer failed",
      ]);
    });

    it("projects hostile diagnostic errors without leaking getters or aliases", async () => {
      const manifestPath = path.join(tempDir, "hostile-error.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      let diagnostics: PersistenceHarnessDiagnostics | undefined;
      const hostile = new Proxy(new Error("hidden"), {
        get() {
          throw new Error("hostile getter");
        },
      });

      const recovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          observe: () => {
            throw hostile;
          },
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
      expect(diagnostics?.errors).toHaveLength(3);
      expect(
        diagnostics?.errors.every(({ kind }) => kind === "unreadable"),
      ).toBe(true);
      expect(Object.isFrozen(diagnostics?.errors[0])).toBe(true);
      expect(Object.isFrozen(hostile)).toBe(false);
    });

    it.each([
      ["Promise rejection", () => Promise.reject(new Error("promise failed"))],
      [
        "throwing then call",
        () =>
          Object.fromEntries([
            [
              // biome-ignore lint/suspicious/noThenProperty: exercise a throwing custom thenable
              "then",
              () => {
                throw new Error("then call failed");
              },
            ],
          ]),
      ],
    ] as const)(
      "consumes invalid injector %s without changing recovery",
      async (_label, invalidOutcome) => {
        const manifestPath = path.join(
          tempDir,
          `injector-${_label.replaceAll(" ", "-")}.json`,
        );
        await writeFile(manifestPath, "{corrupt", "utf-8");
        const inspection = await inspectManifest(manifestPath);
        let diagnostics: PersistenceHarnessDiagnostics | undefined;
        let calls = 0;

        const recovery = await withManifestPersistenceFaultsForTesting(
          () => undefined,
          () => recoverInvalidManifest(inspection),
          {
            injectPostAttemptOutcome: () =>
              calls++ === 0
                ? (invalidOutcome() as unknown as Error)
                : undefined,
            settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
              diagnostics = settled;
            },
          },
        );

        expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
        expect(diagnostics?.errors.map(({ message }) => message)).toEqual([
          "Manifest persistence post-attempt injector must return Error or undefined",
          _label === "Promise rejection"
            ? "promise failed"
            : "then call failed",
        ]);
      },
    );

    it("orders projected primary, primitive, and synthetic atoms without relabeling them", async () => {
      let diagnostics: PersistenceHarnessDiagnostics | undefined;

      await withManifestPersistenceFaultsForTesting(
        () => undefined,
        async () => undefined,
        {
          combinationProbes: [
            {
              primary: "operation primary",
              primitive: "literal primitive rejection",
              synthetic: "post-attempt synthetic",
            },
            {
              primitive: "literal primitive rejection",
              synthetic: "post-attempt synthetic",
            },
          ],
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(diagnostics?.combinationProbes).toEqual([
        {
          atoms: [
            { kind: "primary", label: "operation primary" },
            { kind: "primitive", label: "literal primitive rejection" },
            { kind: "synthetic", label: "post-attempt synthetic" },
          ],
        },
        {
          atoms: [
            { kind: "primitive", label: "literal primitive rejection" },
            { kind: "synthetic", label: "post-attempt synthetic" },
          ],
        },
      ]);
    });

    it("accepts and awaits a non-native PromiseLike observer", async () => {
      const manifestPath = path.join(tempDir, "promise-like-observer.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      let observerCalls = 0;
      let observerThenCalls = 0;
      let observerSettlements = 0;
      let wrapperSettled = false;
      const releases: Array<() => void> = [];
      const thenEnteredResolvers: Array<() => void> = [];
      const thenEntered = Array.from(
        { length: 3 },
        () =>
          new Promise<void>((resolve) => {
            thenEnteredResolvers.push(resolve);
          }),
      );
      const customPromiseLike = {
        // biome-ignore lint/suspicious/noThenProperty: prove the PromiseLike observer contract without a native Promise
        then(onfulfilled: (value: undefined) => unknown) {
          const index = observerThenCalls++;
          releases[index] = () => {
            observerSettlements++;
            onfulfilled(undefined);
          };
          thenEnteredResolvers[index]?.();
          return customPromiseLike;
        },
      } as PromiseLike<void>;

      const recoveryPromise = withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          observe: () => {
            observerCalls++;
            expect(customPromiseLike).not.toBeInstanceOf(Promise);
            return customPromiseLike;
          },
        },
      );
      void recoveryPromise.then(() => {
        wrapperSettled = true;
      });

      for (let index = 0; index < 3; index++) {
        await thenEntered[index];
        expect(observerCalls).toBe(index + 1);
        expect(observerThenCalls).toBe(index + 1);
        expect(observerSettlements).toBe(index);
        expect(wrapperSettled).toBe(false);
        releases[index]?.();
      }

      const recovery = await recoveryPromise;

      expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
      expect(wrapperSettled).toBe(true);
      expect(observerCalls).toBe(3);
      expect(observerThenCalls).toBe(3);
      expect(observerSettlements).toBe(3);
    });

    it.each([
      "observe",
      "settleDiagnostics",
      "combinationProbes",
      "injectPostAttemptOutcome",
    ] as const)(
      "prevents synchronous harness re-entry while capturing the %s accessor",
      async (reentryProperty) => {
        const manifestPath = path.join(
          tempDir,
          `accessor-reentry-${reentryProperty}.json`,
        );
        await writeFile(manifestPath, "{corrupt", "utf-8");
        const inspection = await inspectManifest(manifestPath);
        let nestedCallbackCalls = 0;
        let reentryCalls = 0;
        let diagnostics: PersistenceHarnessDiagnostics | undefined;
        const nestedResults: Promise<unknown>[] = [];
        const hooksTarget = {
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        };
        const hooks = new Proxy(hooksTarget, {
          get(target, property, receiver) {
            if (property === reentryProperty) {
              reentryCalls++;
              nestedResults.push(
                withManifestPersistenceFaultsForTesting(
                  () => undefined,
                  async () => {
                    nestedCallbackCalls++;
                  },
                ).catch((error) => error),
              );
            }
            return Reflect.get(target, property, receiver);
          },
        });

        const recovery = await withManifestPersistenceFaultsForTesting(
          () => undefined,
          () => recoverInvalidManifest(inspection),
          hooks,
        );
        const nestedOutcomes = await Promise.all(nestedResults);

        expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
        expect(reentryCalls).toBe(1);
        expect(nestedCallbackCalls).toBe(0);
        expect(nestedOutcomes).toHaveLength(1);
        expect(nestedOutcomes[0]).toMatchObject({
          message:
            "Manifest persistence fault injection does not support nesting",
        });
        expect(
          diagnostics?.observations.map(({ attemptId }) => attemptId),
        ).toEqual([1, 2, 3]);
        expect(diagnostics?.errors).toEqual([]);
        expect(await pathExists(manifestPath)).toBe(false);
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      },
    );

    it("reads a stateful injector then getter once and consumes its later rejection", async () => {
      const manifestPath = path.join(tempDir, "stateful-then.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const laterFailure = new Error("later thenable rejection");
      let thenReads = 0;
      let diagnostics: PersistenceHarnessDiagnostics | undefined;
      let injectorCalls = 0;
      const statefulThenable = new Proxy(
        {},
        {
          get(_target, property) {
            if (property !== "then") return undefined;
            thenReads++;
            return (_resolve: unknown, reject: (error: Error) => void) => {
              queueMicrotask(() => reject(laterFailure));
            };
          },
        },
      );

      const recovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          injectPostAttemptOutcome: () =>
            injectorCalls++ === 0
              ? (statefulThenable as unknown as Error)
              : undefined,
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
      expect(thenReads).toBe(1);
      expect(diagnostics?.errors.map(({ message }) => message)).toEqual([
        "Manifest persistence post-attempt injector must return Error or undefined",
        "later thenable rejection",
      ]);
    });

    it("projects a nested thenable rejection reason without assimilating or leaking it", async () => {
      const manifestPath = path.join(tempDir, "nested-thenable-reason.json");
      await writeFile(manifestPath, "{corrupt", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      let outerThenReads = 0;
      let outerRejectCalls = 0;
      let reasonThenReads = 0;
      let reasonThenCalls = 0;
      let diagnosticsSettlements = 0;
      let diagnostics: PersistenceHarnessDiagnostics | undefined;
      const nestedReason = new Proxy(
        new Error("nested thenable rejection reason"),
        {
          get(target, property, receiver) {
            if (property === "then") {
              reasonThenReads++;
              return () => {
                reasonThenCalls++;
                throw new Error("nested reason must not be assimilated");
              };
            }
            return Reflect.get(target, property, receiver);
          },
        },
      );
      const rejectingThenable = new Proxy(
        {},
        {
          get(_target, property) {
            if (property !== "then") return undefined;
            outerThenReads++;
            return (_resolve: unknown, reject: (reason: unknown) => void) => {
              outerRejectCalls++;
              queueMicrotask(() => reject(nestedReason));
            };
          },
        },
      );

      const recovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          injectPostAttemptOutcome: () => rejectingThenable as unknown as Error,
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnosticsSettlements++;
            diagnostics = settled;
          },
        },
      );

      expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
      expect(outerThenReads).toBe(2);
      expect(outerRejectCalls).toBe(2);
      expect(reasonThenReads).toBe(0);
      expect(reasonThenCalls).toBe(0);
      expect(diagnosticsSettlements).toBe(1);
      expect(Object.isFrozen(nestedReason)).toBe(false);
      (nestedReason as Error & { marker?: string }).marker = "still mutable";
      expect((nestedReason as Error & { marker?: string }).marker).toBe(
        "still mutable",
      );
      const projectedReasons = [diagnostics?.errors[1], diagnostics?.errors[3]];
      for (const projected of projectedReasons) {
        expect(projected).not.toBe(nestedReason);
        expect(Object.keys(projected ?? {})).toEqual([
          "kind",
          "name",
          "message",
        ]);
        expect(Reflect.has(projected ?? {}, "then")).toBe(false);
        expect(Reflect.has(projected ?? {}, "marker")).toBe(false);
        expect(
          Object.values(projected ?? {}).every(
            (value) => typeof value !== "object" && typeof value !== "function",
          ),
        ).toBe(true);
      }
      expect(
        diagnostics?.errors.map(({ name, message }) => ({ name, message })),
      ).toEqual([
        {
          name: "TypeError",
          message:
            "Manifest persistence post-attempt injector must return Error or undefined",
        },
        { name: "Error", message: "nested thenable rejection reason" },
        {
          name: "TypeError",
          message:
            "Manifest persistence post-attempt injector must return Error or undefined",
        },
        { name: "Error", message: "nested thenable rejection reason" },
      ]);
    });

    it("keeps a detached nested harness active after the outer owner completes", async () => {
      const manifestPath = path.join(tempDir, "outer-owner.json");
      const nestedManifestPath = path.join(tempDir, "nested-owner.json");
      await writeFile(manifestPath, "{outer", "utf-8");
      await writeFile(nestedManifestPath, "{nested", "utf-8");
      const inspection = await inspectManifest(manifestPath);
      const nestedInspection = await inspectManifest(nestedManifestPath);
      let releaseNested: (() => void) | undefined;
      const nestedGate = new Promise<void>((resolve) => {
        releaseNested = resolve;
      });
      let nestedStartedResolve: (() => void) | undefined;
      const nestedStarted = new Promise<void>((resolve) => {
        nestedStartedResolve = resolve;
      });
      let nestedSettled = false;
      let nestedPromise: Promise<unknown> | undefined;
      let outerDiagnostics: PersistenceHarnessDiagnostics | undefined;
      let nestedDiagnostics: PersistenceHarnessDiagnostics | undefined;
      const outerAttempts: number[] = [];
      const nestedAttempts: number[] = [];

      const outerRecovery = await withManifestPersistenceFaultsForTesting(
        () => undefined,
        () => recoverInvalidManifest(inspection),
        {
          observe: ({ attemptId }: PersistenceObservation) => {
            outerAttempts.push(attemptId);
            if (nestedPromise) return;
            nestedPromise = withManifestPersistenceFaultsForTesting(
              () => undefined,
              async () => {
                nestedStartedResolve?.();
                await nestedGate;
                return recoverInvalidManifest(nestedInspection);
              },
              {
                observe: ({ attemptId: nestedAttemptId }) => {
                  nestedAttempts.push(nestedAttemptId);
                },
                settleDiagnostics: (settled) => {
                  nestedDiagnostics = settled;
                },
              },
            ).finally(() => {
              nestedSettled = true;
            });
          },
          settleDiagnostics: (settled) => {
            outerDiagnostics = settled;
          },
        },
      );
      await nestedStarted;

      expect(outerRecovery).toMatchObject({
        completed: true,
        cleanup: "clean",
      });
      expect(outerAttempts).toEqual([1, 2, 3]);
      expect(
        outerDiagnostics?.observations.map(({ attemptId }) => attemptId),
      ).toEqual([1, 2, 3]);
      expect(outerDiagnostics?.errors).toEqual([]);
      expect(nestedSettled).toBe(false);
      expect(nestedAttempts).toEqual([]);

      releaseNested?.();
      const nestedRecovery = await nestedPromise;

      expect(nestedRecovery).toMatchObject({
        completed: true,
        cleanup: "clean",
      });
      expect(nestedSettled).toBe(true);
      expect(nestedAttempts).toEqual([1, 2, 3]);
      expect(
        nestedDiagnostics?.observations.map(({ attemptId }) => attemptId),
      ).toEqual([1, 2, 3]);
      expect(nestedDiagnostics?.errors).toEqual([]);
      expect(outerAttempts).toEqual([1, 2, 3]);
      expect(await pathExists(manifestPath)).toBe(false);
      expect(await pathExists(nestedManifestPath)).toBe(false);
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(await pathExists(`${nestedManifestPath}.lock`)).toBe(false);
    });

    it.each([
      "observe",
      "settleDiagnostics",
      "combinationProbes",
      "injectPostAttemptOutcome",
    ] as const)(
      "contains a throwing %s hook accessor outside operation classification",
      async (hostileProperty) => {
        const manifestPath = path.join(
          tempDir,
          `hostile-hook-${hostileProperty}.json`,
        );
        await writeFile(manifestPath, "{corrupt", "utf-8");
        const inspection = await inspectManifest(manifestPath);
        const accessFailure = new Error(`${hostileProperty} access failed`);
        let diagnostics: PersistenceHarnessDiagnostics | undefined;
        const hookTarget = {
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        };
        const propertyReads = new Map<PropertyKey, number>();
        const hostileHooks = new Proxy(hookTarget, {
          get(target, property, receiver) {
            propertyReads.set(property, (propertyReads.get(property) ?? 0) + 1);
            if (property === hostileProperty) throw accessFailure;
            return Reflect.get(target, property, receiver);
          },
        });

        const recovery = await withManifestPersistenceFaultsForTesting(
          () => undefined,
          () => recoverInvalidManifest(inspection),
          hostileHooks,
        );

        expect(recovery).toMatchObject({ completed: true, cleanup: "clean" });
        expect(
          [
            "observe",
            "settleDiagnostics",
            "combinationProbes",
            "injectPostAttemptOutcome",
          ].map((property) => propertyReads.get(property)),
        ).toEqual([1, 1, 1, 1]);
        if (hostileProperty !== "settleDiagnostics") {
          expect(diagnostics?.errors.map(({ message }) => message)).toContain(
            `${hostileProperty} access failed`,
          );
        }
        expect(await pathExists(manifestPath)).toBe(false);
        expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      },
    );

    it("projects invalid combination labels to frozen scalar evidence without retaining aliases", async () => {
      const objectLabel = { mutable: true };
      const proxyLabel = new Proxy(
        {},
        {
          get() {
            throw new Error("label getter must not run");
          },
        },
      );
      const functionLabel = () => undefined;
      let diagnostics: PersistenceHarnessDiagnostics | undefined;

      await withManifestPersistenceFaultsForTesting(
        () => undefined,
        async () => undefined,
        {
          combinationProbes: [
            { primary: objectLabel as unknown as string },
            { primitive: proxyLabel as unknown as string },
            { synthetic: functionLabel as unknown as string },
          ],
          settleDiagnostics: (settled: PersistenceHarnessDiagnostics) => {
            diagnostics = settled;
          },
        },
      );

      expect(diagnostics?.combinationProbes).toEqual([
        { atoms: [{ kind: "primary", label: "<invalid:object>" }] },
        { atoms: [{ kind: "primitive", label: "<invalid:object>" }] },
        { atoms: [{ kind: "synthetic", label: "<invalid:function>" }] },
      ]);
      expect(Object.isFrozen(diagnostics?.combinationProbes)).toBe(true);
      expect(Object.isFrozen(diagnostics?.combinationProbes[0]?.atoms[0])).toBe(
        true,
      );
      objectLabel.mutable = false;
      expect(diagnostics?.combinationProbes[0]?.atoms[0]?.label).toBe(
        "<invalid:object>",
      );
      expect(diagnostics?.errors.map(({ message }) => message)).toEqual([
        "Manifest persistence combination probe label must be a string",
        "Manifest persistence combination probe label must be a string",
        "Manifest persistence combination probe label must be a string",
      ]);
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

    it("rechecks freshness after the replacement-rename hook", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const original = validManifestJson();
      const drifted = `${original}drifted`;
      await writeFile(manifestPath, original, "utf-8");
      const authority = await createManifestBackupAuthority(
        manifestPath,
        await captureManifestSnapshot(manifestPath),
        "migration-1",
      );

      await expect(
        withManifestPersistenceFaultsForTesting(
          async (stage) => {
            if (stage === "replacement-rename") {
              await writeFile(manifestPath, drifted, "utf-8");
            }
          },
          () =>
            saveManifest(manifestPath, emptyManifest(), {
              authority,
              operationId: "migration-1",
            }),
        ),
      ).rejects.toThrow("changed before guarded replacement");

      expect(await readFile(manifestPath, "utf-8")).toBe(drifted);
      expect(
        (await readdir(tempDir)).filter((name) => name.includes(".tmp.")),
      ).toEqual([]);
      await expect(
        saveManifest(manifestPath, emptyManifest(), {
          authority,
          operationId: "migration-1",
        }),
      ).rejects.toThrow("changed since its last accepted save");
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

    it("removes a backup whose readback bytes were altered", async () => {
      const manifestPath = path.join(tempDir, "manifest.json");
      const original = validManifestJson();
      const timestamp = new Date("2026-07-17T01:02:03.456Z");
      const backupPath = `${manifestPath}.backup-2026-07-17T01-02-03.456Z`;
      await writeFile(manifestPath, original, "utf-8");
      const snapshot = await captureManifestSnapshot(manifestPath);

      await expect(
        withManifestPersistenceFaultsForTesting(
          async (stage) => {
            if (stage === "backup-readback") {
              await writeFile(backupPath, "altered readback", "utf-8");
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
      ).rejects.toThrow("backup verification failed");

      expect(await readFile(manifestPath, "utf-8")).toBe(original);
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
