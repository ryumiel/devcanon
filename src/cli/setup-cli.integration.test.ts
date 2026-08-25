import { exec, execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

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

function isolatedNpmEnvironment(root: string): NodeJS.ProcessEnv {
  const inheritedPath = process.env.PATH;
  if (!inheritedPath) throw new Error("PATH is required to execute npm");

  const prefix = path.join(root, "npm");
  const userConfig = path.join(root, "npmrc");

  return {
    ...process.env,
    NPM_CONFIG_PREFIX: prefix,
    NPM_CONFIG_USERCONFIG: userConfig,
    PATH: `${prefix}${path.delimiter}${inheritedPath}`,
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

      expect(version.stdout.trim()).toBe("2.0.0");
      expect(help.stdout).toContain("Usage: devcanon");
    } finally {
      await rm(xdgDataHome, { recursive: true, force: true });
    }
  });
});

describe.runIf(process.platform === "win32")("setup:cli", () => {
  it("repeatedly registers an isolated command with version and help output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-npm-data-"));

    try {
      const env = isolatedNpmEnvironment(root);
      const commandShell = process.env.ComSpec ?? "cmd.exe";

      await execFileAsync(
        commandShell,
        ["/d", "/s", "/c", "pnpm run setup:cli"],
        { cwd: process.cwd(), env },
      );
      await execFileAsync(
        commandShell,
        ["/d", "/s", "/c", "pnpm run setup:cli"],
        { cwd: process.cwd(), env },
      );

      const executable = path.join(root, "npm", "devcanon.cmd");
      await access(executable);
      const version = await execAsync(`"${executable}" --version`, {
        env,
        shell: commandShell,
      });
      const help = await execAsync(`"${executable}" --help`, {
        env,
        shell: commandShell,
      });

      expect(version.stdout.trim()).toBe("2.0.0");
      expect(help.stdout).toContain("Usage: devcanon");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
