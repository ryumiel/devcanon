#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const runtimePath =
  process.argv[2] ?? "skills/devcanon-runtime/scripts/runtime";

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result;
}

const diff = runGit(["diff", "--exit-code", "--", runtimePath], {
  stdio: "inherit",
});
if (diff.status !== 0) {
  process.exit(diff.status ?? 1);
}

const untracked = runGit([
  "ls-files",
  "--others",
  "--exclude-standard",
  "--",
  runtimePath,
]);
if (untracked.status !== 0) {
  process.stderr.write(untracked.stderr);
  process.exit(untracked.status ?? 1);
}

const untrackedFiles = untracked.stdout.trim();
if (untrackedFiles.length > 0) {
  console.error(`runtime build produced untracked files under ${runtimePath}:`);
  console.error(untrackedFiles);
  process.exit(1);
}
