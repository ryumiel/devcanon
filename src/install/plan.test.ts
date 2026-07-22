import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/fs.js", () => ({
  pathExists: vi.fn(),
  pathOrSymlinkExists: vi.fn(),
}));

import type { Manifest } from "../config/schema.js";
import type { RenderedAgent } from "../models/types.js";
import { pathExists, pathOrSymlinkExists } from "../utils/fs.js";
import { computePlan } from "./plan.js";

const mockedPathExists = vi.mocked(pathExists);
const mockedPathOrSymlinkExists = vi.mocked(pathOrSymlinkExists);

function makeOutput(overrides: Partial<RenderedAgent> = {}): RenderedAgent {
  return {
    target: "claude",
    type: "agent",
    name: "test-agent",
    sourcePath: "/src/agents/test-agent.yaml",
    generatedPath: "/gen/claude/agents/test-agent.md",
    installedPath: "/installed/test-agent.md",
    content: "rendered content",
    contentHash: "abc123",
    ...overrides,
  };
}

function makeManifest(records: Manifest["records"] = []): Manifest {
  return {
    version: 1,
    managedBy: "devcanon",
    lastSync: new Date().toISOString(),
    records: records.map((record) => {
      const basename = record.installedPath.split("/").at(-1) ?? "";
      return {
        ...record,
        name:
          record.name ??
          (record.type === "agent"
            ? basename.replace(record.target === "claude" ? ".md" : ".toml", "")
            : basename),
      };
    }),
  };
}

