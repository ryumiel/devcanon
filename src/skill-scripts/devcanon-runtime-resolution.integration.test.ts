import { execFile } from "node:child_process";
import { chmod, cp, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canCreateSymlinks,
  cleanupTempDir,
  createSkillFixture,
  createTempDir,
  makeResolvedConfig,
} from "../__test-helpers__/fixtures.js";
import { installTestLogger } from "../__test-helpers__/logger.js";
import type { ResolvedConfig } from "../config/schema.js";
import { sync } from "../install/sync.js";
import { renderAll } from "../render/pipeline.js";

const execFileAsync = promisify(execFile);
const symlinkAvailable = await canCreateSymlinks();

async function copyRuntimeFixture(skillsDir: string): Promise<void> {
  await cp(
    path.resolve("skills/devcanon-runtime"),
    path.join(skillsDir, "devcanon-runtime"),
    { recursive: true },
  );
}

async function prepareRuntimeResolutionFixture(
  config: ResolvedConfig,
): Promise<void> {
  await mkdir(config.library.skillsDir, { recursive: true });
  await mkdir(config.library.agentsDir, { recursive: true });
  await copyRuntimeFixture(config.library.skillsDir);
  await createSkillFixture(
    config.library.skillsDir,
    "consumer-skill",
    "---\nname: consumer-skill\ndescription: A runtime-backed consumer fixture.\n---\n\n# Consumer\n",
    ["scripts"],
  );
}

async function resolveRuntimeEntrypoint(
  resolverPath: string,
  consumerScriptPath: string,
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const bashResolverPath = await toBashPath(resolverPath);
  const bashConsumerScriptPath = await toBashPath(consumerScriptPath);
  const { stdout } = await execFileAsync(
    "bash",
    [
      bashResolverPath,
      "resolve-entrypoint",
      "--from",
      bashConsumerScriptPath,
      "--entrypoint",
      "scripts/devcanon-runtime.sh",
    ],
    {
      env: { ...process.env, ...env },
    },
  );
  return stdout.trim();
}

async function toBashPath(nativePath: string): Promise<string> {
  const { stdout } = await execFileAsync("bash", [
    "-lc",
    'if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf "%s\\n" "$1"; fi',
    "bash",
    nativePath,
  ]);
  return stdout.trim();
}

function normalizePathText(value: string): string {
  let normalized = value.replace(/\\/gu, "/");
  if (process.platform === "win32") {
    normalized = normalized.replace(
      /^\/([A-Za-z])\//u,
      (_match, drive: string) => `${drive}:/`,
    );
    normalized = normalized.replace(
      /^\/cygdrive\/([A-Za-z])\//u,
      (_match, drive: string) => `${drive}:/`,
    );
    if (/^[A-Za-z]:\//u.test(normalized)) {
      normalized = normalized.toLowerCase();
    }
  }
  return normalized;
}

async function expectSameBashPath(
  actual: string,
  expectedNativePath: string,
): Promise<void> {
  expect(normalizePathText(actual)).toBe(
    normalizePathText(await toBashPath(expectedNativePath)),
  );
}

