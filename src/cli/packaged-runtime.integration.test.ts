import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import {
  parseNpmPackInventory,
  runPackageManager,
} from "../__test-helpers__/npm-pack.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const conflictingNpmConfigKeys = [
  "npm_config_allow_scripts",
  "NPM_CONFIG_ALLOW_SCRIPTS",
  "npm_config_only_built_dependencies_file",
  "NPM_CONFIG_ONLY_BUILT_DEPENDENCIES_FILE",
];

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function npmEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of conflictingNpmConfigKeys) {
    Reflect.deleteProperty(env, key);
  }
  return env;
}

async function run(
  stage: string,
  command: string,
  args: string[],
  options: Parameters<typeof execFileAsync>[2],
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, options);
    return { stdout: asText(result.stdout), stderr: asText(result.stderr) };
  } catch (cause) {
    const error = cause as Error & { stdout?: unknown; stderr?: unknown };
    throw new Error(
      [
        `${stage} failed: ${error.message}`,
        `stdout:\n${asText(error.stdout)}`,
        `stderr:\n${asText(error.stderr)}`,
      ].join("\n"),
      { cause },
    );
  }
}

function requireContainedPath(root: string, candidate: string, label: string) {
  const relative = path.relative(root, candidate);
  expect(path.isAbsolute(relative), label).toBe(false);
  expect(relative, `${label} must be under ${root}`).not.toMatch(
    /^(?:\.\.(?:[\\/]|$)|$)/,
  );
}

function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    TMP: home,
    TEMP: home,
    TMPDIR: home,
    PATH: "",
    ...(process.platform === "win32"
      ? { SystemRoot: process.env.SystemRoot }
      : {}),
  };
}

