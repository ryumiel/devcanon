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
    "source-immutability-usage.md",
  );
  try {
    process.stdout.write(readFileSync(usageDocument));
  } catch {
    console.error(`usage document missing or unreadable: ${usageDocument}`);
    process.exit(1);
  }
  process.exit(0);
}

const { requireExactLineStdout, requirePathStdout, runRuntimeBackedHelper } =
  await import("./runtime-adapter.mjs");
const helperArgs = process.argv.slice(2);
runRuntimeBackedHelper(
  scriptPath,
  ["source-immutability", ...helperArgs],
  (stdout) => {
    switch (helperArgs[0]) {
      case "capture":
        requirePathStdout(
          stdout,
          /^\.ephemeral\/\.devcanon-source-immutability-[0-9a-f]{32}\.json\n$/u,
          "source-immutability capture",
        );
        return;
      case "verify":
        requireExactLineStdout(
          stdout,
          "unchanged",
          "source-immutability verify",
        );
        return;
      case "cleanup":
        requireExactLineStdout(
          stdout,
          "cleaned",
          "source-immutability cleanup",
        );
        return;
      default:
        throw new Error(
          "source-immutability returned output for an unknown command",
        );
    }
  },
);