describe("devcanon-runtime resolver", () => {
  let tempDir: string;
  let config: ResolvedConfig;
  let restoreLogger: () => void;

  beforeEach(async () => {
    tempDir = await createTempDir();
    config = makeResolvedConfig(tempDir);
    const installed = installTestLogger();
    restoreLogger = installed.restore;
  });

  afterEach(async () => {
    restoreLogger();
    await cleanupTempDir(tempDir);
  });

  it("reports the runtime command contract", async () => {
    const { stdout } = await execFileAsync("bash", [
      await toBashPath(
        path.resolve("skills/devcanon-runtime/scripts/devcanon-runtime.sh"),
      ),
      "contract",
    ]);

    expect(stdout).toBe(
      '{"command_group":"devcanon-runtime","major_version":1}\n',
    );
  });

  it("resolves runtime entrypoints from source, generated preview, and copy-installed sibling layouts", async () => {
    await prepareRuntimeResolutionFixture(config);

    const sourceResolved = await resolveRuntimeEntrypoint(
      path.join(
        config.library.skillsDir,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
      path.join(
        config.library.skillsDir,
        "consumer-skill",
        "scripts",
        "adapter.sh",
      ),
    );
    await expectSameBashPath(
      sourceResolved,
      path.join(
        config.library.skillsDir,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
    );

    await renderAll(config, true);
    const generatedResolved = await resolveRuntimeEntrypoint(
      path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
      path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        "consumer-skill",
        "scripts",
        "adapter.sh",
      ),
    );
    await expectSameBashPath(
      generatedResolved,
      path.join(
        config.library.generatedDir,
        "codex",
        "skills",
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
    );

    const result = await sync(config, {
      dryRun: false,
      force: false,
      strict: false,
      mode: "copy",
    });
    expect(result.errors).toEqual([]);

    const installedResolved = await resolveRuntimeEntrypoint(
      path.join(
        config.targets.codex.skillsHome,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
      path.join(
        config.targets.codex.skillsHome,
        "consumer-skill",
        "scripts",
        "adapter.sh",
      ),
    );
    await expectSameBashPath(
      installedResolved,
      path.join(
        config.targets.codex.skillsHome,
        "devcanon-runtime",
        "scripts",
        "devcanon-runtime.sh",
      ),
    );
  });

  it.skipIf(!symlinkAvailable)(
    "resolves runtime entrypoints from symlink-installed sibling layouts",
    async () => {
      config = makeResolvedConfig(tempDir, {
        claude: { installMode: "symlink" },
        codex: { installMode: "symlink" },
        defaults: { installMode: "symlink" },
      });
      await prepareRuntimeResolutionFixture(config);

      const result = await sync(config, {
        dryRun: false,
        force: false,
        strict: false,
        mode: "symlink",
      });
      expect(result.errors).toEqual([]);

      const installedResolved = await resolveRuntimeEntrypoint(
        path.join(
          config.targets.codex.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
        path.join(
          config.targets.codex.skillsHome,
          "consumer-skill",
          "scripts",
          "adapter.sh",
        ),
      );
      await expectSameBashPath(
        installedResolved,
        path.join(
          config.targets.codex.skillsHome,
          "devcanon-runtime",
          "scripts",
          "devcanon-runtime.sh",
        ),
      );
    },
  );

  it.skipIf(!symlinkAvailable)(
    "rejects symlinked runtime entrypoints",
    async () => {
      await prepareRuntimeResolutionFixture(config);

      const externalScript = path.join(tempDir, "external-runtime.sh");
      await cp(
        path.resolve("skills/devcanon-runtime/scripts/devcanon-runtime.sh"),
        externalScript,
      );
      await chmod(externalScript, 0o755);
      await symlink(
        externalScript,
        path.join(
          config.library.skillsDir,
          "devcanon-runtime",
          "scripts",
          "linked-runtime.sh",
        ),
      );

      await expect(
        execFileAsync("bash", [
          await toBashPath(
            path.join(
              config.library.skillsDir,
              "devcanon-runtime",
              "scripts",
              "devcanon-runtime.sh",
            ),
          ),
          "resolve-entrypoint",
          "--from",
          await toBashPath(
            path.join(
              config.library.skillsDir,
              "consumer-skill",
              "scripts",
              "adapter.sh",
            ),
          ),
          "--entrypoint",
          "scripts/linked-runtime.sh",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("devcanon-runtime entrypoint missing"),
      });

      const externalScriptsDir = path.join(tempDir, "external-scripts");
      await mkdir(externalScriptsDir);
      await cp(
        path.resolve("skills/devcanon-runtime/scripts/devcanon-runtime.sh"),
        path.join(externalScriptsDir, "devcanon-runtime.sh"),
      );
      await chmod(path.join(externalScriptsDir, "devcanon-runtime.sh"), 0o755);
      await symlink(
        externalScriptsDir,
        path.join(
          config.library.skillsDir,
          "devcanon-runtime",
          "scripts",
          "linked-dir",
        ),
      );

      await expect(
        execFileAsync("bash", [
          await toBashPath(
            path.join(
              config.library.skillsDir,
              "devcanon-runtime",
              "scripts",
              "devcanon-runtime.sh",
            ),
          ),
          "resolve-entrypoint",
          "--from",
          await toBashPath(
            path.join(
              config.library.skillsDir,
              "consumer-skill",
              "scripts",
              "adapter.sh",
            ),
          ),
          "--entrypoint",
          "scripts/linked-dir/devcanon-runtime.sh",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("devcanon-runtime entrypoint missing"),
      });
    },
  );

  it("reports actionable diagnostics when the runtime is missing", async () => {
    await mkdir(config.library.skillsDir, { recursive: true });
    await createSkillFixture(
      config.library.skillsDir,
      "consumer-skill",
      "---\nname: consumer-skill\ndescription: A runtime-backed consumer fixture.\n---\n\n# Consumer\n",
      ["scripts"],
    );

    const resolverPath = path.resolve(
      "skills/devcanon-runtime/scripts/devcanon-runtime.sh",
    );
    await expect(
      execFileAsync("bash", [
        await toBashPath(resolverPath),
        "resolve-entrypoint",
        "--from",
        await toBashPath(
          path.join(
            config.library.skillsDir,
            "consumer-skill",
            "scripts",
            "adapter.sh",
          ),
        ),
        "--entrypoint",
        "scripts/devcanon-runtime.sh",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Ensure generated previews or installed skill homes include the sibling devcanon-runtime support skill",
      ),
    });
  });
});
