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

  const configurationHome = path.join(xdgDataHome, "config");
  const pnpmHome = path.join(xdgDataHome, "pnpm");

  return {
    HOME: path.join(xdgDataHome, "home"),
    NPM_CONFIG_GLOBALCONFIG: path.join(configurationHome, "npm-globalrc"),
    NPM_CONFIG_USERCONFIG: path.join(configurationHome, "npmrc"),
    PATH: `${pnpmHome}${path.delimiter}${inheritedPath}`,
    PNPM_HOME: pnpmHome,
    XDG_CONFIG_HOME: configurationHome,
    XDG_DATA_HOME: xdgDataHome,
    npm_config_globalconfig: path.join(configurationHome, "npm-globalrc"),
    npm_config_userconfig: path.join(configurationHome, "npmrc"),
  };
}

describe.runIf(process.platform !== "win32")("setup:cli", () => {
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
      await execFileAsync("pnpm", ["add", "--global", process.cwd()], {
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
