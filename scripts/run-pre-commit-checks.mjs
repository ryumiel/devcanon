#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

function getStagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { encoding: "utf8" },
  ).trim();

  if (!output) {
    return [];
  }

  return output.split("\n").filter(Boolean);
}

function hasCaseMismatch(filePath) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const entries = readdirSync(directory === "." ? process.cwd() : directory, {
    encoding: "utf8",
  });
  const actual = entries.find(
    (entry) => entry.toLowerCase() === basename.toLowerCase(),
  );

  return Boolean(actual && actual !== basename);
}

function runScript(name) {
  const result = spawnSync("pnpm", ["run", name], { stdio: "inherit" });
  return result.status ?? 1;
}

const stagedFiles = getStagedFiles();
const hasMarkdown = stagedFiles.some((file) => file.endsWith(".md"));
const hasRepoCode = stagedFiles.some((file) =>
  /\.(?:ts|c?js|json|jsonc|mjs)$/.test(file),
);

let failed = false;

for (const file of stagedFiles) {
  if (hasCaseMismatch(file)) {
    console.error(`ERROR: Case mismatch detected for ${file}`);
    failed = true;
  }
}

if (hasRepoCode && runScript("format:check") !== 0) {
  failed = true;
}

if (hasRepoCode && runScript("lint") !== 0) {
  failed = true;
}

if (hasMarkdown && runScript("format:markdown:check") !== 0) {
  failed = true;
}

if (hasMarkdown && runScript("lint:markdown") !== 0) {
  failed = true;
}

process.exit(failed ? 1 : 0);
