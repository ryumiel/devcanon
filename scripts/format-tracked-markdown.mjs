#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { getRequestedMarkdownFiles } from "./select-markdown-files.mjs";

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
