import { exec, execFile } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
      const unrelatedCwd = path.join(xdgDataHome, "unrelated");
      await mkdir(unrelatedCwd);
      const catalog = await execFileAsync(
        executable,
        ["--json", "config", "get", "capabilityProfiles.balanced.codex"],
        { cwd: unrelatedCwd, env },
      );

      expect(version.stdout.trim()).toBe("2.0.0");
      expect(help.stdout).toContain("Usage: devcanon");
      expect(JSON.parse(catalog.stdout)).toMatchObject({
        source: "bundled",
        key: "capabilityProfiles.balanced.codex",
        value: "gpt-5.6-terra",
      });
    } finally {
      await rm(xdgDataHome, { recursive: true, force: true });
    }
  });

  it("preserves a shell-significant checkout path in the generated launcher", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "devcanon-setup-quote-"));
    const checkout = path.join(root, "checkout $d `tick` 'single' \"double\"");
    const fakeBin = path.join(root, "fake-bin");
    const globalBin = path.join(root, "global bin");

    try {
      await mkdir(path.join(checkout, "scripts"), { recursive: true });
      await mkdir(path.join(checkout, "dist", "cli"), { recursive: true });
      await mkdir(fakeBin);
      await cp(
        path.resolve("scripts/setup-cli.mjs"),
        path.join(checkout, "scripts", "setup-cli.mjs"),
      );
      await symlink(
        path.resolve("node_modules"),
        path.join(checkout, "node_modules"),
        "dir",
      );
      const launcher = path.join(checkout, "dist", "cli", "source.js");
      await writeFile(
        launcher,
        "process.stdout.write(JSON.stringify({ launcher: process.argv[1], args: process.argv.slice(2) }));\n",
      );
      const fakePnpm = path.join(fakeBin, "pnpm");
      await writeFile(
        fakePnpm,
        `#!/usr/bin/env node
if (process.argv[2] === "bin" && process.argv[3] === "--global") {
  process.stdout.write(process.env.DEVCANON_TEST_GLOBAL_BIN + "\\n");
}
`,
      );
      await chmod(fakePnpm, 0o755);

      const inheritedPath = process.env.PATH;
      if (!inheritedPath) throw new Error("PATH is required to execute pnpm");
      const env = {
        ...process.env,
        DEVCANON_TEST_GLOBAL_BIN: globalBin,
        PATH: `${fakeBin}${path.delimiter}${inheritedPath}`,
      };
      await execFileAsync(process.execPath, ["scripts/setup-cli.mjs"], {
        cwd: checkout,
        env,
      });

      const { stdout } = await execFileAsync(
        path.join(globalBin, "devcanon"),
        ["argument with spaces"],
        { env },
      );
      const invoked = JSON.parse(stdout) as {
        launcher: string;
        args: string[];
      };
      expect(await realpath(invoked.launcher)).toBe(await realpath(launcher));
      expect(invoked.args).toEqual(["argument with spaces"]);
    } finally {
      await rm(root, { recursive: true, force: true });
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
      const powerShellLauncher = path.join(root, "npm", "devcanon.ps1");
      await writeFile(
        powerShellLauncher,
        "Write-Output 'stale npm launcher'\r\nexit 23\r\n",
        "utf8",
      );
      await execFileAsync(
        commandShell,
        ["/d", "/s", "/c", "pnpm run setup:cli"],
        { cwd: process.cwd(), env },
      );

      const executable = path.join(root, "npm", "devcanon.cmd");
      await access(executable);
      const extensionless = path.join(root, "npm", "devcanon");
      await access(extensionless);
      await access(powerShellLauncher);
      const resolver = path.resolve(
        "skills/devcanon-runtime/scripts/resolve-bash.mjs",
      );
      const { stdout: gitBashOutput } = await execFileAsync(
        process.execPath,
        [resolver],
        { cwd: process.cwd(), env },
      );
      const gitBash = gitBashOutput.trim();
      const shimVersion = await execFileAsync(
        gitBash,
        [
          "--noprofile",
          "--norc",
          "-lc",
          'shim="$(cygpath -u "$DEVCANON_TEST_SHIM")" && exec "$shim" --version',
        ],
        { env: { ...env, DEVCANON_TEST_SHIM: extensionless } },
      );
      const version = await execAsync(`"${executable}" --version`, {
        env,
        shell: commandShell,
      });
      const powerShellVersion = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "devcanon --version"],
        { env },
      );
      const help = await execAsync(`"${executable}" --help`, {
        env,
        shell: commandShell,
      });
      const unrelatedCwd = path.join(root, "unrelated");
      await mkdir(unrelatedCwd);
      const catalog = await execAsync(
        `"${executable}" --json config get capabilityProfiles.balanced.codex`,
        { cwd: unrelatedCwd, env, shell: commandShell },
      );

      expect(version.stdout.trim()).toBe("2.0.0");
      expect(powerShellVersion.stdout.trim()).toBe("2.0.0");
      expect(shimVersion.stdout.trim()).toBe("2.0.0");
      expect(help.stdout).toContain("Usage: devcanon");
      expect(JSON.parse(catalog.stdout)).toMatchObject({
        source: "bundled",
        key: "capabilityProfiles.balanced.codex",
        value: "gpt-5.6-terra",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves percent signs in the checkout path of the generated batch launcher", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "devcanon-setup-percent-"),
    );
    const checkout = path.join(root, "checkout-%DEVCANON_TEST_EXPANSION%");
    const fakeBin = path.join(root, "fake-bin");
    const globalBin = path.join(root, "global-bin");

    try {
      await mkdir(path.join(checkout, "scripts"), { recursive: true });
      await mkdir(path.join(checkout, "dist", "cli"), { recursive: true });
      await mkdir(fakeBin);
      await cp(
        path.resolve("scripts/setup-cli.mjs"),
        path.join(checkout, "scripts", "setup-cli.mjs"),
      );
      await symlink(
        path.resolve("node_modules"),
        path.join(checkout, "node_modules"),
        "junction",
      );
      const launcher = path.join(checkout, "dist", "cli", "source.js");
      await writeFile(
        launcher,
        "process.stdout.write(JSON.stringify({ launcher: process.argv[1], args: process.argv.slice(2) }));\n",
      );
      await writeFile(
        path.join(fakeBin, "npm.cmd"),
        '@echo off\r\nif "%~1"=="prefix" if "%~2"=="--global" echo %DEVCANON_TEST_GLOBAL_BIN%\r\nexit /b 0\r\n',
      );

      const inheritedPath = process.env.PATH;
      if (!inheritedPath) throw new Error("PATH is required to execute npm");
      const env = {
        ...process.env,
        DEVCANON_TEST_EXPANSION: "expanded",
        DEVCANON_TEST_GLOBAL_BIN: globalBin,
        PATH: `${fakeBin}${path.delimiter}${inheritedPath}`,
      };
      await execFileAsync(process.execPath, ["scripts/setup-cli.mjs"], {
        cwd: checkout,
        env,
      });

      const executable = path.join(globalBin, "devcanon.cmd");
      const { stdout } = await execAsync(
        `"${executable}" "argument with spaces"`,
        {
          env,
          shell: process.env.ComSpec ?? "cmd.exe",
        },
      );
      const invoked = JSON.parse(stdout) as {
        launcher: string;
        args: string[];
      };
      expect(await realpath(invoked.launcher)).toBe(await realpath(launcher));
      expect(invoked.args).toEqual(["argument with spaces"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
