#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[2] === "--help") {
  if (process.argv.length !== 3) {
    console.error("--help does not accept additional arguments");
    process.exit(1);
  }
  const usageDocument = path.join(
    path.dirname(scriptPath),
    "..",
    "references",
    "write-auto-handoff-usage.md",
  );
  try {
    process.stdout.write(readFileSync(usageDocument));
  } catch {
    console.error(`usage document missing or unreadable: ${usageDocument}`);
    process.exit(1);
  }
  process.exit(0);
}

const { requirePathStdout, runRuntimeBackedHelper } = await import(
  "./runtime-adapter.mjs"
);
runRuntimeBackedHelper(
  scriptPath,
  ["issue-priming", "write-auto-handoff", ...process.argv.slice(2)],
  (stdout) =>
    requirePathStdout(
      stdout,
      /^\.ephemeral\/issue-priming-auto-handoff-[0-9a-f]{40}\.json\n$/u,
      "write-auto-handoff",
    ),
);
