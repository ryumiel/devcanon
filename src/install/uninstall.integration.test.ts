import {
  chmod,
  mkdir,
  readFile,
  readlink,
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
import { pathExists } from "../utils/fs.js";
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
    expect(manifest.records.length).toBeGreaterThan(0);
    for (const record of manifest.records) {
      expect(record.target).toBe("codex");
    }
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
      makeManifestJson([
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
      ]),
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
    "uninstalls a copied skill recorded with a legacy target-only symlink hash",
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
      await symlink("payload.txt", path.join(skillDir, "scripts", "link.txt"));
      await sync(config, { dryRun: false, force: false, strict: false });

      const claudeSkillPath = path.join(
        config.targets.claude.skillsHome,
        "skill-a",
      );
      const generatedSkillDir = path.join(
        config.library.generatedDir,
        "claude",
        "skills",
        "skill-a",
      );
      const installedSkillContent = await readFile(
        path.join(claudeSkillPath, "SKILL.md"),
        "utf-8",
      );
      const manifest = JSON.parse(
        await readFile(config.manifest.path, "utf-8"),
      );
      const claudeRecord = manifest.records.find(
        (record: { installedPath: string }) =>
          record.installedPath === claudeSkillPath,
      );
      claudeRecord.contentHash = buildSkillContentHash(
        installedSkillContent,
        new Map([
          [
            path.join(generatedSkillDir, "scripts", "payload.txt"),
            `file:${Buffer.from("payload").toString("base64")}`,
          ],
          [
            path.join(generatedSkillDir, "scripts", "link.txt"),
            "symlink:payload.txt",
          ],
        ]),
        generatedSkillDir,
      );
      await writeFile(
        config.manifest.path,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf-8",
      );

      const result = await uninstall(config, {
        target: "claude",
        dryRun: false,
      });

      expect(result.removed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(await pathExists(claudeSkillPath)).toBe(false);
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
      makeManifestJson([
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
      ]),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    const result = await uninstall(config, { dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("outside configured claude agent home"),
    ]);
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
        makeManifestJson([
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
        ]),
        "utf-8",
      );
      const manifestBefore = await readFile(config.manifest.path, "utf-8");

      const result = await uninstall(config, { dryRun: false });

      expect(result.removed).toBe(0);
      expect(result.errors).toEqual([
        expect.stringContaining("crosses symlinked parent component"),
      ]);
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
      makeManifestJson([
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
      ]),
      "utf-8",
    );
    const manifestBefore = await readFile(config.manifest.path, "utf-8");

    const result = await uninstall(config, { dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.errors).toEqual([
      expect.stringContaining("outside configured claude agent home"),
    ]);
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
        makeManifestJson([
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
        ]),
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
      const lockedParent = path.join(skillsHome, "_locked");
      await mkdir(lockedParent, { recursive: true });
      const skillAPath = path.join(lockedParent, "skill-a");
      const skillBPath = path.join(skillsHome, "skill-b");
      await mkdir(skillAPath, { recursive: true });
      await mkdir(skillBPath, { recursive: true });
      await writeFile(path.join(skillAPath, "SKILL.md"), "a", "utf-8");
      await writeFile(path.join(skillBPath, "SKILL.md"), "b", "utf-8");

      await mkdir(path.dirname(config.manifest.path), { recursive: true });
      const timestamp = new Date().toISOString();
      await writeFile(
        config.manifest.path,
        makeManifestJson([
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
            target: "claude",
            type: "skill",
            sourcePath: "/x/skills/skill-b",
            generatedPath: null,
            installedPath: skillBPath,
            installMode: "copy",
            contentHash: buildSkillContentHash("b", new Map(), skillBPath),
            timestamp,
          },
        ]),
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
