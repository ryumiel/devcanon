import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeResolvedConfig } from "../__test-helpers__/fixtures.js";
import type { ManagedRecord } from "../config/schema.js";
import { ManifestSchema } from "../config/schema.js";
import {
  ManifestIdentityError,
  classifyManagedRecord,
  normalizeManifestBoundary,
  normalizeManifestIdentity,
} from "./manifest-identity.js";

function makeRecord(overrides: Partial<ManagedRecord> = {}): ManagedRecord {
  return {
    target: "claude",
    type: "agent",
    name: "helper",
    sourcePath: "/source/helper.yaml",
    generatedPath: "/generated/claude/agents/helper.md",
    installedPath: "/homes/claude/agents/helper.md",
    installMode: "copy",
    contentHash: "abc",
    timestamp: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("manifest identity schema", () => {
  it("accepts a bound manifest and named managed record", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      managedBy: "devcanon",
      lastSync: "2026-07-17T00:00:00.000Z",
      boundary: {
        claudeSkillsHome: "/homes/claude/skills",
        claudeAgentsHome: "/homes/claude/agents",
        codexSkillsHome: "/homes/codex/skills",
        codexAgentsHome: "/homes/codex/agents",
      },
      records: [
        {
          target: "claude",
          type: "agent",
          name: "helper",
          sourcePath: "/source/helper.yaml",
          generatedPath: "/generated/claude/agents/helper.md",
          installedPath: "/homes/claude/agents/helper.md",
          installMode: "copy",
          contentHash: "abc",
          timestamp: "2026-07-17T00:00:00.000Z",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("keeps legacy manifests readable when boundary and record name are absent", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      managedBy: "devcanon",
      lastSync: "2026-07-17T00:00:00.000Z",
      records: [],
    });

    expect(result.success).toBe(true);
  });
});

describe("manifest identity", () => {
  it("normalizes all four configured homes without requiring them to exist", () => {
    const config = makeResolvedConfig("/workspace", {
      claude: { skillsHome: "/homes/claude/skills/../skills" },
      codex: { agentsHome: "/homes/codex/agents/./" },
    });

    expect(normalizeManifestBoundary(config)).toEqual({
      claudeSkillsHome: "/homes/claude/skills",
      claudeAgentsHome: "/workspace/home/claude/agents",
      codexSkillsHome: "/workspace/home/codex/skills",
      codexAgentsHome: "/homes/codex/agents",
    });
  });

  it("classifies only the exact target-native direct-child destination as owned", () => {
    const boundary = {
      claudeSkillsHome: "/homes/claude/skills",
      claudeAgentsHome: "/homes/claude/agents",
      codexSkillsHome: "/homes/codex/skills",
      codexAgentsHome: "/homes/codex/agents",
    };

    const result = classifyManagedRecord(makeRecord(), boundary);

    expect(result.ownership).toBe("owned");
    expect(result.name).toBe("helper");
    expect(result.expectedDestination).toBe("/homes/claude/agents/helper.md");
  });

  it("derives a legacy agent name only from its target-native suffix", () => {
    const boundary = {
      claudeSkillsHome: "/homes/claude/skills",
      claudeAgentsHome: "/homes/claude/agents",
      codexSkillsHome: "/homes/codex/skills",
      codexAgentsHome: "/homes/codex/agents",
    };
    const legacy = makeRecord({ name: undefined });

    expect(classifyManagedRecord(legacy, boundary)).toMatchObject({
      ownership: "owned",
      name: "helper",
    });
    expect(() =>
      classifyManagedRecord(
        makeRecord({ name: undefined, installedPath: "/other/helper.toml" }),
        boundary,
      ),
    ).toThrow(ManifestIdentityError);
    expect(() =>
      classifyManagedRecord(
        makeRecord({
          name: undefined,
          installedPath: "/homes/claude/agents/nested/helper.md",
        }),
        boundary,
      ),
    ).toThrow("nested installed path");
  });

  it("rejects a stored boundary that differs in one configured home", () => {
    const config = makeResolvedConfig("/workspace");
    const expected = normalizeManifestBoundary(config);

    expect(() =>
      normalizeManifestIdentity(
        {
          version: 1,
          managedBy: "devcanon",
          lastSync: "2026-07-17T00:00:00.000Z",
          boundary: { ...expected, codexAgentsHome: "/other/codex/agents" },
          records: [],
        },
        config,
      ),
    ).toThrow(ManifestIdentityError);
  });

  it("rejects a non-canonical stored boundary even when it resolves to the home", () => {
    const config = makeResolvedConfig("/workspace");
    const expected = normalizeManifestBoundary(config);

    expect(() =>
      normalizeManifestIdentity(
        {
          version: 1,
          managedBy: "devcanon",
          lastSync: "2026-07-17T00:00:00.000Z",
          boundary: {
            ...expected,
            claudeSkillsHome: `${expected.claudeSkillsHome}/.`,
          },
          records: [],
        },
        config,
      ),
    ).toThrow(ManifestIdentityError);
  });

  it("binds legacy records while retaining foreign records for a later consumer decision", () => {
    const config = makeResolvedConfig("/workspace");
    const boundary = normalizeManifestBoundary(config);
    const owned = makeRecord({
      name: undefined,
      installedPath: path.join(boundary.claudeAgentsHome, "helper.md"),
    });
    const foreign = makeRecord({
      name: undefined,
      installedPath: "/isolated/foreign.md",
    });

    const result = normalizeManifestIdentity(
      {
        version: 1,
        managedBy: "devcanon",
        lastSync: "2026-07-17T00:00:00.000Z",
        records: [owned, foreign],
      },
      config,
    );

    expect(result.manifest.boundary).toEqual(boundary);
    expect(result.manifest.records.map((record) => record.name)).toEqual([
      "helper",
      "foreign",
    ]);
    expect(result.records.map((record) => record.ownership)).toEqual([
      "owned",
      "foreign",
    ]);
  });

  it.each([
    ["target", makeRecord({ target: "codex" })],
    ["type", makeRecord({ type: "skill" })],
    ["name", makeRecord({ name: "other" })],
    [
      "destination",
      makeRecord({ installedPath: "/homes/claude/agents/nested/helper.md" }),
    ],
  ])(
    "classifies a one-dimension %s mismatch as foreign",
    (_dimension, record) => {
      const result = classifyManagedRecord(record, {
        claudeSkillsHome: "/homes/claude/skills",
        claudeAgentsHome: "/homes/claude/agents",
        codexSkillsHome: "/homes/codex/skills",
        codexAgentsHome: "/homes/codex/agents",
      });

      expect(result.ownership).toBe("foreign");
    },
  );
});
