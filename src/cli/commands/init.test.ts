import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canMutateExecutableMode,
  cleanupTempDir,
  createTempDir,
} from "../../__test-helpers__/fixtures.js";
import { installTestLogger } from "../../__test-helpers__/logger.js";
import type { TestLoggerResult } from "../../__test-helpers__/logger.js";
import { loadConfig } from "../../config/load.js";
import type { ResolvedConfig } from "../../config/schema.js";
import { sync } from "../../install/sync.js";
import { renderAll } from "../../render/pipeline.js";
import type { UserError } from "../../utils/errors.js";
import { pathExists } from "../../utils/fs.js";
import { initAction } from "./init.js";

const executableModeMutable = await canMutateExecutableMode();

describe("initAction", () => {
  let tempDir: string;
  let originalCwd: string;
  let testLogger: TestLoggerResult;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    originalCwd = process.cwd();
    process.chdir(tempDir);
    const installed = installTestLogger();
    testLogger = installed.testLogger;
    restoreLogger = installed.restore;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("seeds the packaged runtime support skill into fresh libraries", async () => {
    await initAction();

    expect(
      await pathExists(
        path.join(tempDir, "skills", "devcanon-runtime", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          tempDir,
          "skills",
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);
    expect(testLogger.infos).toContain(
      "Seeded support runtime: skills/devcanon-runtime/",
    );
  });

  it("preserves an existing matching runtime support skill path", async () => {
    await mkdir(path.join(tempDir, "skills"), { recursive: true });
    await copyBundledRuntimeTo(
      path.join(originalCwd, "skills", "devcanon-runtime"),
      path.join(tempDir, "skills", "devcanon-runtime"),
    );

    await initAction();

    expect(testLogger.infos).toContain(
      "Support runtime already present: skills/devcanon-runtime/",
    );
  });

  it("fails with repair guidance rather than overwriting a modified runtime support skill", async () => {
    const customRuntimeSkill = path.join(tempDir, "skills", "devcanon-runtime");
    await mkdir(customRuntimeSkill, { recursive: true });
    await writeFile(
      path.join(customRuntimeSkill, "SKILL.md"),
      "custom runtime marker\n",
      "utf-8",
    );

    await expect(initAction()).rejects.toMatchObject({
      message:
        "Existing skills/devcanon-runtime/ does not match the bundled support runtime.",
      filePath: expect.stringMatching(/skills[/\\]devcanon-runtime$/u),
    } satisfies Partial<UserError>);

    expect(
      await readFile(path.join(customRuntimeSkill, "SKILL.md"), "utf-8"),
    ).toBe("custom runtime marker\n");
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it.skipIf(!executableModeMutable)(
    "fails with repair guidance rather than preserving a non-executable runtime entrypoint",
    async () => {
      const runtimeSkill = path.join(tempDir, "skills", "devcanon-runtime");
      const runtimeEntrypoint = path.join(
        runtimeSkill,
        "scripts",
        "devcanon-runtime.sh",
      );
      await copyBundledRuntimeTo(
        path.join(originalCwd, "skills", "devcanon-runtime"),
        runtimeSkill,
      );
      await chmod(runtimeEntrypoint, 0o644);

      await expect(initAction()).rejects.toMatchObject({
        message:
          "Existing skills/devcanon-runtime/ does not match the bundled support runtime.",
        filePath: expect.stringMatching(/skills[/\\]devcanon-runtime$/u),
      } satisfies Partial<UserError>);

      expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
        false,
      );
    },
  );

  it("renders and installs the seeded runtime as a sibling support skill", async () => {
    await initAction();

    const config = withTemporaryInstallHomes(
      await loadConfig(path.join(tempDir, "devcanon.config.yaml")),
      tempDir,
    );

    const renderResult = await renderAll(config, false);
    expect(
      renderResult.outputs
        .filter(
          (output) =>
            output.type === "skill" && output.name === "devcanon-runtime",
        )
        .map((output) => output.target)
        .sort(),
    ).toEqual(["claude", "codex"]);

    const syncResult = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });

    expect(syncResult.errors).toEqual([]);
    expect(
      await pathExists(
        path.join(
          config.targets.codex.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          config.targets.claude.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      ),
    ).toBe(true);
  });

  it("preflights bundled runtime availability before writing init files", async () => {
    const missingRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );

    await expect(
      initAction({ runtimeSourceDir: missingRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Bundled devcanon-runtime support skill is missing.",
      filePath: missingRuntimeDir,
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(await pathExists(path.join(tempDir, "skills"))).toBe(false);
  });

  it("preflights incomplete bundled runtime contents before writing init files", async () => {
    const incompleteRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await mkdir(incompleteRuntimeDir, { recursive: true });

    await expect(
      initAction({ runtimeSourceDir: incompleteRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Bundled devcanon-runtime support skill is incomplete.",
      filePath: path.join(incompleteRuntimeDir, "SKILL.md"),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it("preflights broken bundled runtime payload before writing init files", async () => {
    const brokenRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await copyBundledRuntimeTo(
      path.join(originalCwd, "skills", "devcanon-runtime"),
      brokenRuntimeDir,
    );
    await writeFile(
      path.join(brokenRuntimeDir, "scripts", "runtime", "command.js"),
      "export const broken = ;\n",
      "utf-8",
    );

    await expect(
      initAction({ runtimeSourceDir: brokenRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Bundled devcanon-runtime support skill contract check failed.",
      filePath: path.join(brokenRuntimeDir, "scripts", "runtime", "cli.js"),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "preflights the bundled runtime shell entrypoint before writing init files",
    async () => {
      const brokenRuntimeDir = path.join(
        tempDir,
        ".fake-package",
        "skills",
        "devcanon-runtime",
      );
      await copyBundledRuntimeTo(
        path.join(originalCwd, "skills", "devcanon-runtime"),
        brokenRuntimeDir,
      );
      await writeFile(
        path.join(brokenRuntimeDir, "scripts", "devcanon-runtime.sh"),
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          "printf '%s\\n' not-json",
          "",
        ].join("\n"),
        "utf-8",
      );

      await expect(
        initAction({ runtimeSourceDir: brokenRuntimeDir }),
      ).rejects.toMatchObject({
        message:
          "Bundled devcanon-runtime support skill contract check failed.",
        filePath: path.join(brokenRuntimeDir, "scripts", "devcanon-runtime.sh"),
      } satisfies Partial<UserError>);
      expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
        false,
      );
      expect(
        await pathExists(path.join(tempDir, "skills", "example-skill")),
      ).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "preflights the executable runtime shell entrypoint before writing init files",
    async () => {
      const brokenRuntimeDir = path.join(
        tempDir,
        ".fake-package",
        "skills",
        "devcanon-runtime",
      );
      await copyBundledRuntimeTo(
        path.join(originalCwd, "skills", "devcanon-runtime"),
        brokenRuntimeDir,
      );
      await writeFile(
        path.join(brokenRuntimeDir, "scripts", "devcanon-runtime.sh"),
        [
          "#!/devcanon/missing/bash",
          'printf \'%s\\n\' \'{"command_group":"devcanon-runtime","major_version":1}\'',
          "",
        ].join("\n"),
        "utf-8",
      );

      await expect(
        initAction({ runtimeSourceDir: brokenRuntimeDir }),
      ).rejects.toMatchObject({
        message:
          "Bundled devcanon-runtime support skill contract check failed.",
        filePath: path.join(brokenRuntimeDir, "scripts", "devcanon-runtime.sh"),
      } satisfies Partial<UserError>);
      expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
        false,
      );
      expect(
        await pathExists(path.join(tempDir, "skills", "example-skill")),
      ).toBe(false);
    },
  );

  it("preflights broken bundled runtime module surface before writing init files", async () => {
    const brokenRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await copyBundledRuntimeTo(
      path.join(originalCwd, "skills", "devcanon-runtime"),
      brokenRuntimeDir,
    );
    await rm(path.join(brokenRuntimeDir, "scripts", "runtime", "schema.js"));

    await expect(
      initAction({ runtimeSourceDir: brokenRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Bundled devcanon-runtime support skill is incomplete.",
      filePath: path.join(brokenRuntimeDir, "scripts", "runtime", "schema.js"),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });

  it("preflights missing issue-worktree runtime payload before writing init files", async () => {
    const incompleteRuntimeDir = path.join(
      tempDir,
      ".fake-package",
      "skills",
      "devcanon-runtime",
    );
    await copyBundledRuntimeTo(
      path.join(originalCwd, "skills", "devcanon-runtime"),
      incompleteRuntimeDir,
    );
    await rm(
      path.join(
        incompleteRuntimeDir,
        "scripts",
        "runtime",
        "issue-worktree-setup.js",
      ),
    );

    await expect(
      initAction({ runtimeSourceDir: incompleteRuntimeDir }),
    ).rejects.toMatchObject({
      message: "Bundled devcanon-runtime support skill is incomplete.",
      filePath: path.join(
        incompleteRuntimeDir,
        "scripts",
        "runtime",
        "issue-worktree-setup.js",
      ),
    } satisfies Partial<UserError>);
    expect(await pathExists(path.join(tempDir, "devcanon.config.yaml"))).toBe(
      false,
    );
    expect(
      await pathExists(path.join(tempDir, "skills", "example-skill")),
    ).toBe(false);
  });
});

async function copyBundledRuntimeTo(
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
  });
}

function withTemporaryInstallHomes(
  config: ResolvedConfig,
  tempDir: string,
): ResolvedConfig {
  return {
    ...config,
    defaults: {
      ...config.defaults,
      installMode: "copy",
    },
    manifest: {
      ...config.manifest,
      path: path.join(tempDir, "home", "devcanon", "manifest.json"),
    },
    targets: {
      claude: {
        ...config.targets.claude,
        skillsHome: path.join(tempDir, "home", "claude", "skills"),
        agentsHome: path.join(tempDir, "home", "claude", "agents"),
        installMode: "copy",
      },
      codex: {
        ...config.targets.codex,
        skillsHome: path.join(tempDir, "home", "codex", "skills"),
        agentsHome: path.join(tempDir, "home", "codex", "agents"),
        installMode: "copy",
      },
    },
  };
}
