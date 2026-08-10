import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function isolatedPnpmEnvironment(xdgDataHome: string): NodeJS.ProcessEnv {
  const inheritedPath = process.env.PATH;
  if (!inheritedPath) throw new Error("PATH is required to execute pnpm");

  const cacheHome = path.join(xdgDataHome, "cache");
  const configurationHome = path.join(xdgDataHome, "config");
  const globalDirectory = path.join(xdgDataHome, "global");
  const pnpmHome = path.join(xdgDataHome, "pnpm");
  const storeDirectory = path.join(xdgDataHome, "store");
  const temporaryDirectory = path.join(xdgDataHome, "tmp");

  return {
    COREPACK_HOME: path.join(xdgDataHome, "corepack"),
    HOME: path.join(xdgDataHome, "home"),
    NPM_CONFIG_CACHE: cacheHome,
    NPM_CONFIG_GLOBAL_BIN_DIR: pnpmHome,
    NPM_CONFIG_GLOBAL_DIR: globalDirectory,
    NPM_CONFIG_GLOBALCONFIG: path.join(configurationHome, "npm-globalrc"),
    NPM_CONFIG_STORE_DIR: storeDirectory,
    NPM_CONFIG_USERCONFIG: path.join(configurationHome, "npmrc"),
    PATH: `${pnpmHome}${path.delimiter}${inheritedPath}`,
    PNPM_CONFIG_GLOBAL_BIN_DIR: pnpmHome,
    PNPM_CONFIG_GLOBAL_DIR: globalDirectory,
    PNPM_CONFIG_STORE_DIR: storeDirectory,
    PNPM_HOME: pnpmHome,
    PWD: process.cwd(),
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
    TMPDIR: temporaryDirectory,
    XDG_CACHE_HOME: cacheHome,
    XDG_CONFIG_HOME: configurationHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: path.join(xdgDataHome, "state"),
    npm_config_cache: cacheHome,
    npm_config_global_bin_dir: pnpmHome,
    npm_config_global_dir: globalDirectory,
    npm_config_globalconfig: path.join(configurationHome, "npm-globalrc"),
    npm_config_store_dir: storeDirectory,
    npm_config_userconfig: path.join(configurationHome, "npmrc"),
    pnpm_config_global_bin_dir: pnpmHome,
    pnpm_config_global_dir: globalDirectory,
    pnpm_config_store_dir: storeDirectory,
  };
}

describe.runIf(process.platform !== "win32")("setup:cli", () => {
  it("isolates configuration discovery before setup executes", () => {
    const xdgDataHome = path.join(os.tmpdir(), "devcanon-pnpm-data");
    const configurationHome = path.join(xdgDataHome, "config");
    const inheritedConfigName = "npm_config_glObAl_dir";
    const originalValue = process.env[inheritedConfigName];

    process.env[inheritedConfigName] = path.join(os.tmpdir(), "operator-pnpm");
    try {
      const environment = isolatedPnpmEnvironment(xdgDataHome);
      const cacheHome = path.join(xdgDataHome, "cache");
      const globalDirectory = path.join(xdgDataHome, "global");
      const pnpmHome = path.join(xdgDataHome, "pnpm");
      const storeDirectory = path.join(xdgDataHome, "store");
      const temporaryDirectory = path.join(xdgDataHome, "tmp");

      expect(environment).not.toHaveProperty(inheritedConfigName);
      expect(environment).toMatchObject({
        COREPACK_HOME: path.join(xdgDataHome, "corepack"),
        HOME: path.join(xdgDataHome, "home"),
        NPM_CONFIG_CACHE: cacheHome,
        NPM_CONFIG_GLOBAL_BIN_DIR: pnpmHome,
        NPM_CONFIG_GLOBAL_DIR: globalDirectory,
        NPM_CONFIG_GLOBALCONFIG: path.join(configurationHome, "npm-globalrc"),
        NPM_CONFIG_STORE_DIR: storeDirectory,
        NPM_CONFIG_USERCONFIG: path.join(configurationHome, "npmrc"),
        PNPM_CONFIG_GLOBAL_BIN_DIR: pnpmHome,
        PNPM_CONFIG_GLOBAL_DIR: globalDirectory,
        PNPM_CONFIG_STORE_DIR: storeDirectory,
        PNPM_HOME: pnpmHome,
        TEMP: temporaryDirectory,
        TMP: temporaryDirectory,
        TMPDIR: temporaryDirectory,
        XDG_CACHE_HOME: cacheHome,
        XDG_CONFIG_HOME: configurationHome,
        XDG_DATA_HOME: xdgDataHome,
        XDG_STATE_HOME: path.join(xdgDataHome, "state"),
        npm_config_cache: cacheHome,
        npm_config_global_bin_dir: pnpmHome,
        npm_config_global_dir: globalDirectory,
        npm_config_globalconfig: path.join(configurationHome, "npm-globalrc"),
        npm_config_store_dir: storeDirectory,
        npm_config_userconfig: path.join(configurationHome, "npmrc"),
        pnpm_config_global_bin_dir: pnpmHome,
        pnpm_config_global_dir: globalDirectory,
        pnpm_config_store_dir: storeDirectory,
      });
    } finally {
      if (originalValue === undefined) {
        delete process.env[inheritedConfigName];
      } else {
        process.env[inheritedConfigName] = originalValue;
      }
    }
  });

  it("repeatedly registers an isolated command with version and help output", async () => {
    const xdgDataHome = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pnpm-data-"),
    );

    try {
      const env = isolatedPnpmEnvironment(xdgDataHome);

      await execFileAsync("pnpm", ["run", "setup:cli"], {
        cwd: process.cwd(),
        env,
      });
      await execFileAsync("pnpm", ["run", "setup:cli"], {
        cwd: process.cwd(),
        env,
      });

      const { stdout: globalBinOutput } = await execFileAsync(
        "pnpm",
        ["bin", "--global"],
        { cwd: process.cwd(), env },
      );
      const globalBin = globalBinOutput.trim();
      expect(globalBin).not.toBe("");
      expect(path.relative(xdgDataHome, globalBin)).not.toMatch(
        /^\.\.(?:\/|$)/,
      );

      const executable = path.join(globalBin, "devcanon");
      const version = await execFileAsync(executable, ["--version"], { env });
      const help = await execFileAsync(executable, ["--help"], { env });

      expect(version.stdout.trim()).toBe("0.1.0");
      expect(help.stdout).toContain("Usage: devcanon");
    } finally {
      await rm(xdgDataHome, { recursive: true, force: true });
    }
  });
});
