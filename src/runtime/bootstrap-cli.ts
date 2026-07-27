#!/usr/bin/env node
import { dispatchRuntimeOverride, formatBootstrapError } from "./bootstrap.js";

const args = process.argv.slice(2);

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

function parseBootstrapArguments(args: readonly string[]): {
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
