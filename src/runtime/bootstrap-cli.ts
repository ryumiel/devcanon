#!/usr/bin/env node
import path from "node:path";
import { dispatchRuntimeOverride, formatBootstrapError } from "./bootstrap.js";

export async function runBootstrapCli(args: readonly string[]): Promise<void> {
  try {
    const { runtimeDirectory, childArguments } = parseBootstrapArguments(args);
    const result = await dispatchRuntimeOverride(
      runtimeDirectory,
      childArguments,
    );
    if (result.signal !== null) {
      process.kill(process.pid, result.signal);
    } else {
      process.exitCode = result.exitCode ?? 1;
    }
  } catch (error) {
    process.stderr.write(`${formatBootstrapError(error)}\n`);
    process.exitCode = 1;
  }
}

if (isDirectBootstrapEntrypoint()) {
  await runBootstrapCli(process.argv.slice(2));
}

export function parseBootstrapArguments(args: readonly string[]): {
  runtimeDirectory: string;
  childArguments: string[];
} {
  if (args[0] !== "--runtime-dir" || args.length < 4 || args[2] !== "--") {
    throw new Error(
      "bootstrap usage: --runtime-dir <path> -- <runtime-command> [args...]",
    );
  }
  return {
    runtimeDirectory: args[1],
    childArguments: args.slice(3),
  };
}

function isDirectBootstrapEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    /^bootstrap-cli\.(?:js|ts)$/u.test(path.basename(entrypoint))
  );
}
