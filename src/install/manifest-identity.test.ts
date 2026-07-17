import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  makeManifestJson,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import type { ManagedRecord } from "../config/schema.js";
import { ManifestSchema } from "../config/schema.js";
import {
  ManifestIdentityError,
  classifyManagedRecord,
  normalizeManifestBoundary,
  normalizeManifestIdentity,
} from "./manifest-identity.js";

const TEST_ROOT = path.resolve("manifest-identity-fixture");
const TEST_BOUNDARY = {
  claudeSkillsHome: path.join(TEST_ROOT, "homes", "claude", "skills"),
  claudeAgentsHome: path.join(TEST_ROOT, "homes", "claude", "agents"),
  codexSkillsHome: path.join(TEST_ROOT, "homes", "codex", "skills"),
  codexAgentsHome: path.join(TEST_ROOT, "homes", "codex", "agents"),
};

function makeRecord(overrides: Partial<ManagedRecord> = {}): ManagedRecord {
  return {
    target: "claude",
    type: "agent",
    name: "helper",
    sourcePath: path.join(TEST_ROOT, "source", "helper.yaml"),
    generatedPath: path.join(TEST_ROOT, "generated", "claude", "helper.md"),
    installedPath: path.join(TEST_BOUNDARY.claudeAgentsHome, "helper.md"),
    installMode: "copy",
    contentHash: "abc",
    timestamp: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("manifest identity schema", () => {
  it("makes current fixture manifests bound to their supplied resolved config", () => {
    const config = makeResolvedConfig(path.join(TEST_ROOT, "fixture-root"));
    const fixture = JSON.parse(
      makeManifestJson(
        [
          {
            target: "codex",
            type: "agent",
            installedPath: path.join(
              config.targets.codex.agentsHome,
              "helper.toml",
            ),
          },
        ],
        { config },
      ),
    );

    expect(fixture.boundary.codexAgentsHome).toBe(
      config.targets.codex.agentsHome,
    );
    expect(fixture.records[0].name).toBe("helper");
    expect(
      JSON.parse(makeManifestJson([], { legacy: true })).boundary,
    ).toBeUndefined();
  });

  it("accepts a bound manifest and named managed record", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      managedBy: "devcanon",
      lastSync: "2026-07-17T00:00:00.000Z",
      boundary: TEST_BOUNDARY,
      records: [
        {
          target: "claude",
          type: "agent",
          name: "helper",
          sourcePath: path.join(TEST_ROOT, "source", "helper.yaml"),
          generatedPath: path.join(
            TEST_ROOT,
            "generated",
            "claude",
            "helper.md",
          ),
          installedPath: path.join(TEST_BOUNDARY.claudeAgentsHome, "helper.md"),
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

  it("rejects a bound manifest with one unnamed record", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      managedBy: "devcanon",
      lastSync: "2026-07-17T00:00:00.000Z",
      boundary: TEST_BOUNDARY,
      records: [
        {
          target: "claude",
          type: "agent",
          sourcePath: path.join(TEST_ROOT, "source", "helper.yaml"),
          generatedPath: path.join(
            TEST_ROOT,
            "generated",
            "claude",
            "helper.md",
          ),
          installedPath: path.join(TEST_BOUNDARY.claudeAgentsHome, "helper.md"),
          installMode: "copy",
          contentHash: "abc",
          timestamp: "2026-07-17T00:00:00.000Z",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unbound manifest with a named record", () => {
    const result = ManifestSchema.safeParse({
      version: 1,
      managedBy: "devcanon",
      lastSync: "2026-07-17T00:00:00.000Z",
      records: [
        {
          target: "claude",
          type: "skill",
          name: "helper",
          sourcePath: path.join(TEST_ROOT, "source", "helper"),
          generatedPath: null,
          installedPath: path.join(TEST_BOUNDARY.claudeSkillsHome, "helper"),
          installMode: "copy",
          contentHash: "abc",
          timestamp: "2026-07-17T00:00:00.000Z",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});

describe("manifest identity", () => {
  it("normalizes all four configured homes without requiring them to exist", () => {
    const workspace = path.join(TEST_ROOT, "workspace");
    const config = makeResolvedConfig(workspace, {
      claude: {
        skillsHome: `${TEST_BOUNDARY.claudeSkillsHome}${path.sep}..${path.sep}skills`,
      },
      codex: { agentsHome: `${TEST_BOUNDARY.codexAgentsHome}${path.sep}.` },
    });

    expect(normalizeManifestBoundary(config)).toEqual({
      claudeSkillsHome: TEST_BOUNDARY.claudeSkillsHome,
      claudeAgentsHome: path.join(workspace, "home", "claude", "agents"),
      codexSkillsHome: path.join(workspace, "home", "codex", "skills"),
      codexAgentsHome: TEST_BOUNDARY.codexAgentsHome,
    });
  });

  it("classifies only the exact target-native direct-child destination as owned", () => {
    const result = classifyManagedRecord(makeRecord(), TEST_BOUNDARY);

    expect(result.ownership).toBe("owned");
    expect(result.name).toBe("helper");
    expect(result.expectedDestination).toBe(
      path.join(TEST_BOUNDARY.claudeAgentsHome, "helper.md"),
    );
  });

  it.each([
    [
      "claude skill",
      "claude",
      "skill",
      "skill-name",
      path.join(TEST_BOUNDARY.claudeSkillsHome, "skill-name"),
    ],
    [
      "claude agent",
      "claude",
      "agent",
      "helper",
      path.join(TEST_BOUNDARY.claudeAgentsHome, "helper.md"),
    ],
    [
      "codex skill",
      "codex",
      "skill",
      "skill-name",
      path.join(TEST_BOUNDARY.codexSkillsHome, "skill-name"),
    ],
    [
      "codex agent",
      "codex",
      "agent",
      "helper",
      path.join(TEST_BOUNDARY.codexAgentsHome, "helper.toml"),
    ],
  ] as const)(
    "owns the exact %s destination",
    (_label, target, type, name, installedPath) => {
      expect(
        classifyManagedRecord(
          makeRecord({ target, type, name, installedPath }),
          TEST_BOUNDARY,
        ).ownership,
      ).toBe("owned");
    },
  );

  it("permits a logical agent name that ends in its rendered suffix", () => {
    expect(
      classifyManagedRecord(
        makeRecord({
          name: "helper.md",
          installedPath: path.join(
            TEST_BOUNDARY.claudeAgentsHome,
            "helper.md.md",
          ),
        }),
        TEST_BOUNDARY,
      ).ownership,
    ).toBe("owned");
  });

  it("permits a Codex logical agent name that ends in .toml", () => {
    expect(
      classifyManagedRecord(
        makeRecord({
          target: "codex",
          type: "agent",
          name: "helper.toml",
          installedPath: path.join(
            TEST_BOUNDARY.codexAgentsHome,
            "helper.toml.toml",
          ),
        }),
        TEST_BOUNDARY,
      ).ownership,
    ).toBe("owned");
  });

  it("derives a legacy agent name only from its target-native suffix", () => {
    const boundary = TEST_BOUNDARY;
    const legacy = makeRecord({ name: undefined });

    expect(classifyManagedRecord(legacy, boundary)).toMatchObject({
      ownership: "owned",
      name: "helper",
    });
    expect(() =>
      classifyManagedRecord(
        makeRecord({
          name: undefined,
          installedPath: path.join(TEST_ROOT, "other", "helper.toml"),
        }),
        boundary,
      ),
    ).toThrow(ManifestIdentityError);
    expect(() =>
      classifyManagedRecord(
        makeRecord({
          name: undefined,
          installedPath: path.join(
            TEST_BOUNDARY.claudeAgentsHome,
            "nested",
            "helper.md",
          ),
        }),
        boundary,
      ),
    ).toThrow("nested installed path");
  });

  it("rejects only an empty logical name", () => {
    expect(() =>
      classifyManagedRecord(makeRecord({ name: "" }), TEST_BOUNDARY),
    ).toThrow("one direct-child name");
  });

  it("rejects only a traversal segment in the installed path", () => {
    const traversingPath = `${TEST_BOUNDARY.claudeAgentsHome}${path.sep}..${path.sep}escaped${path.sep}helper.md`;
    expect(() =>
      classifyManagedRecord(
        makeRecord({ installedPath: traversingPath }),
        TEST_BOUNDARY,
      ),
    ).toThrow("traversal segments");
  });

  it("rejects a stored boundary that differs in one configured home", () => {
    const config = makeResolvedConfig(path.join(TEST_ROOT, "workspace"));
    const expected = normalizeManifestBoundary(config);

    expect(() =>
      normalizeManifestIdentity(
        {
          version: 1,
          managedBy: "devcanon",
          lastSync: "2026-07-17T00:00:00.000Z",
          boundary: {
            ...expected,
            codexAgentsHome: path.join(TEST_ROOT, "other", "codex", "agents"),
          },
          records: [],
        },
        config,
      ),
    ).toThrow(ManifestIdentityError);
  });

  it("rejects a non-canonical stored boundary even when it resolves to the home", () => {
    const config = makeResolvedConfig(path.join(TEST_ROOT, "workspace"));
    const expected = normalizeManifestBoundary(config);

    expect(() =>
      normalizeManifestIdentity(
        {
          version: 1,
          managedBy: "devcanon",
          lastSync: "2026-07-17T00:00:00.000Z",
          boundary: {
            ...expected,
            claudeSkillsHome: `${expected.claudeSkillsHome}${path.sep}.`,
          },
          records: [],
        },
        config,
      ),
    ).toThrow(ManifestIdentityError);
  });

  it("binds legacy records while retaining foreign records for a later consumer decision", () => {
    const config = makeResolvedConfig(path.join(TEST_ROOT, "workspace"));
    const boundary = normalizeManifestBoundary(config);
    const owned = makeRecord({
      name: undefined,
      installedPath: path.join(boundary.claudeAgentsHome, "helper.md"),
    });
    const foreign = makeRecord({
      name: undefined,
      installedPath: path.join(TEST_ROOT, "isolated", "foreign.md"),
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
      makeRecord({
        installedPath: path.join(
          TEST_BOUNDARY.claudeAgentsHome,
          "nested",
          "helper.md",
        ),
      }),
    ],
  ])(
    "classifies a one-dimension %s mismatch as foreign",
    (_dimension, record) => {
      const result = classifyManagedRecord(record, TEST_BOUNDARY);

      expect(result.ownership).toBe("foreign");
    },
  );

  it("marks a schema-valid record in the wrong owning home as foreign", () => {
    const boundary = TEST_BOUNDARY;
    const record = makeRecord({
      installedPath: path.join(TEST_BOUNDARY.codexAgentsHome, "helper.md"),
    });

    expect(
      ManifestSchema.safeParse({
        version: 1,
        managedBy: "devcanon",
        lastSync: "2026-07-17T00:00:00.000Z",
        boundary,
        records: [record],
      }).success,
    ).toBe(true);
    expect(classifyManagedRecord(record, boundary).ownership).toBe("foreign");
  });

  it("marks a schema-valid record with only the wrong target suffix as foreign", () => {
    const boundary = TEST_BOUNDARY;
    const record = makeRecord({
      installedPath: path.join(TEST_BOUNDARY.claudeAgentsHome, "helper.toml"),
    });

    expect(
      ManifestSchema.safeParse({
        version: 1,
        managedBy: "devcanon",
        lastSync: "2026-07-17T00:00:00.000Z",
        boundary,
        records: [record],
      }).success,
    ).toBe(true);
    expect(classifyManagedRecord(record, boundary).ownership).toBe("foreign");
  });

  it("does not inspect filesystem existence when classifying an exact destination", () => {
    const missingRoot = path.join(TEST_ROOT, "missing");
    const boundary = {
      claudeSkillsHome: path.join(missingRoot, "claude", "skills"),
      claudeAgentsHome: path.join(missingRoot, "claude", "agents"),
      codexSkillsHome: path.join(missingRoot, "codex", "skills"),
      codexAgentsHome: path.join(missingRoot, "codex", "agents"),
    };

    expect(
      classifyManagedRecord(
        makeRecord({
          installedPath: path.join(boundary.claudeAgentsHome, "helper.md"),
        }),
        boundary,
      ).ownership,
    ).toBe("owned");
  });
});