async function expectNoAncestorDependencies(directory: string): Promise<void> {
  let current = directory;
  for (;;) {
    await expect(
      readdir(path.join(current, "node_modules")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function runtimeResult(
  entrypoint: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(
      process.execPath,
      [entrypoint, ...args],
      {
        cwd,
        env,
        windowsHide: true,
        timeout: 30_000,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    if (typeof error.code !== "number") throw cause;
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

async function readOptionalFile(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
}

async function createPackSource(root: string): Promise<string> {
  const source = path.join(root, "pack-source");
  const archive = path.join(root, "tracked-source.tar");
  await run(
    "archive current tracked source",
    "git",
    ["archive", "--format=tar", "--output", archive, "HEAD"],
    { cwd: repositoryRoot },
  );
  await mkdir(source);
  await run("extract tracked source", "tar", ["-xf", archive, "-C", source], {
    cwd: root,
  });
  await expect(
    readFile(path.join(source, "dist", "cli", "index.js")),
  ).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(
    readdir(
      path.join(source, "skills", "devcanon-runtime", "scripts", "runtime"),
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await runPackageManager(
    "pnpm",
    ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
    { cwd: source },
  );
  return source;
}

async function expectExactRuntimeTree(runtimeRoot: string): Promise<void> {
  expect(await readdir(runtimeRoot)).toEqual(["config", "scripts"]);
  expect(await readdir(path.join(runtimeRoot, "config"))).toEqual([
    "runtime-config.json",
  ]);
  expect(await readdir(path.join(runtimeRoot, "scripts"))).toEqual([
    "devcanon-runtime.sh",
    "resolve-bash.mjs",
    "runtime",
  ]);
  expect(
    (await readdir(path.join(runtimeRoot, "scripts", "runtime"))).sort(),
  ).toEqual([
    "THIRD_PARTY_LICENSES",
    "devcanon-runtime.mjs",
    "runtime-manifest.json",
  ]);
}

describe("packaged passive runtime", () => {
  it("parses a lifecycle-prefixed npm array inventory", () => {
    expect(
      parseNpmPackInventory(
        [
          "> devcanon@2.0.0 prepack",
          "> pnpm run build",
          "",
          JSON.stringify([
            {
              filename: "devcanon-2.0.0.tgz",
              files: [{ path: "dist/cli/index.js" }],
            },
          ]),
          "",
        ].join("\n"),
        "devcanon",
      ),
    ).toEqual({
      filename: "devcanon-2.0.0.tgz",
      files: [{ path: "dist/cli/index.js" }],
    });
  });

  it("runs the package-local lifecycle and copied runtime without ambient sources", async () => {
    const root = await createTempDir();
    const archives = path.join(root, "archives");
    const consumer = path.join(root, "consumer");
    const library = path.join(root, "library");
    const home = path.join(root, "home");
    const standalone = path.join(root, "standalone");

    try {
      await Promise.all([mkdir(archives), mkdir(consumer), mkdir(library)]);
      const packSource = await createPackSource(root);
      const packed = parseNpmPackInventory(
        (
          await runPackageManager(
            "npm",
            ["pack", "--json", "--pack-destination", archives],
            { cwd: packSource, env: npmEnvironment() },
          )
        ).stdout,
        "devcanon",
      );
      const packedPaths = packed.files.map((file) => file.path).sort();
      expect(packedPaths).toEqual(
        expect.arrayContaining([
          "dist/cli/index.js",
          "dist/devcanon-runtime/package/THIRD_PARTY_LICENSES",
          "dist/devcanon-runtime/package/devcanon-runtime.mjs",
          "dist/devcanon-runtime/package/runtime-manifest.json",
          "dist/runtime-build/provider.js",
          "skills/devcanon-runtime/config/runtime-config.json",
          "skills/devcanon-runtime/scripts/devcanon-runtime.sh",
          "skills/devcanon-runtime/scripts/resolve-bash.mjs",
        ]),
      );
      expect(
        packedPaths.filter(
          (packedPath) =>
            packedPath.startsWith("dist/devcanon-runtime/source-build/") ||
            packedPath.startsWith("skills/devcanon-runtime/scripts/runtime/") ||
            packedPath === "dist/cli/source.js" ||
            packedPath === "dist/runtime-build/producer.js",
        ),
      ).toEqual([]);

      const tarball = path.join(archives, packed.filename);
      requireContainedPath(archives, tarball, "packed tarball");
      await readFile(tarball);
      await writeFile(
        path.join(consumer, "package.json"),
        '{"private":true,"name":"packaged-runtime-consumer"}\n',
      );
      await runPackageManager(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
        { cwd: consumer, env: npmEnvironment() },
      );

      const packageRoot = await realpath(
        path.join(consumer, "node_modules", "devcanon"),
      );
      const packageCli = path.join(packageRoot, "dist", "cli", "index.js");
      requireContainedPath(
        await realpath(consumer),
        packageRoot,
        "installed package",
      );
      requireContainedPath(packageRoot, packageCli, "package-local CLI");
      expect(path.relative(repositoryRoot, packageCli)).toMatch(/^\.\./);
      expect(
        JSON.parse(
          await readFile(path.join(packageRoot, "package.json"), "utf8"),
        ),
      ).toMatchObject({ bin: { devcanon: "./dist/cli/index.js" } });

      await mkdir(home);
      const packageEnv = isolatedEnvironment(home);
      if (process.platform !== "win32") {
        // POSIX composition still checks its shell adapter. Expose only its
        // tools, keeping package managers and global DevCanon off PATH.
        packageEnv.PATH = path.join(root, "package-bin");
        await mkdir(packageEnv.PATH);
        for (const [name, executable] of [
          ["node", process.execPath],
          ["bash", "/bin/bash"],
          ["dirname", "/usr/bin/dirname"],
          ["basename", "/usr/bin/basename"],
        ]) {
          await symlink(executable, path.join(packageEnv.PATH, name));
        }
      }
      await run("package-local init", process.execPath, [packageCli, "init"], {
        cwd: library,
        env: packageEnv,
      });

      const configPath = path.join(library, "devcanon.config.yaml");
      const config = await readFile(configPath, "utf8");
      await writeFile(
        configPath,
        config
          .replace("~/.claude/skills", path.join(home, "claude", "skills"))
          .replace("~/.claude/agents", path.join(home, "claude", "agents"))
          .replace("~/.agents/skills", path.join(home, "codex", "skills"))
          .replace("~/.codex/agents", path.join(home, "codex", "agents"))
          .replace(
            "~/.devcanon/manifest.json",
            path.join(home, "manifest.json"),
          ),
      );
      const commandOptions = { cwd: library, env: packageEnv };
      // Resolve using the installed package, including its native home expansion,
      // before allowing sync to write anything.
      const resolved = JSON.parse(
        (
          await run(
            "resolve package-local write targets",
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `import { loadConfig } from ${JSON.stringify(pathToFileURL(path.join(packageRoot, "dist/config/load.js")).href)};\nprocess.stdout.write(JSON.stringify(await loadConfig(process.argv[1])));`,
              configPath,
            ],
            commandOptions,
          )
        ).stdout,
      );
      for (const target of [resolved.targets.claude, resolved.targets.codex]) {
        requireContainedPath(root, target.skillsHome, "skills home");
        requireContainedPath(root, target.agentsHome, "agents home");
      }
      requireContainedPath(root, resolved.manifest.path, "install manifest");
      await run(
        "package-local validate",
        process.execPath,
        [packageCli, "--config", configPath, "validate"],
        commandOptions,
      );
      await run(
        "package-local render",
        process.execPath,
        [packageCli, "--config", configPath, "render"],
        commandOptions,
      );
      await run(
        "package-local copy sync",
        process.execPath,
        [
          packageCli,
          "--config",
          configPath,
          "sync",
          "--target",
          "codex",
          "--mode",
          "copy",
        ],
        commandOptions,
      );

      const installedRuntime = path.join(
        home,
        "codex",
        "skills",
        "devcanon-runtime",
      );
      await expectExactRuntimeTree(installedRuntime);
      const copiedRuntime = path.join(standalone, "devcanon-runtime");
      await mkdir(standalone);
      await cp(installedRuntime, copiedRuntime, { recursive: true });
      await expectExactRuntimeTree(copiedRuntime);
      requireContainedPath(
        await realpath(standalone),
        await realpath(copiedRuntime),
        "copied runtime",
      );
      expect(path.relative(repositoryRoot, copiedRuntime)).toMatch(/^\.\./);

      await rm(path.join(consumer, "node_modules"), {
        recursive: true,
        force: true,
      });
      const copiedBundle = path.join(
        copiedRuntime,
        "scripts",
        "runtime",
        "devcanon-runtime.mjs",
      );
      const runtimeEnv = isolatedEnvironment(home);
      await expectNoAncestorDependencies(path.dirname(copiedBundle));
      await expectNoAncestorDependencies(standalone);
      const runtimeOptions = { cwd: standalone, env: runtimeEnv };
      const contract = await run(
        "copied runtime contract",
        process.execPath,
        [copiedBundle, "runtime", "contract"],
        runtimeOptions,
      );
      expect(JSON.parse(contract.stdout)).toMatchObject({
        command_group: "devcanon-runtime",
        major_version: 1,
        helper_foundation: true,
      });
      expect(contract.stdout).toBe(
        `${JSON.stringify(JSON.parse(contract.stdout))}\n`,
      );
      expect(contract.stderr).toBe("");
      const catalog = await run(
        "copied runtime catalog helper",
        process.execPath,
        [
          copiedBundle,
          "runtime",
          "config",
          "get",
          "--key",
          "capabilityProfiles.balanced.codex",
        ],
        runtimeOptions,
      );
      expect(JSON.parse(catalog.stdout)).toMatchObject({
        value: resolved.capabilityProfiles.balanced.codex,
      });
      expect(catalog.stdout).toBe(
        `${JSON.stringify(JSON.parse(catalog.stdout))}\n`,
      );
      expect(catalog.stderr).toBe("");

      const selectedRuntime = path.join(standalone, "selected-runtime");
      await cp(copiedRuntime, selectedRuntime, { recursive: true });
      const selectedBundle = path.join(
        selectedRuntime,
        "scripts/runtime/devcanon-runtime.mjs",
      );
      await expectNoAncestorDependencies(path.dirname(selectedBundle));
      const selectedEnv = {
        ...runtimeEnv,
        DEVCANON_RUNTIME_DIR: selectedRuntime,
      };
      const bootstrapArgs = [
        "bootstrap",
        "--runtime-dir",
        selectedRuntime,
        "--",
      ];
      expect(
        await runtimeResult(
          copiedBundle,
          [...bootstrapArgs, "contract"],
          standalone,
          selectedEnv,
        ),
      ).toEqual({ code: 0, ...contract });

      // Only the selected runtime is instrumented; bootstrap stays the copied
      // production bundle. The marker also detects execution after a refusal.
      const marker = path.join(standalone, "selected-executed");
      await writeFile(
        selectedBundle,
        [
          'import { writeFileSync } from "node:fs";',
          `writeFileSync(${JSON.stringify(marker)}, "executed");`,
          'process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");',
          "process.exitCode = 23;",
        ].join("\n"),
      );
      const forwarded = ["two words", "", "last"];
      expect(
        await runtimeResult(
          copiedBundle,
          [...bootstrapArgs, ...forwarded],
          standalone,
          selectedEnv,
        ),
      ).toEqual({
        code: 23,
        stdout: `${JSON.stringify(["runtime", ...forwarded])}\n`,
        stderr: "",
      });
      await rm(marker);
      const traversal = await runtimeResult(
        copiedBundle,
        [
          "bootstrap",
          "--runtime-dir",
          `${selectedRuntime}${path.sep}scripts${path.sep}..`,
          "--",
          "contract",
        ],
        standalone,
        selectedEnv,
      );
      expect(traversal).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "DEVCANON_RUNTIME_DIR must not contain a parent-directory component\n",
      });
      expect(await readOptionalFile(marker)).toBeUndefined();

      const escapingRuntime = path.join(standalone, "escaping-runtime");
      await mkdir(escapingRuntime);
      await symlink(
        path.join(selectedRuntime, "scripts"),
        path.join(escapingRuntime, "scripts"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const escaped = await runtimeResult(
        copiedBundle,
        ["bootstrap", "--runtime-dir", escapingRuntime, "--", "contract"],
        standalone,
        { ...runtimeEnv, DEVCANON_RUNTIME_DIR: escapingRuntime },
      );
      expect(escaped).toEqual({
        code: 1,
        stdout: "",
        stderr:
          "devcanon-runtime entrypoint must not contain a symlink or reparse-point component\n",
      });
      expect(await readOptionalFile(marker)).toBeUndefined();

      // Discovery is setup only. Execution uses one explicit, verified candidate.
      const discovered = await runtimeResult(
        copiedBundle,
        ["runtime", "resolve-bash"],
        standalone,
        {
          ...runtimeEnv,
          PATH: process.env.PATH,
          DEVCANON_GIT_BASH: process.env.DEVCANON_GIT_BASH,
        },
      );
      expect(discovered.code, discovered.stderr).toBe(0);
      const bash = discovered.stdout.trim();
      const resolverBin = path.join(root, "resolver-bin");
      const resolverEnv =
        process.platform === "win32"
          ? { ...runtimeEnv, DEVCANON_GIT_BASH: bash }
          : { ...runtimeEnv, PATH: resolverBin };
      if (process.platform !== "win32") {
        await mkdir(resolverBin);
        await symlink(bash, path.join(resolverBin, "bash"));
      }
      const publicResolver = path.join(
        copiedRuntime,
        "scripts/resolve-bash.mjs",
      );
      for (const env of [resolverEnv, runtimeEnv]) {
        const direct = await runtimeResult(
          copiedBundle,
          ["runtime", "resolve-bash"],
          standalone,
          env,
        );
        const adapter = await runtimeResult(
          publicResolver,
          [],
          standalone,
          env,
        );
        expect(adapter).toEqual(direct);
        if (env === resolverEnv) {
          expect(direct).toEqual({ code: 0, stdout: `${bash}\n`, stderr: "" });
        } else {
          expect(direct.code).toBe(1);
          expect(direct.stdout).toBe("");
          expect(direct.stderr).toBe(
            process.platform === "win32"
              ? "Git-for-Windows Bash is unavailable or unusable. Install Git for Windows, put git.exe on PATH, or set DEVCANON_GIT_BASH to an absolute Git Bash path; WindowsApps and WSL launchers are not accepted.\n"
              : "Bash is unavailable or unusable. Install Bash or rerun from a supported POSIX environment.\n",
          );
        }
      }
    } finally {
      await cleanupTempDir(root);
    }
  });
});
