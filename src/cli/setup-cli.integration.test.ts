import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function isolatedPnpmEnvironment(xdgDataHome: string): NodeJS.ProcessEnv {
  const {
    NPM_CONFIG_GLOBAL: _npmConfigGlobal,
    NPM_CONFIG_GLOBAL_BIN_DIR: _npmConfigGlobalBinDir,
    NPM_CONFIG_GLOBAL_DIR: _npmConfigGlobalDir,
    NPM_CONFIG_PREFIX: _npmConfigPrefix,
    PNPM_CONFIG_GLOBAL_BIN_DIR: _pnpmConfigGlobalBinDir,
    PNPM_CONFIG_GLOBAL_DIR: _pnpmConfigGlobalDir,
    PNPM_HOME: _pnpmHome,
    npm_config_global: _npmConfigGlobalLower,
    npm_config_global_bin_dir: _npmConfigGlobalBinDirLower,
    npm_config_global_dir: _npmConfigGlobalDirLower,
    npm_config_prefix: _npmConfigPrefixLower,
    pnpm_config_global_bin_dir: _pnpmConfigGlobalBinDirLower,
    pnpm_config_global_dir: _pnpmConfigGlobalDirLower,
    ...environment
  } = process.env;
  const pnpmHome = path.join(xdgDataHome, "pnpm");

  return {
    ...environment,
    PATH: `${pnpmHome}${path.delimiter}${environment.PATH ?? ""}`,
    PNPM_HOME: pnpmHome,
    XDG_DATA_HOME: xdgDataHome,
  };
}

describe.runIf(process.platform !== "win32")("setup:cli", () => {
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
