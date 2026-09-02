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

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type PackedFile = { path: string };
type PackedTarball = { filename: string; files: PackedFile[] };

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
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

function parseTarball(stdout: string): PackedTarball {
  const inventoryOffset = stdout.indexOf("\n{");
  if (inventoryOffset < 0) {
    throw new Error(`npm pack returned no JSON inventory: ${stdout}`);
  }
  const parsed = JSON.parse(stdout.slice(inventoryOffset + 1)) as unknown;
  const tarball = Array.isArray(parsed)
    ? parsed[0]
    : (parsed as { devcanon?: unknown }).devcanon;
  if (
    !tarball ||
    typeof tarball !== "object" ||
    typeof (tarball as PackedTarball).filename !== "string" ||
    !Array.isArray((tarball as PackedTarball).files)
  ) {
    throw new Error(`npm pack returned an unexpected inventory: ${stdout}`);
  }
  return tarball as PackedTarball;
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
  it("runs the package-local lifecycle and copied runtime without ambient sources", async () => {
    const root = await createTempDir();
    const archives = path.join(root, "archives");
    const consumer = path.join(root, "consumer");
    const library = path.join(root, "library");
    const home = path.join(root, "home");
    const standalone = path.join(root, "standalone");

    try {
      await Promise.all([mkdir(archives), mkdir(consumer), mkdir(library)]);
      const packed = parseTarball(
        (
          await run(
            "npm pack through prepack",
            "npm",
            ["pack", "--json", "--pack-destination", archives],
            { cwd: repositoryRoot },
          )
        ).stdout,
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
      await run(
        "install packed package",
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
        { cwd: consumer },
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
