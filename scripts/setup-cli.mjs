import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import spawn from "cross-spawn";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const isWindows = process.platform === "win32";
run(isWindows ? "npm" : "pnpm", ["run", "build"], repositoryRoot);
run(isWindows ? "npm" : "pnpm", ["run", "build:runtime"], repositoryRoot);
const globalBin = run(
  isWindows ? "npm" : "pnpm",
  isWindows ? ["prefix", "--global"] : ["bin", "--global"],
  repositoryRoot,
  true,
).trim();
await mkdir(globalBin, { recursive: true });
const launcher = path.join(repositoryRoot, "dist", "cli", "source.js");
if (isWindows) {
  const gitBashLauncher = launcher.replaceAll("\\", "/");
  await writeFile(
    path.join(globalBin, "devcanon"),
    `#!/bin/sh\nexec node ${quotePosixShellLiteral(gitBashLauncher)} "$@"\n`,
    "utf8",
  );
  await writeFile(
    path.join(globalBin, "devcanon.cmd"),
    `@echo off\r\nnode "${escapeWindowsBatchLiteral(launcher)}" %*\r\n`,
    "utf8",
  );
} else {
  const shim = path.join(globalBin, "devcanon");
  await writeFile(
    shim,
    `#!/bin/sh\nexec node ${quotePosixShellLiteral(launcher)} "$@"\n`,
    "utf8",
  );
  await chmod(shim, 0o755);
}

function quotePosixShellLiteral(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function escapeWindowsBatchLiteral(value) {
  return value.replaceAll("%", "%%");
}

function run(command, args, cwd, capture = false) {
  const result = spawn.sync(command, args, {
    cwd,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return capture ? result.stdout : "";
}
