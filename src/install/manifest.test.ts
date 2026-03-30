import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedRecord, Manifest } from "../config/schema.js";
import { updateManifest } from "./manifest.js";

function makeRecord(overrides: Partial<ManagedRecord> = {}): ManagedRecord {
  return {
    target: "claude",
    type: "agent",
    sourcePath: "/src/agents/test.yaml",
    generatedPath: "/gen/claude/agents/test.md",
    installedPath: "/installed/test.md",
    installMode: "symlink",
    contentHash: "hash-aaa",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeManifest(records: ManagedRecord[] = []): Manifest {
  return {
    version: 1,
    managedBy: "agents-manager",
    lastSync: "2026-01-01T00:00:00.000Z",
    records,
  };
}

describe("updateManifest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  it("adds new records", () => {
    const existing = makeManifest();
    const newRecord = makeRecord({ installedPath: "/installed/new.md" });
    const result = updateManifest(existing, [newRecord], []);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].installedPath).toBe("/installed/new.md");
  });

  it("updates existing records by installedPath", () => {
    const existingRecord = makeRecord({ contentHash: "old-hash" });
    const existing = makeManifest([existingRecord]);

    const updatedRecord = makeRecord({ contentHash: "new-hash" });
    const result = updateManifest(existing, [updatedRecord], []);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].contentHash).toBe("new-hash");
  });

  it("removes specified paths", () => {
    const record1 = makeRecord({ installedPath: "/installed/keep.md" });
    const record2 = makeRecord({ installedPath: "/installed/remove.md" });
    const existing = makeManifest([record1, record2]);

    const result = updateManifest(existing, [], ["/installed/remove.md"]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0].installedPath).toBe("/installed/keep.md");
  });

  it("sets lastSync to current time", () => {
    const existing = makeManifest();
    const result = updateManifest(existing, [], []);

    expect(result.lastSync).toBe("2026-06-15T12:00:00.000Z");
  });

  it("preserves version and managedBy fields", () => {
    const existing = makeManifest();
    const result = updateManifest(existing, [], []);

    expect(result.version).toBe(1);
    expect(result.managedBy).toBe("agents-manager");
  });
});
