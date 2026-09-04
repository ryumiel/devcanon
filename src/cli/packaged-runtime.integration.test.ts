import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../__test-helpers__/fixtures.js";
import { parseNpmPackInventory } from "../__test-helpers__/npm-pack.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const sharedDerivedOutputs = [
  path.join(
    repositoryRoot,
    "dist",
    "devcanon-runtime",
    "package",
    "runtime-manifest.json",
  ),
  path.join(
    repositoryRoot,
    "skills",
    "devcanon-runtime",
    "scripts",
    "runtime",
    "runtime-manifest.json",
  ),
];
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
  expect(relative, `${label} must be under ${root}`).not.toMatch(
    /^(?:\.\.(?:[\\/]|$)|$)/,
  );
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
  await run(
    "install isolated pack dependencies",
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
  expect(await readdir(path.join(runtimeRoot, "scripts", "runtime"))).toEqual([
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
      const sharedDerivedOutputBytes = await Promise.all(
        sharedDerivedOutputs.map(readOptionalFile),
      );
      const packSource = await createPackSource(root);
      const packed = parseNpmPackInventory(
        (
          await run(
            "npm pack through prepack",
            "npm",
            ["pack", "--json", "--pack-destination", archives],
            { cwd: packSource, env: npmEnvironment() },
          )
        ).stdout,
        "devcanon",
      );
      await expect(
        Promise.all(sharedDerivedOutputs.map(readOptionalFile)),
      ).resolves.toEqual(sharedDerivedOutputBytes);
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
      await run(
        "install packed package",
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

      const packageEnv = {
        ...process.env,
        HOME: home,
        NODE_PATH: path.join(root, "forbidden-node-path"),
      };
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
      const runtimeEnv = {
        HOME: path.join(root, "runtime-home"),
        NODE_OPTIONS: "",
        NODE_PATH: path.join(root, "forbidden-node-path"),
        PATH: path.join(root, "no-global-bin"),
      };
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
        value: "gpt-5.6-terra",
      });
    } finally {
      await cleanupTempDir(root);
    }
  });
});
