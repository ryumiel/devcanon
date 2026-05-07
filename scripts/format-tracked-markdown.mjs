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

function getRequestedMarkdownFiles(args) {
  const separatorIndex = args.indexOf("--");
  const explicitFiles =
    separatorIndex >= 0
      ? args.slice(separatorIndex + 1)
      : args.filter((arg) => !arg.startsWith("--"));

  if (explicitFiles.length > 0) {
    return explicitFiles.filter((file) => existsSync(file));
  }

  return getTrackedMarkdownFiles();
}

const mode = process.argv.includes("--write") ? "--write" : "--check";
const files = getRequestedMarkdownFiles(process.argv.slice(2));

if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "prettier", mode, ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
