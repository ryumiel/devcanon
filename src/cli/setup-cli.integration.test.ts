import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function isolatedPnpmEnvironment(xdgDataHome: string): NodeJS.ProcessEnv {
  const {
    HOME: _home,
    NPM_CONFIG_GLOBAL: _npmConfigGlobal,
    NPM_CONFIG_GLOBAL_BIN_DIR: _npmConfigGlobalBinDir,
    NPM_CONFIG_GLOBALCONFIG: _npmConfigGlobalConfig,
    NPM_CONFIG_GLOBAL_DIR: _npmConfigGlobalDir,
    NPM_CONFIG_PREFIX: _npmConfigPrefix,
    PNPM_CONFIG_GLOBAL_BIN_DIR: _pnpmConfigGlobalBinDir,
    PNPM_CONFIG_GLOBAL_DIR: _pnpmConfigGlobalDir,
    PNPM_HOME: _pnpmHome,
    XDG_CONFIG_HOME: _xdgConfigHome,
    npm_config_global: _npmConfigGlobalLower,
    npm_config_global_bin_dir: _npmConfigGlobalBinDirLower,
    npm_config_globalconfig: _npmConfigGlobalConfigLower,
    npm_config_global_dir: _npmConfigGlobalDirLower,
    npm_config_prefix: _npmConfigPrefixLower,
    npm_config_userconfig: _npmConfigUserConfigLower,
    pnpm_config_global_bin_dir: _pnpmConfigGlobalBinDirLower,
    pnpm_config_global_dir: _pnpmConfigGlobalDirLower,
    NPM_CONFIG_USERCONFIG: _npmConfigUserConfig,
    ...environment
  } = process.env;
  const configurationHome = path.join(xdgDataHome, "config");
  const pnpmHome = path.join(xdgDataHome, "pnpm");

  return {
    ...environment,
    HOME: path.join(xdgDataHome, "home"),
    NPM_CONFIG_GLOBALCONFIG: path.join(configurationHome, "npm-globalrc"),
    NPM_CONFIG_USERCONFIG: path.join(configurationHome, "npmrc"),
    PATH: `${pnpmHome}${path.delimiter}${environment.PATH ?? ""}`,
    PNPM_HOME: pnpmHome,
    XDG_CONFIG_HOME: configurationHome,
    XDG_DATA_HOME: xdgDataHome,
    npm_config_globalconfig: path.join(configurationHome, "npm-globalrc"),
    npm_config_userconfig: path.join(configurationHome, "npmrc"),
  };
}

describe.runIf(process.platform !== "win32")("setup:cli", () => {
  it("isolates configuration discovery before setup executes", () => {
    const xdgDataHome = path.join(os.tmpdir(), "devcanon-pnpm-data");
    const configurationHome = path.join(xdgDataHome, "config");
    const environment = isolatedPnpmEnvironment(xdgDataHome);

    expect(environment).toMatchObject({
      HOME: path.join(xdgDataHome, "home"),
      NPM_CONFIG_GLOBALCONFIG: path.join(configurationHome, "npm-globalrc"),
      NPM_CONFIG_USERCONFIG: path.join(configurationHome, "npmrc"),
      XDG_CONFIG_HOME: configurationHome,
      XDG_DATA_HOME: xdgDataHome,
      npm_config_globalconfig: path.join(configurationHome, "npm-globalrc"),
      npm_config_userconfig: path.join(configurationHome, "npmrc"),
    });
  });

  it("repeatedly registers an isolated command with version and help output", async () => {
    const xdgDataHome = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-pnpm-data-"),
    );
    const env = isolatedPnpmEnvironment(xdgDataHome);

    try {
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
