import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../__test-helpers__/logger.js";
import { pathExists } from "../utils/fs.js";
import { emptyManifest, loadManifest, saveManifest } from "./manifest.js";

describe("manifest integration", () => {
  let tempDir: string;
  let testLogger: TestLoggerResult;
  let restoreLogger: () => void;

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
        records: [
          {
            target: "claude" as const,
            type: "skill" as const,
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
      expect(loaded.records).toHaveLength(2);
      expect(loaded.records[0].target).toBe("claude");
      expect(loaded.records[0].type).toBe("skill");
      expect(loaded.records[0].generatedPath).toBeNull();
      expect(loaded.records[0].installMode).toBe("symlink");
      expect(loaded.records[0].contentHash).toBe("def456");
      expect(loaded.records[1].target).toBe("codex");
      expect(loaded.records[1].type).toBe("agent");
      expect(loaded.records[1].contentHash).toBe("ghi789");
    });

    it("overwrites existing file with new content", async () => {
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
            installedPath: "/installed/new",
            installMode: "symlink" as const,
            contentHash: "new-hash",
            timestamp: "2026-06-01T00:00:00.000Z",
          },
        ],
      };

      await saveManifest(manifestPath, first);
      await saveManifest(manifestPath, second);
      const loaded = await loadManifest(manifestPath);

      expect(loaded.records).toHaveLength(1);
      expect(loaded.records[0].target).toBe("codex");
      expect(loaded.records[0].contentHash).toBe("new-hash");
      expect(loaded.lastSync).toBe("2026-06-01T00:00:00.000Z");
    });
  });
});
