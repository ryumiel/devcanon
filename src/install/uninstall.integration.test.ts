import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createAgentFixture,
  createSkillFixture,
  createTempDir,
  makeAgentYaml,
  makeManifestJson,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import {
  type TestLoggerResult,
  installTestLogger,
} from "../__test-helpers__/logger.js";
import { buildSkillContentHash } from "../render/skill.js";
import { UserError } from "../utils/errors.js";
import { pathExists } from "../utils/fs.js";
import {
  inspectManifest,
  recoverInvalidManifest,
  withManifestPersistenceFaultsForTesting,
} from "./manifest.js";
import { sync } from "./sync.js";
import { uninstall } from "./uninstall.js";

const symlinkAvailable = await canCreateSymlinks();

describe("uninstall", () => {
  let tempDir: string;
  let restoreLogger: () => void;
  let testLogger: TestLoggerResult;

  beforeEach(async () => {
    tempDir = await createTempDir();
    const installed = installTestLogger();
    restoreLogger = installed.restore;
    testLogger = installed.testLogger;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("removes every installed output and clears the manifest", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );

    // Pre-populate via sync
    const syncResult = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
    });
    expect(syncResult.installed).toBeGreaterThan(0);
    expect(syncResult.errors).toEqual([]);

    // Snapshot source files for AC4 verification
    const skillSourceContent = await readFile(
      path.join(config.library.skillsDir, "greet", "SKILL.md"),
      "utf-8",
    );
    const agentSourceContent = await readFile(
      path.join(config.library.agentsDir, "helper.yaml"),
      "utf-8",
    );

    // Sanity: at least one installed path exists (snapshot the list)
    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    const codexAgentPath = path.join(
      config.targets.codex.agentsHome,
      "helper.toml",
    );
    expect(await pathExists(claudeAgentPath)).toBe(true);
    expect(await pathExists(codexAgentPath)).toBe(true);
    // Uninstall
    const result = await uninstall(config, { dryRun: false });

    expect(result.removed).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);

    // All previously installed paths gone
    expect(await pathExists(claudeAgentPath)).toBe(false);
    expect(await pathExists(codexAgentPath)).toBe(false);

    // Manifest has empty records
    const manifestRaw = await readFile(config.manifest.path, "utf-8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.records).toEqual([]);

    // AC4: sources unchanged
    expect(
      await readFile(
        path.join(config.library.skillsDir, "greet", "SKILL.md"),
        "utf-8",
      ),
    ).toBe(skillSourceContent);
    expect(
      await readFile(
        path.join(config.library.agentsDir, "helper.yaml"),
        "utf-8",
      ),
    ).toBe(agentSourceContent);
  });

  it("dry-run prints the plan and makes no changes", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");

    await sync(config, { dryRun: false, force: false, strict: false });

    const manifestBefore = await readFile(config.manifest.path, "utf-8");
    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "greet",
    );
    expect(await pathExists(claudeSkillPath)).toBe(true);

    const result = await uninstall(config, { dryRun: true });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([]);

    // Manifest unchanged
    const manifestAfter = await readFile(config.manifest.path, "utf-8");
    expect(manifestAfter).toBe(manifestBefore);

    // Files still installed
    expect(await pathExists(claudeSkillPath)).toBe(true);

    // Log includes a [remove] line
    expect(testLogger.infos.some((m) => m.includes("[remove]"))).toBe(true);
  });

  it("--target claude removes only Claude records and files", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "greet");
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );

    await sync(config, { dryRun: false, force: false, strict: false });

    const skillSourcePath = path.join(
      config.library.skillsDir,
      "greet",
      "SKILL.md",
    );
    const agentSourcePath = path.join(config.library.agentsDir, "helper.yaml");
    const skillSourceContent = await readFile(skillSourcePath, "utf-8");
    const agentSourceContent = await readFile(agentSourcePath, "utf-8");

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    const codexAgentPath = path.join(
      config.targets.codex.agentsHome,
      "helper.toml",
    );
    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "greet",
    );
    const codexSkillPath = path.join(config.targets.codex.skillsHome, "greet");

    expect(await pathExists(claudeAgentPath)).toBe(true);
    expect(await pathExists(codexAgentPath)).toBe(true);
    const manifestBefore = JSON.parse(
      await readFile(config.manifest.path, "utf-8"),
    );

    const result = await uninstall(config, {
      target: "claude",
      dryRun: false,
    });

    expect(result.errors).toEqual([]);

    // Claude paths gone
    expect(await pathExists(claudeAgentPath)).toBe(false);
    expect(await pathExists(claudeSkillPath)).toBe(false);

    // Codex paths still present
    expect(await pathExists(codexAgentPath)).toBe(true);
    expect(await pathExists(codexSkillPath)).toBe(true);

    // AC4: source files unchanged after a target-scoped uninstall
    expect(await readFile(skillSourcePath, "utf-8")).toBe(skillSourceContent);
    expect(await readFile(agentSourcePath, "utf-8")).toBe(agentSourceContent);

    // Manifest contains only codex records
    const manifest = JSON.parse(await readFile(config.manifest.path, "utf-8"));
    expect(manifest.records).toEqual(
      manifestBefore.records.filter(
        (record: { target: string }) => record.target === "codex",
      ),
    );
  });

  it("emits 'Nothing to remove.' when the manifest is empty", async () => {
    const config = makeResolvedConfig(tempDir);
    // No sync — manifest does not exist; loadManifest returns emptyManifest()

    const result = await uninstall(config, { dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(testLogger.infos).toContain("Nothing to remove.");
  });

  it("emits 'Nothing to remove.' under --dry-run when no records match", async () => {
    const config = makeResolvedConfig(tempDir);
    // Pre-populate manifest with a codex-only record; ask for --target claude
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "codex",
            type: "skill",
            sourcePath: "/x/skills/foo",
            generatedPath: null,
            installedPath: path.join(config.targets.codex.skillsHome, "foo"),
            installMode: "copy",
            contentHash: "abc",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    const result = await uninstall(config, {
      target: "claude",
      dryRun: true,
    });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([]);
    expect(testLogger.infos).toContain("Nothing to remove.");
  });

  it("retains the exact non-target tuple when a target-filtered uninstall prunes a missing record", async () => {
    const config = makeResolvedConfig(tempDir);
    const claudePath = path.join(config.targets.claude.agentsHome, "gone.md");
    const codexPath = path.join(config.targets.codex.agentsHome, "gone.toml");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            name: "gone",
            sourcePath: "/source/gone.yaml",
            generatedPath: null,
            installedPath: claudePath,
            installMode: "copy",
            contentHash: "claude",
            timestamp: new Date().toISOString(),
          },
          {
            target: "codex",
            type: "agent",
            name: "gone",
            sourcePath: "/source/gone.yaml",
            generatedPath: null,
            installedPath: codexPath,
            installMode: "copy",
            contentHash: "codex",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    const result = await uninstall(config, { target: "claude", dryRun: false });

    expect(result).toEqual({ removed: 1, errors: [] });
    const manifest = JSON.parse(await readFile(config.manifest.path, "utf-8"));
    expect(manifest.records).toEqual([
      expect.objectContaining({
        target: "codex",
        type: "agent",
        name: "gone",
        installedPath: codexPath,
      }),
    ]);
  });

  it("rejects a bound foreign record before uninstalling", async () => {
    const config = makeResolvedConfig(tempDir);
    const foreignPath = path.join(tempDir, "foreign", "sentinel.md");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            name: "sentinel",
            sourcePath: "/source/sentinel.yaml",
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    await expect(uninstall(config, { dryRun: false })).rejects.toMatchObject({
      message:
        "Bound manifest contains foreign records; automatic reconciliation is forbidden.",
      hint: "Restore matching configured homes or repair the manifest from a verified backup.",
    });
  });

  it("directs unbound mixed legacy foreign records to reconciliation without mutation", async () => {
    const config = makeResolvedConfig(tempDir);
    const ownedPath = path.join(config.targets.claude.agentsHome, "owned.md");
    const foreignPath = path.join(tempDir, "foreign", "sentinel.md");
    await mkdir(path.dirname(foreignPath), { recursive: true });
    await writeFile(foreignPath, "foreign sentinel bytes", "utf-8");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: "/source/owned.yaml",
            generatedPath: null,
            installedPath: ownedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp: new Date().toISOString(),
          },
          {
            target: "claude",
            type: "agent",
            sourcePath: "/source/sentinel.yaml",
            generatedPath: null,
            installedPath: foreignPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp: new Date().toISOString(),
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    await expect(uninstall(config, { dryRun: false })).rejects.toMatchObject({
      message:
        "Legacy manifest contains foreign records; rerun sync with --reconcile-manifest.",
      hint: "Run sync --reconcile-manifest to safely reconcile the legacy manifest.",
    });

    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
    expect(await readFile(foreignPath, "utf-8")).toBe("foreign sentinel bytes");
    expect(
      (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
        entry.includes(".backup-"),
      ),
    ).toHaveLength(0);
  });

  it.each(["owned-first", "foreign-first"] as const)(
    "prioritizes legacy reconciliation over an exact owned/foreign collision in %s order",
    async (order) => {
      const config = makeResolvedConfig(tempDir);
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "shared.md",
      );
      await mkdir(path.dirname(installedPath), { recursive: true });
      await writeFile(installedPath, "owned sentinel", "utf-8");
      const owned = {
        target: "claude" as const,
        type: "agent" as const,
        sourcePath: "/source/shared.yaml",
        generatedPath: null,
        installedPath,
        installMode: "copy" as const,
        contentHash: "owned",
        timestamp: new Date().toISOString(),
      };
      const foreign = {
        ...owned,
        type: "skill" as const,
        contentHash: "foreign",
      };
      const records =
        order === "owned-first" ? [owned, foreign] : [foreign, owned];
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { legacy: true }),
        "utf-8",
      );
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      await expect(uninstall(config, { dryRun: false })).rejects.toMatchObject({
        message:
          "Legacy manifest contains foreign records; rerun sync with --reconcile-manifest.",
      });

      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
      expect(await readFile(installedPath, "utf-8")).toBe("owned sentinel");
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
          entry.includes(".backup-"),
        ),
      ).toEqual([]);
    },
  );

  it("prioritizes legacy reconciliation over a component-overlapping foreign pair", async () => {
    const config = makeResolvedConfig(tempDir);
    const ancestorPath = path.join(tempDir, "foreign", "ancestor");
    const descendantPath = path.join(ancestorPath, "descendant.toml");
    await mkdir(ancestorPath, { recursive: true });
    await writeFile(descendantPath, "foreign descendant", "utf-8");
    const timestamp = new Date().toISOString();
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            sourcePath: "/source/ancestor",
            generatedPath: null,
            installedPath: ancestorPath,
            installMode: "copy",
            contentHash: "ancestor",
            timestamp,
          },
          {
            target: "codex",
            type: "agent",
            sourcePath: "/source/descendant.yaml",
            generatedPath: null,
            installedPath: descendantPath,
            installMode: "copy",
            contentHash: "descendant",
            timestamp,
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    await expect(uninstall(config, { dryRun: false })).rejects.toThrow(
      "Legacy manifest contains foreign records",
    );

    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
    expect(await readFile(descendantPath, "utf-8")).toBe("foreign descendant");
  });

  it("prioritizes legacy reconciliation over an exact foreign/foreign collision", async () => {
    const config = makeResolvedConfig(tempDir);
    const installedPath = path.join(tempDir, "foreign", "shared.md");
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "foreign sentinel", "utf-8");
    const timestamp = new Date().toISOString();
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: "/source/shared.yaml",
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "agent",
            timestamp,
          },
          {
            target: "claude",
            type: "skill",
            sourcePath: "/source/shared",
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "skill",
            timestamp,
          },
        ],
        { legacy: true },
      ),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    await expect(uninstall(config, { dryRun: false })).rejects.toThrow(
      "Legacy manifest contains foreign records",
    );

    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
    expect(await readFile(installedPath, "utf-8")).toBe("foreign sentinel");
  });

  it("prioritizes bound-foreign repair guidance over an exact collision", async () => {
    const config = makeResolvedConfig(tempDir);
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "shared.md",
    );
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "bound sentinel", "utf-8");
    const timestamp = new Date().toISOString();
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            name: "shared",
            sourcePath: "/source/shared.yaml",
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "owned",
            timestamp,
          },
          {
            target: "claude",
            type: "skill",
            name: "shared.md",
            sourcePath: "/source/shared",
            generatedPath: null,
            installedPath,
            installMode: "copy",
            contentHash: "foreign",
            timestamp,
          },
        ],
        { config },
      ),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    await expect(uninstall(config, { dryRun: false })).rejects.toMatchObject({
      message:
        "Bound manifest contains foreign records; automatic reconciliation is forbidden.",
      hint: "Restore matching configured homes or repair the manifest from a verified backup.",
    });

    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
    expect(await readFile(installedPath, "utf-8")).toBe("bound sentinel");
  });

  it.skipIf(!symlinkAvailable)(
    "preserves an exact bound-foreign collision symlink and its target before repair guidance",
    async () => {
      const config = makeResolvedConfig(tempDir);
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "shared.md",
      );
      const targetPath = path.join(tempDir, "target", "sentinel.md");
      await mkdir(path.dirname(installedPath), { recursive: true });
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, "symlink target sentinel", "utf-8");
      await symlink(targetPath, installedPath, "file");
      const timestamp = new Date().toISOString();
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "agent",
              name: "shared",
              sourcePath: "/source/shared.yaml",
              generatedPath: null,
              installedPath,
              installMode: "symlink",
              contentHash: "owned",
              timestamp,
            },
            {
              target: "claude",
              type: "skill",
              name: "shared.md",
              sourcePath: "/source/shared",
              generatedPath: null,
              installedPath,
              installMode: "copy",
              contentHash: "foreign",
              timestamp,
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      await expect(uninstall(config, { dryRun: false })).rejects.toThrow(
        "Bound manifest contains foreign records",
      );

      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
      expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(installedPath)).toBe(targetPath);
      expect(await readFile(targetPath, "utf-8")).toBe(
        "symlink target sentinel",
      );
    },
  );

  it.each([
    ["exact manifest", "manifest", "exact", "copy", true, "file"],
    [
      "managed below manifest",
      "manifest",
      "control-ancestor",
      "symlink",
      false,
      "missing",
    ],
    [
      "managed above manifest",
      "manifest",
      "control-descendant",
      "copy",
      false,
      "directory",
    ],
    ["exact sibling lock", "lock", "exact", "symlink", true, "missing"],
    [
      "managed below sibling lock",
      "lock",
      "control-ancestor",
      "copy",
      false,
      "missing",
    ],
    [
      "managed above sibling lock",
      "lock",
      "control-descendant",
      "copy",
      false,
      "directory",
    ],
  ] as const)(
    "reserves the %s control relation before uninstall effects",
    async (_label, control, relation, installMode, dryRun, shape) => {
      const scenarioDir = path.join(
        tempDir,
        `uninstall-control-${control}-${relation}`,
      );
      const ordinaryManifestPath = path.join(
        scenarioDir,
        "state",
        "manifest.json",
      );
      const ordinaryLockPath = `${ordinaryManifestPath}.lock`;
      const ordinaryControlPath =
        control === "manifest" ? ordinaryManifestPath : ordinaryLockPath;
      const installedPath =
        relation === "exact"
          ? ordinaryControlPath
          : relation === "control-ancestor"
            ? path.join(ordinaryControlPath, "managed")
            : path.join(scenarioDir, "home", "managed");
      const manifestPath =
        relation === "control-descendant"
          ? path.join(installedPath, "state", "manifest.json")
          : ordinaryManifestPath;
      const lockPath = `${manifestPath}.lock`;
      const skillsHome = path.dirname(installedPath);
      const name = path.basename(installedPath);
      const generatedPath = path.join(scenarioDir, "generated-target");
      const sourcePath = path.join(scenarioDir, "source-target");
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome },
        codex: { enabled: false },
        manifest: { path: manifestPath },
      });
      await mkdir(generatedPath, { recursive: true });
      await mkdir(sourcePath, { recursive: true });
      await writeFile(
        path.join(generatedPath, "generated-sentinel.txt"),
        "generated sentinel",
        "utf-8",
      );
      await writeFile(
        path.join(sourcePath, "source-sentinel.txt"),
        "source sentinel",
        "utf-8",
      );
      if (shape === "directory") {
        await mkdir(installedPath, { recursive: true });
        await writeFile(
          path.join(installedPath, "SKILL.md"),
          "installed directory sentinel",
          "utf-8",
        );
      }
      await mkdir(path.dirname(manifestPath), { recursive: true });
      const manifestBytes = makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            name,
            sourcePath,
            generatedPath,
            installedPath,
            installMode,
            contentHash: "active-control-record",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      );
      await writeFile(manifestPath, manifestBytes, "utf-8");

      let result: Awaited<ReturnType<typeof uninstall>> | undefined;
      let thrown: unknown;
      try {
        result = await uninstall(config, { dryRun });
      } catch (error) {
        thrown = error;
      }

      expect(await readFile(manifestPath, "utf-8")).toBe(manifestBytes);
      expect(await pathExists(lockPath)).toBe(false);
      expect(
        (await readdir(path.dirname(manifestPath))).filter(
          (entry) =>
            entry.includes(".backup-") ||
            entry.includes(".tmp") ||
            entry.endsWith(".lock"),
        ),
      ).toEqual([]);
      expect(
        await readFile(
          path.join(generatedPath, "generated-sentinel.txt"),
          "utf-8",
        ),
      ).toBe("generated sentinel");
      expect(
        await readFile(path.join(sourcePath, "source-sentinel.txt"), "utf-8"),
      ).toBe("source sentinel");
      if (shape === "directory") {
        expect((await lstat(installedPath)).isDirectory()).toBe(true);
        expect(
          await readFile(path.join(installedPath, "SKILL.md"), "utf-8"),
        ).toBe("installed directory sentinel");
      } else if (installedPath !== manifestPath) {
        expect(await pathExists(installedPath)).toBe(false);
      }
      expect(testLogger.infos).toEqual([]);
      expect(result).toBeUndefined();
      expect(thrown).toBeInstanceOf(UserError);
      expect((thrown as Error).message).toContain(
        "Managed output physical path conflict",
      );
      expect((thrown as Error).message).toContain(path.resolve(installedPath));
      expect((thrown as Error).message).toContain(
        control === "lock" && relation !== "control-descendant"
          ? "manifest-lock control path"
          : "manifest control path",
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "preserves an active uninstall symlink that contains the manifest and lock controls",
    async () => {
      const scenarioDir = path.join(tempDir, "uninstall-control-symlink");
      const installedPath = path.join(scenarioDir, "home", "managed");
      const generatedPath = path.join(scenarioDir, "generated-target");
      const manifestPath = path.join(installedPath, "state", "manifest.json");
      const physicalManifestPath = path.join(
        generatedPath,
        "state",
        "manifest.json",
      );
      const config = makeResolvedConfig(scenarioDir, {
        claude: { skillsHome: path.dirname(installedPath) },
        codex: { enabled: false },
        manifest: { path: manifestPath },
      });
      await mkdir(generatedPath, { recursive: true });
      await mkdir(path.dirname(installedPath), { recursive: true });
      await symlink(generatedPath, installedPath, "dir");
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(
        path.join(generatedPath, "generated-sentinel.txt"),
        "generated sentinel",
        "utf-8",
      );
      const manifestBytes = makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            name: "managed",
            sourcePath: path.join(scenarioDir, "source-target"),
            generatedPath,
            installedPath,
            installMode: "symlink",
            contentHash: "active-symlink",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      );
      await writeFile(manifestPath, manifestBytes, "utf-8");

      let result: Awaited<ReturnType<typeof uninstall>> | undefined;
      let thrown: unknown;
      try {
        result = await uninstall(config, { dryRun: false });
      } catch (error) {
        thrown = error;
      }

      expect(await readFile(physicalManifestPath, "utf-8")).toBe(manifestBytes);
      expect(await pathExists(installedPath)).toBe(true);
      expect((await lstat(installedPath)).isSymbolicLink()).toBe(true);
      expect(await readlink(installedPath)).toBe(generatedPath);
      expect(
        await readFile(
          path.join(generatedPath, "generated-sentinel.txt"),
          "utf-8",
        ),
      ).toBe("generated sentinel");
      expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
      expect(
        (await readdir(path.dirname(manifestPath))).filter((entry) =>
          entry.includes(".backup-"),
        ),
      ).toEqual([]);
      expect(testLogger.infos).toEqual([]);
      expect(result).toBeUndefined();
      expect(thrown).toBeInstanceOf(UserError);
      expect((thrown as Error).message).toContain(
        "Managed output physical path conflict",
      );
    },
  );

  it("permits a passive target-filtered record at a manifest control path", async () => {
    const scenarioDir = path.join(tempDir, "uninstall-passive-control");
    const manifestPath = path.join(scenarioDir, "state", "manifest.json");
    const config = makeResolvedConfig(scenarioDir, {
      codex: { skillsHome: path.dirname(manifestPath) },
      manifest: { path: manifestPath },
    });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const manifestBytes = makeManifestJson(
      [
        {
          target: "codex",
          type: "skill",
          name: path.basename(manifestPath),
          sourcePath: path.join(scenarioDir, "source-target"),
          generatedPath: path.join(scenarioDir, "generated-target"),
          installedPath: manifestPath,
          installMode: "copy",
          contentHash: "passive-control-record",
          timestamp: new Date().toISOString(),
        },
      ],
      { config },
    );
    await writeFile(manifestPath, manifestBytes, "utf-8");

    const result = await uninstall(config, {
      target: "claude",
      dryRun: true,
    });

    expect(result).toEqual({ removed: 0, errors: [] });
    expect(await readFile(manifestPath, "utf-8")).toBe(manifestBytes);
    expect(testLogger.infos).toEqual(["Nothing to remove."]);
    expect(await pathExists(`${manifestPath}.lock`)).toBe(false);
  });

  it.each([
    ["active-ancestor", "selected-first"],
    ["active-ancestor", "retained-first"],
    ["passive-ancestor", "selected-first"],
    ["passive-ancestor", "retained-first"],
  ] as const)(
    "rejects target-scoped %s component overlap in %s order before removal",
    async (direction, order) => {
      const scenarioDir = path.join(tempDir, `${direction}-${order}`);
      const root = path.join(scenarioDir, "managed");
      const config =
        direction === "active-ancestor"
          ? makeResolvedConfig(scenarioDir, {
              claude: { skillsHome: root },
              codex: { agentsHome: path.join(root, "outer") },
            })
          : makeResolvedConfig(scenarioDir, {
              codex: { skillsHome: root },
              claude: { agentsHome: path.join(root, "outer") },
            });
      const active =
        direction === "active-ancestor"
          ? {
              target: "claude" as const,
              type: "skill" as const,
              name: "outer",
              sourcePath: "/source/outer",
              generatedPath: null,
              installedPath: path.join(
                config.targets.claude.skillsHome,
                "outer",
              ),
              installMode: "copy" as const,
              contentHash: "active",
              timestamp: new Date().toISOString(),
            }
          : {
              target: "claude" as const,
              type: "agent" as const,
              name: "inner",
              sourcePath: "/source/inner.yaml",
              generatedPath: null,
              installedPath: path.join(
                config.targets.claude.agentsHome,
                "inner.md",
              ),
              installMode: "copy" as const,
              contentHash: "active",
              timestamp: new Date().toISOString(),
            };
      const passive =
        direction === "active-ancestor"
          ? {
              target: "codex" as const,
              type: "agent" as const,
              name: "inner",
              sourcePath: "/source/inner.yaml",
              generatedPath: null,
              installedPath: path.join(
                config.targets.codex.agentsHome,
                "inner.toml",
              ),
              installMode: "copy" as const,
              contentHash: "passive",
              timestamp: new Date().toISOString(),
            }
          : {
              target: "codex" as const,
              type: "skill" as const,
              name: "outer",
              sourcePath: "/source/outer",
              generatedPath: null,
              installedPath: path.join(
                config.targets.codex.skillsHome,
                "outer",
              ),
              installMode: "copy" as const,
              contentHash: "passive",
              timestamp: new Date().toISOString(),
            };
      if (active.type === "agent") {
        await mkdir(path.dirname(active.installedPath), { recursive: true });
        await writeFile(active.installedPath, "active sentinel", "utf-8");
      } else {
        await mkdir(active.installedPath, { recursive: true });
        await writeFile(
          path.join(active.installedPath, "SKILL.md"),
          "active sentinel",
          "utf-8",
        );
      }
      if (passive.type === "agent") {
        await mkdir(path.dirname(passive.installedPath), { recursive: true });
        await writeFile(passive.installedPath, "passive sentinel", "utf-8");
      } else {
        await mkdir(passive.installedPath, { recursive: true });
        await writeFile(
          path.join(passive.installedPath, "SKILL.md"),
          "passive sentinel",
          "utf-8",
        );
      }
      const records =
        order === "selected-first" ? [active, passive] : [passive, active];
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      let thrown: unknown;
      try {
        await uninstall(config, { target: "claude", dryRun: false });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(UserError);
      expect((thrown as Error).message).toContain(
        "Managed output physical path conflict",
      );
      expect((thrown as Error).message).toContain(active.installedPath);
      expect((thrown as Error).message).toContain(passive.installedPath);
      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
      expect(await pathExists(active.installedPath)).toBe(true);
      expect(await pathExists(passive.installedPath)).toBe(true);
      expect(testLogger.infos).toEqual([]);
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter((entry) =>
          entry.includes(".backup-"),
        ),
      ).toEqual([]);
    },
  );

  it("treats all accepted records as active without a target filter", async () => {
    const root = path.join(tempDir, "all-active");
    const config = makeResolvedConfig(tempDir, {
      claude: { skillsHome: root },
      codex: { agentsHome: path.join(root, "outer") },
    });
    const ancestorPath = path.join(config.targets.claude.skillsHome, "outer");
    const descendantPath = path.join(
      config.targets.codex.agentsHome,
      "inner.toml",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "skill",
            name: "outer",
            sourcePath: "/source/outer",
            generatedPath: null,
            installedPath: ancestorPath,
            installMode: "copy",
            contentHash: "ancestor",
            timestamp: new Date().toISOString(),
          },
          {
            target: "codex",
            type: "agent",
            name: "inner",
            sourcePath: "/source/inner.yaml",
            generatedPath: null,
            installedPath: descendantPath,
            installMode: "copy",
            contentHash: "descendant",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );

    await expect(uninstall(config, { dryRun: true })).rejects.toThrow(
      "Managed output physical path conflict",
    );
  });

  it("allows duplicate entries for the same complete managed tuple", async () => {
    const config = makeResolvedConfig(tempDir);
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "same.md",
    );
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "same tuple sentinel", "utf-8");
    const record = {
      target: "claude" as const,
      type: "agent" as const,
      name: "same",
      sourcePath: "/source/same.yaml",
      generatedPath: null,
      installedPath,
      installMode: "copy" as const,
      contentHash: "same",
      timestamp: new Date().toISOString(),
    };
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await writeFile(
      config.manifest.path,
      makeManifestJson([record, { ...record }], { config }),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    const result = await uninstall(config, { target: "claude", dryRun: true });

    expect(result).toEqual({ removed: 0, errors: [] });
    expect(
      testLogger.infos.filter((line) => line.includes("[remove]")),
    ).toHaveLength(2);
    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
    expect(await readFile(installedPath, "utf-8")).toBe("same tuple sentinel");
  });

  it.each(["ancestor-first", "descendant-first"] as const)(
    "allows target-filtered passive-passive component overlap in %s order",
    async (order) => {
      const root = path.join(tempDir, `passive-${order}`);
      const config = makeResolvedConfig(tempDir, {
        codex: {
          skillsHome: root,
          agentsHome: path.join(root, "outer"),
        },
      });
      const ancestor = {
        target: "codex" as const,
        type: "skill" as const,
        name: "outer",
        sourcePath: "/source/outer",
        generatedPath: null,
        installedPath: path.join(config.targets.codex.skillsHome, "outer"),
        installMode: "copy" as const,
        contentHash: "ancestor",
        timestamp: new Date().toISOString(),
      };
      const descendant = {
        target: "codex" as const,
        type: "agent" as const,
        name: "inner",
        sourcePath: "/source/inner.yaml",
        generatedPath: null,
        installedPath: path.join(config.targets.codex.agentsHome, "inner.toml"),
        installMode: "copy" as const,
        contentHash: "descendant",
        timestamp: new Date().toISOString(),
      };
      await mkdir(ancestor.installedPath, { recursive: true });
      await writeFile(
        path.join(ancestor.installedPath, "SKILL.md"),
        "ancestor sentinel",
        "utf-8",
      );
      await mkdir(path.dirname(descendant.installedPath), { recursive: true });
      await writeFile(descendant.installedPath, "descendant sentinel", "utf-8");
      const records =
        order === "ancestor-first"
          ? [ancestor, descendant]
          : [descendant, ancestor];
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await writeFile(
        config.manifest.path,
        makeManifestJson(records, { config }),
        "utf-8",
      );
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      const result = await uninstall(config, {
        target: "claude",
        dryRun: true,
      });

      expect(result).toEqual({ removed: 0, errors: [] });
      expect(testLogger.infos).toContain("Nothing to remove.");
      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
      expect(await pathExists(ancestor.installedPath)).toBe(true);
      expect(await pathExists(descendant.installedPath)).toBe(true);
    },
  );

  it.each([
    ["json", "{corrupt uninstall"],
    ["schema", '{"version":1}'],
    ["lock", ""],
    ["unsafe-lock", ""],
    ["unsafe-source", ""],
  ] as const)(
    "keeps %s invalid dry uninstall observationally pure with evidence-specific guidance",
    async (kind, invalidBytes) => {
      const scenarioDir = path.join(tempDir, `dry-${kind}`);
      const config = makeResolvedConfig(scenarioDir);
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "managed.md",
      );
      await mkdir(path.dirname(installedPath), { recursive: true });
      await writeFile(installedPath, "managed sentinel", "utf-8");
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      if (kind === "lock") {
        await writeFile(
          `${config.manifest.path}.lock`,
          "residual lock sentinel",
          "utf-8",
        );
      } else if (kind === "unsafe-lock") {
        await mkdir(`${config.manifest.path}.lock`, { recursive: true });
      } else if (kind === "unsafe-source") {
        await mkdir(config.manifest.path, { recursive: true });
      } else {
        await writeFile(config.manifest.path, invalidBytes, "utf-8");
      }

      let thrown: unknown;
      try {
        await uninstall(config, { dryRun: true });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UserError);
      if (kind === "json" || kind === "schema") {
        expect((thrown as UserError).hint).toContain("non-dry uninstall");
        expect(await readFile(config.manifest.path, "utf-8")).toBe(
          invalidBytes,
        );
      } else if (kind === "lock" || kind === "unsafe-lock") {
        expect((thrown as Error).message).toContain(
          `${config.manifest.path}.lock`,
        );
        expect((thrown as UserError).hint).toContain("manually");
        expect((thrown as UserError).hint).not.toContain("non-dry");
        if (kind === "lock") {
          expect(await readFile(`${config.manifest.path}.lock`, "utf-8")).toBe(
            "residual lock sentinel",
          );
        } else {
          expect(
            (await lstat(`${config.manifest.path}.lock`)).isDirectory(),
          ).toBe(true);
        }
      } else {
        expect((thrown as Error).message).toContain(config.manifest.path);
        expect((thrown as UserError).hint).toContain("regular file");
        expect((thrown as UserError).hint).not.toContain("non-dry");
        expect((await lstat(config.manifest.path)).isDirectory()).toBe(true);
      }
      expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
      expect(testLogger.infos).not.toContain("Nothing to remove.");
      expect(testLogger.warnings).toEqual([]);
      expect(
        (await readdir(path.dirname(config.manifest.path))).filter(
          (entry) =>
            entry.includes(".bak") ||
            entry.includes(".backup-") ||
            entry.includes(".tmp"),
        ),
      ).toEqual([]);
    },
  );

  it("recovers a schema-invalid manifest to the exact allocated backup before no-managed-record behavior", async () => {
    const config = makeResolvedConfig(tempDir);
    const invalidBytes = '{"version":1}';
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "managed.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(`${config.manifest.path}.bak`, "occupied", "utf-8");
    await writeFile(installedPath, "managed sentinel", "utf-8");

    const result = await uninstall(config, { dryRun: false });

    expect(result).toEqual({ removed: 0, errors: [] });
    expect(await readFile(`${config.manifest.path}.bak`, "utf-8")).toBe(
      "occupied",
    );
    expect(await readFile(`${config.manifest.path}.bak-1`, "utf-8")).toBe(
      invalidBytes,
    );
    expect(testLogger.warnings).toEqual([
      `Recovered invalid manifest to verified backup ${config.manifest.path}.bak-1.`,
    ]);
    expect(testLogger.infos).toContain("Nothing to remove.");
    expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
  });

  it.each([
    ["source-changed", "recovery-after-candidate"],
    ["source-unavailable-or-unsafe", "recovery-before-candidate"],
    ["backup-create-or-verify-failed", "recovery-candidate-write"],
    ["source-retirement-failed", "recovery-retirement"],
  ] as const)(
    "stops real invalid uninstall on pre-I5 %s before no-op, removal, or save",
    async (category, faultStage) => {
      const scenarioDir = path.join(tempDir, `uninstall-${category}`);
      const config = makeResolvedConfig(scenarioDir);
      const invalidBytes = `{corrupt ${category}`;
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "managed.md",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(installedPath), { recursive: true });
      await writeFile(config.manifest.path, invalidBytes, "utf-8");
      await writeFile(installedPath, "managed sentinel", "utf-8");

      let thrown: unknown;
      try {
        await withManifestPersistenceFaultsForTesting(
          async (stage) => {
            if (stage !== faultStage) return;
            if (category === "source-changed") {
              await writeFile(config.manifest.path, "{replacement", "utf-8");
              return;
            }
            if (category === "source-unavailable-or-unsafe") {
              await rm(config.manifest.path);
              await mkdir(config.manifest.path);
              return;
            }
            throw new Error(`injected ${category}`);
          },
          () => uninstall(config, { dryRun: false }),
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UserError);
      expect((thrown as Error).message).toContain(category);
      expect((thrown as Error & { cause?: unknown }).cause).toBeInstanceOf(
        Error,
      );
      expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
      expect(testLogger.infos).not.toContain("Nothing to remove.");
      expect(testLogger.warnings).toEqual([]);
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    },
  );

  it("preserves lock-unavailable as the primary real uninstall recovery failure", async () => {
    const config = makeResolvedConfig(tempDir);
    const invalidBytes = "{corrupt lock contention";
    const lockPath = `${config.manifest.path}.lock`;
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "managed.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(lockPath, "other writer", "utf-8");
    await writeFile(installedPath, "managed sentinel", "utf-8");

    let thrown: unknown;
    try {
      await uninstall(config, { dryRun: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      hint: `Confirm no DevCanon manifest operation is active, then manually correct the pre-existing sibling lock at ${lockPath}.`,
    });
    expect((thrown as UserError).hint).not.toContain(".bak");

    expect(await readFile(config.manifest.path, "utf-8")).toBe(invalidBytes);
    expect(await readFile(lockPath, "utf-8")).toBe("other writer");
    expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
    expect(testLogger.infos).not.toContain("Nothing to remove.");
    expect(testLogger.warnings).toEqual([]);
  });

  it.each(["EACCES", "EROFS", "ENOSPC", "EMFILE"] as const)(
    "reports an injected %s recovery lock failure without lock-removal guidance",
    async (code) => {
      const scenarioDir = path.join(tempDir, `uninstall-lock-${code}`);
      const config = makeResolvedConfig(scenarioDir);
      const primary = Object.assign(new Error(`injected ${code}`), { code });
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "managed.md",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(installedPath), { recursive: true });
      await writeFile(config.manifest.path, "{corrupt", "utf-8");
      await writeFile(installedPath, "managed sentinel", "utf-8");

      let thrown: unknown;
      try {
        await withManifestPersistenceFaultsForTesting(
          (stage) => {
            if (stage === ("recovery-lock-open" as typeof stage)) {
              throw primary;
            }
          },
          () => uninstall(config, { dryRun: false }),
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toMatchObject({
        message: expect.stringContaining("lock-unavailable"),
        cause: primary,
        hint: "Resolve the reported manifest state before retrying uninstall.",
      });
      expect((thrown as UserError).hint).not.toContain("manually");
      expect(await readFile(config.manifest.path, "utf-8")).toBe("{corrupt");
      expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
      expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
      expect(testLogger.infos).not.toContain("Nothing to remove.");
      expect(testLogger.warnings).toEqual([]);
    },
  );

  it("reports an injected pre-open EEXIST recovery lock failure without lock-removal guidance", async () => {
    const scenarioDir = path.join(tempDir, "uninstall-lock-EEXIST");
    const config = makeResolvedConfig(scenarioDir);
    const primary = Object.assign(new Error("injected EEXIST"), {
      code: "EEXIST",
    });
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "managed.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(config.manifest.path, "{corrupt", "utf-8");
    await writeFile(installedPath, "managed sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === ("recovery-lock-open" as typeof stage)) {
            throw primary;
          }
        },
        () => uninstall(config, { dryRun: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      cause: primary,
      hint: "Resolve the reported manifest state before retrying uninstall.",
    });
    expect((thrown as UserError).hint).not.toContain("manually");
    expect(await readFile(config.manifest.path, "utf-8")).toBe("{corrupt");
    expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual([
      "home",
      "manifest.json",
    ]);
    expect(testLogger.infos).not.toContain("Nothing to remove.");
    expect(testLogger.warnings).toEqual([]);
  });

  it("does not replay a genuine contention cause as pre-existing uninstall custody", async () => {
    const contentionPath = path.join(
      tempDir,
      "genuine-uninstall-contention.json",
    );
    await writeFile(contentionPath, "{corrupt", "utf-8");
    const contentionInspection = await inspectManifest(contentionPath);
    await writeFile(`${contentionPath}.lock`, "active", "utf-8");
    const contention = await recoverInvalidManifest(contentionInspection);
    if (contention.completed) throw new Error("expected contention result");
    const replayedCause = contention.cause;
    expect((replayedCause as NodeJS.ErrnoException).code).toBe("EEXIST");

    const scenarioDir = path.join(tempDir, "uninstall-replayed-EEXIST");
    const config = makeResolvedConfig(scenarioDir);
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "managed.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(config.manifest.path, "{corrupt", "utf-8");
    await writeFile(installedPath, "managed sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === ("recovery-lock-open" as typeof stage)) {
            throw replayedCause;
          }
        },
        () => uninstall(config, { dryRun: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("lock-unavailable"),
      cause: replayedCause,
      hint: "Resolve the reported manifest state before retrying uninstall.",
    });
    expect((thrown as Error & { cause?: unknown }).cause).toBe(replayedCause);
    expect((thrown as UserError).hint).not.toContain("manually");
    expect(await readFile(config.manifest.path, "utf-8")).toBe("{corrupt");
    expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
    expect(await pathExists(`${config.manifest.path}.bak`)).toBe(false);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual([
      "home",
      "manifest.json",
    ]);
    expect(testLogger.infos).not.toContain("Nothing to remove.");
    expect(testLogger.warnings).toEqual([]);
  });

  it("reports the exact retained unverifiable candidate before uninstall effects", async () => {
    const config = makeResolvedConfig(tempDir);
    const invalidBytes = "{corrupt pre-stat candidate";
    const candidatePath = `${config.manifest.path}.bak`;
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "managed.md",
    );
    const primary = new Error("candidate stat fault");
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(installedPath, "managed sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        (stage) => {
          if (stage === "recovery-candidate-stat") throw primary;
        },
        () => uninstall(config, { dryRun: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      cause: primary,
      hint: `Inspect and preserve the unverifiable recovery candidate at ${candidatePath}; do not remove it by pathname alone.`,
    });
    expect((thrown as Error).message).toContain(primary.message);
    expect((thrown as Error & { cause?: unknown }).cause).toBe(primary);
    expect(await readFile(config.manifest.path, "utf-8")).toBe(invalidBytes);
    expect(await readFile(candidatePath, "utf-8")).toBe("");
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
    expect(testLogger.infos).not.toContain("Nothing to remove.");
    expect(testLogger.warnings).toEqual([]);
    expect((await readdir(path.dirname(config.manifest.path))).sort()).toEqual(
      [
        "home",
        path.basename(config.manifest.path),
        path.basename(candidatePath),
      ].sort(),
    );
  });

  it("reports an exact candidate replacement as unmanaged custody", async () => {
    const config = makeResolvedConfig(tempDir);
    const invalidBytes = "{corrupt candidate replacement";
    const candidatePath = `${config.manifest.path}.bak`;
    const replacementPath = `${candidatePath}.replacement`;
    const replacementBytes = "unmanaged replacement";
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "managed.md",
    );
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(installedPath, "managed sentinel", "utf-8");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage !== "recovery-after-candidate") return;
          await writeFile(replacementPath, replacementBytes, "utf-8");
          await rm(candidatePath);
          await rename(replacementPath, candidatePath);
        },
        () => uninstall(config, { dryRun: false }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      hint: `Preserve and inspect the unmanaged replacement at ${candidatePath}; it is not owned by recovery and must not be auto-deleted.`,
    });
    expect((thrown as Error & { hint?: string }).hint).not.toContain(
      "owned recovery candidate",
    );
    expect(await readFile(config.manifest.path, "utf-8")).toBe(invalidBytes);
    expect(await readFile(candidatePath, "utf-8")).toBe(replacementBytes);
    expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
    expect(testLogger.infos).not.toContain("Nothing to remove.");
    expect(testLogger.warnings).toEqual([]);
  });

  it("reports primary failure before retained candidate and lock actions", async ({
    skip,
  }) => {
    const config = makeResolvedConfig(tempDir);
    const manifestDir = path.dirname(config.manifest.path);
    const invalidBytes = "{corrupt retained artifacts";
    const candidatePath = `${config.manifest.path}.bak`;
    const lockPath = `${config.manifest.path}.lock`;
    const installedPath = path.join(
      config.targets.claude.agentsHome,
      "managed.md",
    );
    await mkdir(manifestDir, { recursive: true });
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(config.manifest.path, invalidBytes, "utf-8");
    await writeFile(installedPath, "managed sentinel", "utf-8");
    const probePath = path.join(manifestDir, "permission-probe");
    await writeFile(probePath, "probe", "utf-8");
    await chmod(manifestDir, 0o500);
    let permissionsEnforced = false;
    try {
      try {
        await rm(probePath);
      } catch {
        permissionsEnforced = true;
      }
    } finally {
      await chmod(manifestDir, 0o700);
    }
    if (!permissionsEnforced) {
      await rm(probePath, { force: true });
      skip();
      return;
    }
    await rm(probePath);
    const primary = new Error("primary candidate verification failure");

    let thrown: unknown;
    try {
      await withManifestPersistenceFaultsForTesting(
        async (stage) => {
          if (stage !== "recovery-after-candidate") return;
          await chmod(manifestDir, 0o500);
          throw primary;
        },
        () => uninstall(config, { dryRun: false }),
      );
    } catch (error) {
      thrown = error;
    } finally {
      await chmod(manifestDir, 0o700);
    }

    const candidateAction = `Inspect the retained owned recovery candidate at ${candidatePath} before any manual removal.`;
    const lockAction = `Confirm no DevCanon manifest operation is active, then manually remove or correct the retained owned recovery lock at ${lockPath}.`;
    expect(thrown).toMatchObject({
      message: expect.stringContaining("backup-create-or-verify-failed"),
      cause: primary,
      hint: `${candidateAction} ${lockAction}`,
    });
    const hint = (thrown as UserError).hint ?? "";
    expect(hint.indexOf(candidateAction)).toBeLessThan(
      hint.indexOf(lockAction),
    );
    expect(await readFile(config.manifest.path, "utf-8")).toBe(invalidBytes);
    expect(await readFile(candidatePath, "utf-8")).toBe(invalidBytes);
    expect(await readFile(lockPath, "utf-8")).toBe("");
    expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
    expect(testLogger.infos).not.toContain("Nothing to remove.");
    expect(testLogger.warnings).toEqual([]);
    expect((await readdir(manifestDir)).sort()).toEqual(
      [
        "home",
        path.basename(config.manifest.path),
        path.basename(candidatePath),
        path.basename(lockPath),
      ].sort(),
    );
  });

  it.each([
    [true, false, "close-degraded"],
    [false, true, "unlink-degraded"],
    [true, true, "both-degraded"],
  ] as const)(
    "stops uninstall after committed recovery with %s/%s cleanup as %s",
    async (failClose, failUnlink, cleanup) => {
      const scenarioDir = path.join(tempDir, `uninstall-${cleanup}`);
      const config = makeResolvedConfig(scenarioDir);
      const invalidBytes = `{corrupt ${cleanup}`;
      const installedPath = path.join(
        config.targets.claude.agentsHome,
        "managed.md",
      );
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.dirname(installedPath), { recursive: true });
      await writeFile(config.manifest.path, invalidBytes, "utf-8");
      await writeFile(installedPath, "managed sentinel", "utf-8");

      await expect(
        withManifestPersistenceFaultsForTesting(
          () => {},
          () => uninstall(config, { dryRun: false }),
          {
            injectPostAttemptOutcome: ({ operation }) => {
              if (failClose && operation === "recovery-lock-close") {
                return new Error("injected close degradation");
              }
              if (failUnlink && operation === "recovery-lock-unlink") {
                return new Error("injected unlink degradation");
              }
              return undefined;
            },
          },
        ),
      ).rejects.toThrow(cleanup);

      expect(await pathExists(config.manifest.path)).toBe(false);
      expect(await readFile(`${config.manifest.path}.bak`, "utf-8")).toBe(
        invalidBytes,
      );
      expect(await readFile(installedPath, "utf-8")).toBe("managed sentinel");
      expect(testLogger.warnings).toEqual([
        `Manifest recovery committed to verified backup ${config.manifest.path}.bak, but cleanup degraded (${cleanup}).`,
      ]);
      expect(testLogger.warnings.join("\n")).not.toContain(
        "Recovered invalid manifest to verified backup",
      );
      expect(testLogger.infos).not.toContain("Nothing to remove.");
      expect(await pathExists(`${config.manifest.path}.lock`)).toBe(false);
    },
  );

  it("skips uninstall removal when copied agent content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );
    await sync(config, { dryRun: false, force: false, strict: false });

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    await writeFile(claudeAgentPath, "tampered installed content", "utf-8");
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    const result = await uninstall(config, { target: "claude", dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(await readFile(claudeAgentPath, "utf-8")).toBe(
      "tampered installed content",
    );
    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
  });

  it("skips uninstall removal when copied skill directory content no longer matches the manifest", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    const skillDir = await createSkillFixture(
      config.library.skillsDir,
      "skill-a",
      "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
      ["scripts"],
    );
    await writeFile(
      path.join(skillDir, "scripts", "helper.sh"),
      "#!/bin/sh\necho helper\n",
      "utf-8",
    );
    await sync(config, { dryRun: false, force: false, strict: false });

    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "skill-a",
    );
    await writeFile(
      path.join(claudeSkillPath, "scripts", "helper.sh"),
      "tampered helper\n",
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    const result = await uninstall(config, { target: "claude", dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("installed copy content hash mismatch"),
    ]);
    expect(
      await readFile(
        path.join(claudeSkillPath, "scripts", "helper.sh"),
        "utf-8",
      ),
    ).toBe("tampered helper\n");
    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
  });

  it("reports copy identity failure when installed skill kind changes before uninstall", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createSkillFixture(config.library.skillsDir, "skill-a");
    await sync(config, { dryRun: false, force: false, strict: false });

    const claudeSkillPath = path.join(
      config.targets.claude.skillsHome,
      "skill-a",
    );
    await rm(claudeSkillPath, { recursive: true });
    await writeFile(claudeSkillPath, "not a directory", "utf-8");
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    const result = await uninstall(config, { target: "claude", dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("Managed output identity failure"),
    ]);
    expect(result.errors[0]).toContain("installed skill is not a directory");
    expect(await readFile(claudeSkillPath, "utf-8")).toBe("not a directory");
    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
  });

  it.skipIf(!symlinkAvailable)(
    "uninstalls a copied skill when copied symlink target spelling was rewritten",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      const sourceLinkTarget = "../target-a/payload.txt";
      await symlink(
        sourceLinkTarget,
        path.join(skillDir, "scripts", "link.txt"),
      );
      await sync(config, { dryRun: false, force: false, strict: false });

      const claudeSkillPath = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
      );
      const installedLink = path.join(claudeSkillPath, "scripts", "link.txt");
      const generatedLink = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.resolve(
        path.dirname(generatedLink),
        sourceLinkTarget,
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");

      const result = await uninstall(config, {
        target: "claude",
        dryRun: false,
      });

      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(await pathExists(claudeSkillPath)).toBe(false);
      const manifest = JSON.parse(
        await readFile(config.manifest.path, "utf-8"),
      );
      expect(manifest.records).toEqual([]);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips copied skill uninstall when copied symlink resolves elsewhere",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await symlink(
        "../target-a/payload.txt",
        path.join(skillDir, "scripts", "link.txt"),
      );
      await sync(config, { dryRun: false, force: false, strict: false });

      const claudeSkillPath = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
      );
      const installedLink = path.join(claudeSkillPath, "scripts", "link.txt");
      const foreignTarget = path.join(tempDir, "outside", "payload.txt");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await writeFile(foreignTarget, "foreign", "utf-8");
      await rm(installedLink);
      await symlink(foreignTarget, installedLink, "file");
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      const result = await uninstall(config, {
        target: "claude",
        dryRun: false,
      });

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("installed copy content hash mismatch"),
      ]);
      expect(await readlink(installedLink)).toBe(foreignTarget);
      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "uninstalls a copied skill with an absolute mirrored symlink",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      const absoluteTarget = path.join(
        tempDir,
        "absolute-target",
        "payload.txt",
      );
      await mkdir(path.dirname(absoluteTarget), { recursive: true });
      await writeFile(absoluteTarget, "payload", "utf-8");
      await symlink(absoluteTarget, path.join(skillDir, "scripts", "link.txt"));
      await sync(config, { dryRun: false, force: false, strict: false });

      const result = await uninstall(config, {
        target: "claude",
        dryRun: false,
      });

      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
      const manifest = JSON.parse(
        await readFile(config.manifest.path, "utf-8"),
      );
      expect(manifest.records).toEqual([]);
    },
  );

  it.skipIf(!symlinkAvailable)(
    "uninstalls a copied skill when a dot-relative symlink was rewritten absolute",
    async () => {
      const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      const skillDir = await createSkillFixture(
        config.library.skillsDir,
        "skill-a",
        "---\nname: skill-a\ndescription: A skill.\n---\n\n# Skill A\n",
        ["scripts"],
      );
      await writeFile(
        path.join(skillDir, "scripts", "payload.txt"),
        "payload",
        "utf-8",
      );
      await symlink(
        "./payload.txt",
        path.join(skillDir, "scripts", "link.txt"),
      );
      await sync(config, { dryRun: false, force: false, strict: false });

      const installedLink = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
        "scripts",
        "link.txt",
      );
      const rewrittenTarget = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
        "scripts",
        "payload.txt",
      );
      await rm(installedLink);
      await symlink(rewrittenTarget, installedLink, "file");

      const result = await uninstall(config, {
        target: "claude",
        dryRun: false,
      });

      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
      const manifest = JSON.parse(
        await readFile(config.manifest.path, "utf-8"),
      );
      expect(manifest.records).toEqual([]);
    },
  );

  it("clears a contained manifest record when the installed output is already missing", async () => {
    const config = makeResolvedConfig(tempDir, { codex: { enabled: false } });
    await mkdir(config.library.skillsDir, { recursive: true });
    await mkdir(config.library.agentsDir, { recursive: true });
    await createAgentFixture(
      config.library.agentsDir,
      "helper",
      makeAgentYaml("helper"),
    );
    await sync(config, { dryRun: false, force: false, strict: false });

    const claudeAgentPath = path.join(
      config.targets.claude.agentsHome,
      "helper.md",
    );
    await rm(claudeAgentPath);

    const result = await uninstall(config, { target: "claude", dryRun: false });

    expect(result.removed).toBe(1);
    expect(result.errors).toEqual([]);
    const manifest = JSON.parse(await readFile(config.manifest.path, "utf-8"));
    expect(manifest.records).toEqual([]);
  });

  it("keeps a missing manifest record when the installed path is outside the target home", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const outsidePath = path.join(tempDir, "outside", "missing.md");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "missing.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "missing.md",
            ),
            installedPath: outsidePath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    await expect(uninstall(config, { dryRun: false })).rejects.toThrow(
      "Bound manifest contains foreign records",
    );
    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
  });

  it.skipIf(!symlinkAvailable)(
    "keeps a missing manifest record when the installed path crosses a symlinked parent",
    async () => {
      const config = makeResolvedConfig(tempDir);
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const outsideDir = path.join(tempDir, "outside");
      const linkParent = path.join(config.targets.claude.agentsHome, "alias");
      const installedPath = path.join(linkParent, "missing.md");
      await mkdir(config.targets.claude.agentsHome, { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, linkParent, "dir");
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "agent",
              sourcePath: path.join(config.library.agentsDir, "missing.yaml"),
              generatedPath: path.join(
                config.library.generatedDir,
                "claude",
                "agents",
                "missing.md",
              ),
              installedPath,
              installMode: "copy",
              contentHash: "wrong-hash",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      await expect(uninstall(config, { dryRun: false })).rejects.toThrow(
        "Bound manifest contains foreign records",
      );
      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "skips uninstall removal when an installed symlink points elsewhere",
    async () => {
      const config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { enabled: false },
        defaults: { installMode: "symlink" },
      });
      await mkdir(config.library.skillsDir, { recursive: true });
      await mkdir(config.library.agentsDir, { recursive: true });
      await createAgentFixture(
        config.library.agentsDir,
        "helper",
        makeAgentYaml("helper"),
      );
      await sync(config, { dryRun: false, force: false, strict: false });

      const claudeAgentPath = path.join(
        config.targets.claude.agentsHome,
        "helper.md",
      );
      await rm(claudeAgentPath);
      const foreignTarget = path.join(tempDir, "outside", "foreign.md");
      await mkdir(path.dirname(foreignTarget), { recursive: true });
      await writeFile(foreignTarget, "foreign", "utf-8");
      await symlink(foreignTarget, claudeAgentPath, "file");
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      const result = await uninstall(config, {
        target: "claude",
        dryRun: false,
      });

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("symlink target mismatch"),
      ]);
      expect(await readlink(claudeAgentPath)).toBe(foreignTarget);
      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
    },
  );

  it("skips uninstall removal when manifest installed path is outside the target home", async () => {
    const config = makeResolvedConfig(tempDir);
    await mkdir(path.dirname(config.manifest.path), { recursive: true });
    const outsidePath = path.join(tempDir, "outside", "sentinel.md");
    await mkdir(path.dirname(outsidePath), { recursive: true });
    await writeFile(outsidePath, "sentinel", "utf-8");
    await writeFile(
      config.manifest.path,
      makeManifestJson(
        [
          {
            target: "claude",
            type: "agent",
            sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
            generatedPath: path.join(
              config.library.generatedDir,
              "claude",
              "agents",
              "sentinel.md",
            ),
            installedPath: outsidePath,
            installMode: "copy",
            contentHash: "wrong-hash",
            timestamp: new Date().toISOString(),
          },
        ],
        { config },
      ),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    await expect(uninstall(config, { dryRun: false })).rejects.toThrow(
      "Bound manifest contains foreign records",
    );
    expect(await readFile(outsidePath, "utf-8")).toBe("sentinel");
    expect(await readFile(config.manifest.path, "utf-8")).toBe(manifestBefore);
  });

  it.skipIf(!symlinkAvailable)(
    "skips uninstall removal when the configured target home crosses a symlinked ancestor",
    async () => {
      const realParent = path.join(tempDir, "outside-parent");
      const linkedParent = path.join(tempDir, "linked-parent");
      const agentsHome = path.join(linkedParent, "agents");
      const config = makeResolvedConfig(tempDir, {
        claude: { agentsHome },
      });
      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      await mkdir(path.join(realParent, "agents"), { recursive: true });
      await symlink(realParent, linkedParent, "dir");
      const installedPath = path.join(agentsHome, "sentinel.md");
      const realInstalledPath = path.join(realParent, "agents", "sentinel.md");
      await writeFile(realInstalledPath, "sentinel", "utf-8");
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "agent",
              sourcePath: path.join(config.library.agentsDir, "sentinel.yaml"),
              generatedPath: path.join(
                config.library.generatedDir,
                "claude",
                "agents",
                "sentinel.md",
              ),
              installedPath,
              installMode: "copy",
              contentHash: "wrong-hash",
              timestamp: new Date().toISOString(),
            },
          ],
          { config },
        ),
        "utf-8",
      );
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      const result = await uninstall(config, { dryRun: false });

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("crosses symlinked ancestor"),
      ]);
      expect(await readFile(realInstalledPath, "utf-8")).toBe("sentinel");
      expect(await readFile(config.manifest.path, "utf-8")).toBe(
        manifestBefore,
      );
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "continues past per-record failures and updates manifest with successful removals",
    async () => {
      const config = makeResolvedConfig(tempDir);
      const skillsHome = config.targets.claude.skillsHome;
      await mkdir(skillsHome, { recursive: true });

      // skill-a lives inside a parent that we will chmod to read-only.
      // `rm({ recursive: true, force: true })` cannot unlink skill-a from
      // its parent without write permission on the parent, so the rm call
      // throws EACCES and our error path is exercised. skill-b lives at
      // the writable top of skillsHome and is removable normally.
      // Skipped under root because chmod does not block root unlinks.
      const lockedParent = skillsHome;
      await mkdir(lockedParent, { recursive: true });
      const skillAPath = path.join(lockedParent, "skill-a");
      const skillBPath = path.join(config.targets.codex.skillsHome, "skill-b");
      await mkdir(skillAPath, { recursive: true });
      await mkdir(skillBPath, { recursive: true });
      await writeFile(path.join(skillAPath, "SKILL.md"), "a", "utf-8");
      await writeFile(path.join(skillBPath, "SKILL.md"), "b", "utf-8");

      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const timestamp = new Date().toISOString();
      await writeFile(
        config.manifest.path,
        makeManifestJson(
          [
            {
              target: "claude",
              type: "skill",
              sourcePath: "/x/skills/skill-a",
              generatedPath: null,
              installedPath: skillAPath,
              installMode: "copy",
              contentHash: buildSkillContentHash("a", new Map(), skillAPath),
              timestamp,
            },
            {
              target: "codex",
              type: "skill",
              sourcePath: "/x/skills/skill-b",
              generatedPath: null,
              installedPath: skillBPath,
              installMode: "copy",
              contentHash: buildSkillContentHash("b", new Map(), skillBPath),
              timestamp,
            },
          ],
          { config },
        ),
        "utf-8",
      );

      await chmod(lockedParent, 0o555);

      try {
        const result = await uninstall(config, { dryRun: false });

        expect(result.removed).toBe(1);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain(skillAPath);
        expect(result.errors[0]).toMatch(/EACCES|EPERM|permission/i);

        // skill-b was removed; skill-a still on disk under the locked parent
        expect(await pathExists(skillBPath)).toBe(false);
        expect(await pathExists(skillAPath)).toBe(true);

        // Manifest reflects partial state: skill-a still tracked, skill-b cleared
        const manifest = JSON.parse(
          await readFile(config.manifest.path, "utf-8"),
        );
        expect(manifest.records.length).toBe(1);
        expect(manifest.records[0].installedPath).toBe(skillAPath);
      } finally {
        // Restore writability so cleanupTempDir can recursively delete tempDir
        await chmod(lockedParent, 0o755).catch(() => {});
      }
    },
  );
});