describe("computePlan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedPathOrSymlinkExists.mockResolvedValue(true);
  });

  it("outputs install action when path does not exist", async () => {
    mockedPathExists.mockResolvedValue(false);
    const output = makeOutput();
    const actions = await computePlan(
      [output],
      makeManifest(),
      "overwrite-managed",
      false,
      false,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("install");
    expect(actions[0].installedPath).toBe(output.installedPath);
  });

  it("outputs skip-up-to-date when hash matches manifest", async () => {
    mockedPathExists.mockResolvedValue(true);
    const output = makeOutput({ contentHash: "same-hash" });
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: output.sourcePath,
        generatedPath: output.generatedPath,
        installedPath: output.installedPath,
        installMode: "symlink",
        contentHash: "same-hash",
        timestamp: new Date().toISOString(),
      },
    ]);
    const actions = await computePlan(
      [output],
      manifest,
      "overwrite-managed",
      false,
      false,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("skip-up-to-date");
  });

  it("outputs update when hash differs from manifest", async () => {
    mockedPathExists.mockResolvedValue(true);
    const output = makeOutput({ contentHash: "new-hash" });
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: output.sourcePath,
        generatedPath: output.generatedPath,
        installedPath: output.installedPath,
        installMode: "symlink",
        contentHash: "old-hash",
        timestamp: new Date().toISOString(),
      },
    ]);
    const actions = await computePlan(
      [output],
      manifest,
      "overwrite-managed",
      false,
      false,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("update");
  });

  it("outputs update for a managed current output when only a broken symlink object exists", async () => {
    mockedPathExists.mockResolvedValue(false);
    mockedPathOrSymlinkExists.mockResolvedValue(true);
    const output = makeOutput({ contentHash: "new-hash" });
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: output.sourcePath,
        generatedPath: output.generatedPath,
        installedPath: output.installedPath,
        installMode: "symlink",
        contentHash: "old-hash",
        timestamp: new Date().toISOString(),
      },
    ]);

    const actions = await computePlan(
      [output],
      manifest,
      "overwrite-managed",
      false,
      false,
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("update");
    expect(mockedPathExists).not.toHaveBeenCalledWith(output.installedPath);
    expect(mockedPathOrSymlinkExists).toHaveBeenCalledWith(
      output.installedPath,
    );
  });

  it("outputs skip-conflict for unmanaged existing file (overwrite-managed)", async () => {
    mockedPathExists.mockResolvedValue(true);
    const output = makeOutput();
    const actions = await computePlan(
      [output],
      makeManifest(), // no records -> file is unmanaged
      "overwrite-managed",
      false,
      false,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("skip-conflict");
    expect(actions[0].reason).toContain("overwrite-managed");
  });

  it("outputs skip-conflict for unmanaged existing file (skip-existing)", async () => {
    mockedPathExists.mockResolvedValue(true);
    const output = makeOutput();
    const actions = await computePlan(
      [output],
      makeManifest(),
      "skip-existing",
      false,
      false,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("skip-conflict");
    expect(actions[0].reason).toContain("skip-existing");
  });

  it("outputs force-overwrite when force=true and unmanaged", async () => {
    mockedPathExists.mockResolvedValue(true);
    const output = makeOutput();
    const actions = await computePlan(
      [output],
      makeManifest(), // no records -> file is unmanaged
      "overwrite-managed",
      true, // force
      false,
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("force-overwrite");
  });

  it("outputs remove for stale manifest entries when cleanManagedOutputs=true", async () => {
    // pathExists is called for the current output; pathOrSymlinkExists for the stale record
    mockedPathExists.mockResolvedValue(true);
    mockedPathOrSymlinkExists.mockResolvedValue(true);

    const currentOutput = makeOutput({
      installedPath: "/installed/current.md",
      name: "current",
    });
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: "/src/agents/current.yaml",
        generatedPath: null,
        installedPath: "/installed/current.md",
        installMode: "symlink",
        contentHash: currentOutput.contentHash,
        timestamp: new Date().toISOString(),
      },
      {
        target: "claude",
        type: "agent",
        sourcePath: "/src/agents/stale.yaml",
        generatedPath: null,
        installedPath: "/installed/stale.md",
        installMode: "symlink",
        contentHash: "stale-hash",
        timestamp: new Date().toISOString(),
      },
    ]);

    const actions = await computePlan(
      [currentOutput],
      manifest,
      "overwrite-managed",
      false,
      true, // cleanManagedOutputs
    );

    const removeActions = actions.filter((a) => a.kind === "remove");
    expect(removeActions).toHaveLength(1);
    expect(removeActions[0].installedPath).toBe("/installed/stale.md");
    expect(removeActions[0].reason).toContain("cleaning up");
  });

  it("outputs remove-missing for a stale record whose output is already absent", async () => {
    mockedPathOrSymlinkExists.mockResolvedValue(false);
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: "/src/agents/stale.yaml",
        generatedPath: null,
        installedPath: "/installed/stale.md",
        installMode: "symlink",
        contentHash: "stale-hash",
        timestamp: new Date().toISOString(),
      },
    ]);

    const actions = await computePlan(
      [],
      manifest,
      "overwrite-managed",
      false,
      true,
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("remove-missing");
  });

  it("does not remove other target's records when targetFilter is set", async () => {
    mockedPathExists.mockResolvedValue(true);
    mockedPathOrSymlinkExists.mockResolvedValue(true);

    const claudeOutput = makeOutput({
      target: "claude",
      installedPath: "/installed/claude-agent.md",
      contentHash: "claude-hash",
      name: "claude-agent",
    });
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: "/src/agents/claude.yaml",
        generatedPath: null,
        installedPath: "/installed/claude-agent.md",
        installMode: "symlink",
        contentHash: "claude-hash",
        timestamp: new Date().toISOString(),
      },
      {
        target: "codex",
        type: "agent",
        sourcePath: "/src/agents/codex.yaml",
        generatedPath: null,
        installedPath: "/installed/codex-agent.toml",
        installMode: "symlink",
        contentHash: "codex-hash",
        timestamp: new Date().toISOString(),
      },
    ]);

    // Sync only claude target — codex records should NOT be removed
    const actions = await computePlan(
      [claudeOutput],
      manifest,
      "overwrite-managed",
      false,
      true, // cleanManagedOutputs
      "claude", // targetFilter
    );

    const removeActions = actions.filter((a) => a.kind === "remove");
    expect(removeActions).toHaveLength(0);
  });

  it("does not output remove when cleanManagedOutputs=false", async () => {
    mockedPathExists.mockResolvedValue(true);

    const currentOutput = makeOutput({
      installedPath: "/installed/current.md",
      name: "current",
    });
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: "/src/agents/current.yaml",
        generatedPath: null,
        installedPath: "/installed/current.md",
        installMode: "symlink",
        contentHash: currentOutput.contentHash,
        timestamp: new Date().toISOString(),
      },
      {
        target: "claude",
        type: "agent",
        sourcePath: "/src/agents/stale.yaml",
        generatedPath: null,
        installedPath: "/installed/stale.md",
        installMode: "symlink",
        contentHash: "stale-hash",
        timestamp: new Date().toISOString(),
      },
    ]);

    const actions = await computePlan(
      [currentOutput],
      manifest,
      "overwrite-managed",
      false,
      false, // cleanManagedOutputs disabled
    );

    const removeActions = actions.filter((a) => a.kind === "remove");
    expect(removeActions).toHaveLength(0);
  });

  it("outputs remove for stale manifest entry even when symlink is broken", async () => {
    // Simulate broken symlink: access() fails (pathExists→false) but lstat() succeeds
    // (pathOrSymlinkExists→true). The current installed path uses a normal file so
    // pathExists returns true for it.
    mockedPathExists.mockImplementation((p: string) =>
      Promise.resolve(p === "/installed/current.md"),
    );
    mockedPathOrSymlinkExists.mockResolvedValue(true);

    const currentOutput = makeOutput({
      installedPath: "/installed/current.md",
      name: "current",
    });
    const manifest = makeManifest([
      {
        target: "claude",
        type: "agent",
        sourcePath: "/src/agents/current.yaml",
        generatedPath: null,
        installedPath: "/installed/current.md",
        installMode: "symlink",
        contentHash: currentOutput.contentHash,
        timestamp: new Date().toISOString(),
      },
      {
        target: "claude",
        type: "skill",
        sourcePath: "/src/skills/stale-skill",
        generatedPath: null,
        installedPath: "/installed/stale-skill",
        installMode: "symlink",
        contentHash: "stale-hash",
        timestamp: new Date().toISOString(),
      },
    ]);

    const actions = await computePlan(
      [currentOutput],
      manifest,
      "overwrite-managed",
      false,
      true,
    );

    const removeActions = actions.filter((a) => a.kind === "remove");
    expect(removeActions).toHaveLength(1);
    expect(removeActions[0].installedPath).toBe("/installed/stale-skill");
  });

  it("matches a shared installed path by the full target identity", async () => {
    mockedPathOrSymlinkExists.mockResolvedValue(true);
    const output = makeOutput({ contentHash: "claude-hash" });
    const manifest = makeManifest([
      {
        target: "codex",
        type: "agent",
        name: "test-agent",
        sourcePath: "/src/agents/test-agent.yaml",
        generatedPath: "/gen/codex/agents/test-agent.toml",
        installedPath: output.installedPath,
        installMode: "copy",
        contentHash: "codex-hash",
        timestamp: new Date().toISOString(),
      },
      {
        target: "claude",
        type: "agent",
        name: "test-agent",
        sourcePath: output.sourcePath,
        generatedPath: output.generatedPath,
        installedPath: output.installedPath,
        installMode: "copy",
        contentHash: "claude-hash",
        timestamp: new Date().toISOString(),
      },
    ]);

    const actions = await computePlan(
      [output],
      manifest,
      "overwrite-managed",
      false,
      false,
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("skip-up-to-date");
  });
});
