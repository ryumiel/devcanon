#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function runRuntimeCli(
  args: readonly string[],
  restart: { entrypoint: string; arguments: readonly string[] } = {
    entrypoint: fileURLToPath(import.meta.url),
    arguments: args,
  },
): Promise<void> {
  const { DEBUG: _debug, NODE_OPTIONS, ...runtimeEnvironment } = process.env;
  if (NODE_OPTIONS !== undefined) {
    const result = spawnSync(
      process.execPath,
      [restart.entrypoint, ...restart.arguments],
      { env: runtimeEnvironment, stdio: "inherit" },
    );
    if (result.error !== undefined) throw result.error;
    if (result.signal !== null) {
      process.kill(process.pid, result.signal);
    } else {
      process.exitCode = result.status ?? 1;
    }
    return;
  }

  const { runRuntimeCommand } = await import("./command.js");
  const result = await runRuntimeCommand(args);
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (isDirectCliEntrypoint()) {
  await runRuntimeCli(process.argv.slice(2));
}

function isDirectCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    /^cli\.(?:js|ts)$/u.test(path.basename(entrypoint))
  );
}
