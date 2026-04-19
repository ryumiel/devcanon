#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

function getTrackedMarkdownFiles() {
  const output = execFileSync("git", ["ls-files", "--", "*.md"], {
    encoding: "utf8",
  }).trim();

  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => existsSync(file));
}

const mode = process.argv.includes("--write") ? "--write" : "--check";
const files = getTrackedMarkdownFiles();

if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "prettier", mode, ...files], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
